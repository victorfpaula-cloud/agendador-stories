// Integração com a Google Drive API — usada só pelo sub-módulo do Drive
// (passo 7), pra ler automaticamente a pasta do dia (Dona Baunilha). Usa uma
// "conta de serviço" do Google (credencial que não expira, diferente do
// token do Meta que expira a cada ~60 dias) — só precisa compartilhar a
// pasta do Drive com o e-mail dela uma vez.
//
// Implementado com fetch puro (sem a biblioteca oficial "googleapis", que é
// bem pesada) pra manter o mesmo estilo do resto do projeto (ver
// src/lib/meta.ts, que também fala direto com a Graph API do Meta por
// fetch) — a única parte "manual" é assinar o JWT de autenticação usando o
// módulo nativo "crypto" do Node, sem precisar de nenhuma dependência nova
// pra isso.
//
// Escopo usado: drive.readonly — este código nunca escreve nem apaga nada
// no Drive do Victor, só lê.

import { createSign } from "crypto";

export interface ArquivoDrive {
  id: string;
  name: string;
  mimeType: string;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Troca a credencial da conta de serviço por um access token temporário
// (válido por 1h), usando o fluxo padrão "JWT Bearer" do Google OAuth2.
// Gera um token novo a cada chamada — simples e suficiente, já que esse
// cron roda só 1x por dia.
export async function obterAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const chavePrivadaBruta = process.env.GOOGLE_DRIVE_PRIVATE_KEY;

  if (!email || !chavePrivadaBruta) {
    throw new Error(
      "Faltam as variáveis de ambiente da conta de serviço do Google (GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY) na Vercel."
    );
  }

  // Na Vercel, quebras de linha dentro do valor de uma variável de ambiente
  // costumam vir escapadas como o texto "\n" em vez de quebra de linha de
  // verdade — isso converte de volta antes de usar a chave pra assinar.
  const chavePrivada = chavePrivadaBruta.replace(/\\n/g, "\n");

  const agora = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: agora,
      exp: agora + 3600,
    })
  );

  const assinatura = base64url(createSign("RSA-SHA256").update(`${header}.${claim}`).sign(chavePrivada));
  const jwt = `${header}.${claim}.${assinatura}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.access_token) {
    throw new Error(
      `Falha ao autenticar com a conta de serviço do Google: ${
        json?.error_description || json?.error || `HTTP ${res.status}`
      }`
    );
  }

  return json.access_token as string;
}

async function chamarDriveApi(accessToken: string, caminho: string): Promise<any> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${caminho}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`Erro na API do Google Drive: ${json?.error?.message || `HTTP ${res.status}`}`);
  }

  return json;
}

// Aceita tanto um link completo do Drive ("https://drive.google.com/drive/folders/ABC123...")
// quanto só o ID da pasta já colado direto — a telinha de configuração
// (passo 6) já deixa claro que os dois formatos valem.
export function extrairIdDaPasta(valor: string): string {
  const trecho = valor.trim();
  const matchCaminho = trecho.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (matchCaminho) return matchCaminho[1];
  const matchQuery = trecho.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchQuery) return matchQuery[1];
  return trecho;
}

// Deixa um nome de pasta "neutro" pra comparar: tira espaço sobrando nas
// pontas, ignora maiúscula/minúscula, junta espaços duplos e trata
// qualquer tipo de travessão (en dash "–", em dash "—", o hífen "normal"
// que às vezes vira outro no iPad por causa da correção automática de
// pontuação) como o mesmo traço. Achado em 01/09/2026: a pasta do mês
// existia e estava certa aos olhos do Victor, mas a busca exata não achou
// — bem provável que o "corretor" do iPad tenha trocado o hífen por outro
// traço na hora de criar a pasta. Normalizando os dois lados da comparação
// (o nome esperado E o nome real de cada pasta), esse tipo de diferença
// invisível deixa de derrubar a automação.
function normalizarNomeDePasta(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ");
}

// Acha, dentro de uma pasta-pai, uma subpasta cujo nome bate com o
// esperado (comparação tolerante — ver normalizarNomeDePasta acima).
// Devolve `null` se não existir — isso é esperado e normal (ex: mês ainda
// não tem pasta, ou dia sem post), não é tratado como erro por quem chama.
export async function encontrarSubpasta(
  accessToken: string,
  pastaPaiId: string,
  nome: string
): Promise<string | null> {
  const q = `'${pastaPaiId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const json = await chamarDriveApi(
    accessToken,
    `files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`
  );
  const arquivos = (json.files ?? []) as ArquivoDrive[];
  const alvo = normalizarNomeDePasta(nome);
  const encontrada = arquivos.find((a) => normalizarNomeDePasta(a.name) === alvo);
  return encontrada?.id ?? null;
}

// Lista os arquivos (não-pastas) dentro de uma pasta, em ordem alfabética
// pelo nome — essa ordem vira a ordem do carrossel quando houver mais de
// uma mídia, e também decide qual PDF é "o" PDF quando houver mais de um.
export async function listarArquivosDaPasta(accessToken: string, pastaId: string): Promise<ArquivoDrive[]> {
  const q = `'${pastaId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
  const json = await chamarDriveApi(
    accessToken,
    `files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,mimeType)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`
  );
  return (json.files ?? []) as ArquivoDrive[];
}

// Baixa o conteúdo bruto (bytes) de um arquivo do Drive.
export async function baixarArquivoDrive(accessToken: string, fileId: string): Promise<Buffer> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );

  if (!res.ok) {
    throw new Error(`Falha ao baixar arquivo do Drive (HTTP ${res.status}).`);
  }

  return Buffer.from(await res.arrayBuffer());
}

export const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
