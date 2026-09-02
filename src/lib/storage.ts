import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "story-media";

export async function removerMidia(admin: SupabaseClient, path: string) {
  await admin.storage.from(BUCKET).remove([path]);
}

// Usado pelo sub-módulo do Drive (passo 7): o servidor já baixou o arquivo
// do Google Drive (Buffer em memória, dentro do próprio cron) e precisa
// subir pro Storage do Supabase pra virar uma URL pública (que é o que a
// API do Instagram exige). Diferente do upload direto (`criarUploadAssinado`,
// usado pelo navegador do Victor), aqui não existe o limite de ~4,5MB de
// corpo de requisição da Vercel envolvido — esse limite é só pra
// requisições que chegam de fora; código rodando no próprio servidor,
// enviando um Buffer direto pro Storage, não passa por essa camada.
export async function enviarMidiaBuffer(
  admin: SupabaseClient,
  bucket: string,
  pasta: string,
  buffer: Buffer,
  mimeType: string,
  nomeArquivoOriginal: string
) {
  const extensao = (
    nomeArquivoOriginal.split(".").pop() || (mimeType.startsWith("video/") ? "mp4" : "jpg")
  ).toLowerCase();
  const path = `${pasta}/${randomUUID()}.${extensao}`;

  const { error } = await admin.storage.from(bucket).upload(path, buffer, {
    contentType: mimeType || undefined,
    upsert: false,
  });

  if (error) {
    throw new Error(`Falha ao enviar o arquivo pro Storage: ${error.message}`);
  }

  const { data: pub } = admin.storage.from(bucket).getPublicUrl(path);

  return { url: pub.publicUrl, path };
}

// ---------- Upload direto (navegador -> Storage, sem passar pelo servidor) ----------
//
// Usado tanto pelos Stories quanto pelo módulo de Publicações (feed/Reels/
// carrossel): em vez do arquivo passar pela função serverless da Vercel (que
// tem limite de ~4,5MB de corpo de requisição — inviável pra vídeo), o
// navegador sobe direto pro Storage usando uma "signed upload URL" — o
// servidor só gera esse link (poucos bytes), nunca vê o arquivo em si.
// Recebe o bucket como parâmetro (fixo em "story-media" pros Stories,
// "feed-media" pras Publicações) e `pasta` é só uma etiqueta de organização
// dentro do bucket (ex: o id da conta pros Stories, "manual"/"drive" pras
// Publicações).
export async function criarUploadAssinado(
  admin: SupabaseClient,
  bucket: string,
  pasta: string,
  fileName: string
) {
  const extensao = (fileName.split(".").pop() || "dat").toLowerCase();
  const path = `${pasta}/${randomUUID()}.${extensao}`;

  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);

  if (error || !data) {
    throw new Error(`Falha ao gerar o link de upload: ${error?.message ?? "erro desconhecido"}`);
  }

  const { data: pub } = admin.storage.from(bucket).getPublicUrl(path);

  return { signedUrl: data.signedUrl, token: data.token, path, publicUrl: pub.publicUrl };
}

// Usado por "Duplicar rotina": copia de verdade o arquivo de mídia pra uma
// pasta nova, da conta de destino, em vez de só reaproveitar o mesmo link.
// Isso é importante — se as duas contas apontassem pro mesmo arquivo, trocar
// ou remover a mídia numa conta quebraria a outra silenciosamente. Copiando,
// as duas ficam 100% independentes dali em diante.
export async function duplicarMidia(admin: SupabaseClient, accountIdDestino: string, pathOrigem: string) {
  const { data: arquivoOrigem, error: erroDownload } = await admin.storage.from(BUCKET).download(pathOrigem);

  if (erroDownload || !arquivoOrigem) {
    throw new Error(`Falha ao ler a mídia original: ${erroDownload?.message ?? "arquivo não encontrado"}`);
  }

  const extensao = (pathOrigem.split(".").pop() || "dat").toLowerCase();
  const path = `${accountIdDestino}/${randomUUID()}.${extensao}`;

  const buffer = Buffer.from(await arquivoOrigem.arrayBuffer());

  const { error: erroUpload } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: arquivoOrigem.type || undefined,
    upsert: false,
  });

  if (erroUpload) {
    throw new Error(`Falha ao salvar a cópia da mídia: ${erroUpload.message}`);
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);

  return { url: pub.publicUrl, path };
}
