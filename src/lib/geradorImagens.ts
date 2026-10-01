import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

export const BUCKET_GERADOR = "gerador-imagens";

export const FORMATOS = {
  story: { rotulo: "Story (9:16)", aspecto: "9:16", largura: 1080, altura: 1920 },
  feed: { rotulo: "Feed (4:5)", aspecto: "4:5", largura: 1080, altura: 1350 },
  quadrado: { rotulo: "Quadrado (1:1)", aspecto: "1:1", largura: 1080, altura: 1080 },
  paisagem: { rotulo: "Paisagem (16:9)", aspecto: "16:9", largura: 1920, altura: 1080 },
} as const;
export type FormatoId = keyof typeof FORMATOS;

export const MODOS = {
  criar: "Criar arte",
  produto: "Melhorar foto de produto",
  lettering: "Arte com texto (lettering)",
  editar: "Editar imagem",
} as const;
export type ModoId = keyof typeof MODOS;

export const POSICOES_LOGO = [
  "superior-esquerdo",
  "superior-centro",
  "superior-direito",
  "centro",
  "inferior-esquerdo",
  "inferior-centro",
  "inferior-direito",
] as const;
export type PosicaoLogo = (typeof POSICOES_LOGO)[number];

export type MarcaConfig = {
  logo_path: string | null;
  logo_posicao: PosicaoLogo;
  logo_tamanho_pct: number;
  logo_margem_pct: number;
  estilo: string;
};

const NOME_POSICAO: Record<PosicaoLogo, string> = {
  "superior-esquerdo": "top-left corner",
  "superior-centro": "top center",
  "superior-direito": "top-right corner",
  centro: "center",
  "inferior-esquerdo": "bottom-left corner",
  "inferior-centro": "bottom center",
  "inferior-direito": "bottom-right corner",
};

export function ehFormato(v: unknown): v is FormatoId {
  return typeof v === "string" && v in FORMATOS;
}
export function ehModo(v: unknown): v is ModoId {
  return typeof v === "string" && v in MODOS;
}

// Monta o prompt final enviado ao Nano Banana. O que o Victor escreve (ou o
// "pedido turbinado") é o miolo; o resto são regras técnicas que garantem
// formato, texto exato e espaço livre pro logo.
export function montarPrompt(opts: {
  modo: ModoId;
  formato: FormatoId;
  pedido: string;
  textoExato: string;
  marca: MarcaConfig | null;
  nomeConta: string;
  usarLogo: boolean;
  qtdReferencias: number;
}): string {
  const { modo, formato, pedido, textoExato, marca, usarLogo, qtdReferencias } = opts;
  const f = FORMATOS[formato];
  const linhas: string[] = [];

  if (modo === "produto") {
    linhas.push(
      "Você é um fotógrafo publicitário. A primeira imagem anexada é o PRODUTO REAL. Preserve o produto exatamente como é: forma, proporções, cores, rótulo, embalagem e qualquer logotipo ou texto impresso nele — não redesenhe, não invente detalhes, não troque a marca. Melhore apenas o entorno: iluminação, fundo, cenário, sombras, reflexos e composição, com qualidade de foto profissional de catálogo."
    );
  } else if (modo === "editar") {
    linhas.push(
      "A primeira imagem anexada é a imagem a ser editada. Aplique SOMENTE a alteração pedida abaixo e mantenha todo o resto idêntico (composição, cores, textos, rostos, objetos, estilo)."
    );
  } else if (modo === "lettering") {
    linhas.push(
      "Crie uma arte gráfica de redes sociais com tipografia/lettering de alto nível: hierarquia visual clara, texto grande, legível e bem integrado ao design."
    );
  } else {
    linhas.push("Crie uma imagem de alta qualidade para redes sociais (Instagram).");
  }

  linhas.push(`Pedido: ${pedido.trim()}`);

  if (qtdReferencias > 0 && modo !== "produto" && modo !== "editar") {
    linhas.push(
      `Há ${qtdReferencias} imagem(ns) de referência anexada(s): use-as como referência visual (estilo, produto, pessoa, objeto, composição) conforme o pedido, mantendo fidelidade ao que aparece nelas.`
    );
  }

  const texto = textoExato.trim();
  if (texto) {
    linhas.push(
      `TEXTO NA IMAGEM — escreva exatamente o texto abaixo, letra por letra, em português, com acentos e pontuação corretos, sem erros de grafia e sem adicionar nenhum outro texto:\n"""\n${texto}\n"""`
    );
  } else {
    linhas.push("Não escreva nenhum texto, letra, número ou legenda na imagem, a menos que o pedido peça.");
  }

  if (marca?.estilo.trim()) {
    linhas.push(`Identidade visual da marca "${opts.nomeConta}" (respeite): ${marca.estilo.trim()}`);
  }

  linhas.push(`Formato: proporção ${f.aspecto} (${f.largura}x${f.altura}), preenchendo todo o quadro, sem bordas nem molduras.`);
  if (formato === "story") {
    linhas.push(
      "Layout de Story do Instagram: mantenha o conteúdo e os textos importantes na área central; deixe a faixa do topo (cerca de 14%) e a do rodapé (cerca de 20%) sem informações importantes, pois a interface do Instagram cobre essas áreas."
    );
  }

  if (usarLogo && marca?.logo_path) {
    linhas.push(
      `NÃO desenhe nenhum logotipo, marca d'água ou símbolo de marca na imagem. Deixe a região do ${NOME_POSICAO[marca.logo_posicao]} limpa e sem elementos importantes — o logo oficial será colocado ali depois, por fora.`
    );
  }

  return linhas.join("\n\n");
}

// Redimensiona pro tamanho final do formato e, se pedido, COLA o logo por
// cima. O logo nunca passa pelo modelo: é o arquivo original enviado pelo
// Victor, só escalado proporcionalmente pro tamanho escolhido (sem corte,
// sem filtro, sem recolorir). Mantém o metadado que o sharp consegue manter
// (nada é removido de propósito).
export async function finalizarImagem(
  bruta: Buffer,
  formato: FormatoId,
  logo: { buffer: Buffer; posicao: PosicaoLogo; tamanhoPct: number; margemPct: number } | null
): Promise<Buffer> {
  const f = FORMATOS[formato];
  let pipeline = sharp(bruta).keepMetadata().resize(f.largura, f.altura, { fit: "cover", position: "centre" });

  if (logo) {
    const larguraAlvo = Math.max(8, Math.round((f.largura * logo.tamanhoPct) / 100));
    const alturaMax = Math.round(f.altura * 0.35);
    const logoRedim = await sharp(logo.buffer)
      .resize({ width: larguraAlvo, height: alturaMax, fit: "inside", kernel: "lanczos3" })
      .png()
      .toBuffer({ resolveWithObject: true });

    const w = logoRedim.info.width;
    const h = logoRedim.info.height;
    const margem = Math.round((f.largura * logo.margemPct) / 100);

    const [v, hz] = logo.posicao === "centro" ? ["centro", "centro"] : logo.posicao.split("-");
    const top = v === "superior" ? margem : v === "inferior" ? f.altura - h - margem : Math.round((f.altura - h) / 2);
    const left =
      hz === "esquerdo" ? margem : hz === "direito" ? f.largura - w - margem : Math.round((f.largura - w) / 2);

    // Resolve o resize antes pra compor sobre os pixels já no tamanho final.
    const base = await pipeline.png().toBuffer();
    pipeline = sharp(base).keepMetadata().composite([{ input: logoRedim.data, top: Math.max(0, top), left: Math.max(0, left) }]);
  }

  return pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
}

export async function carregarMarca(admin: SupabaseClient, accountId: string): Promise<MarcaConfig | null> {
  const { data } = await admin.from("gerador_marca").select("*").eq("account_id", accountId).maybeSingle();
  return (data as MarcaConfig | null) ?? null;
}

export async function baixarDoBucket(admin: SupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await admin.storage.from(BUCKET_GERADOR).download(path);
  if (error || !data) throw new Error("Não consegui ler o arquivo salvo.");
  return Buffer.from(await data.arrayBuffer());
}
