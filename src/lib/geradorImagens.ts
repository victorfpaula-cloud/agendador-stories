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

// Direção tipográfica por estilo. Sem isso o modelo cai numa fonte genérica com
// contorno (o que aconteceu no primeiro teste) — aqui o pedido de lettering
// vira uma direção de arte de designer.
export const ESTILOS_LETTERING = {
  auto: {
    rotulo: "Automático",
    descricao: "Escolha a tipografia e o tratamento mais sofisticados e adequados ao tema, como um designer sênior de identidade visual faria.",
  },
  elegante: {
    rotulo: "Elegante dourado",
    descricao:
      "Lettering elegante e sofisticado: serifada de alto contraste (estilo Didone/Playfair), maiúsculas com espaçamento generoso entre letras (tracking amplo), acabamento em dourado metálico fosco com brilho sutil e fino, sem contorno.",
  },
  caligrafico: {
    rotulo: "Caligráfico",
    descricao:
      "Lettering caligráfico em script fluido e artesanal (pincel ou ponta fina), com traços de espessura variável e floreios discretos, combinado com uma sans-serif pequena, em maiúsculas espaçadas, como texto de apoio.",
  },
  moderno: {
    rotulo: "Moderno bold",
    descricao:
      "Tipografia moderna e ousada: sans-serif geométrica ou condensada em negrito, maiúsculas, hierarquia forte entre título grande e subtítulo pequeno, alinhamento limpo, cor sólida de alto contraste.",
  },
  neon: {
    rotulo: "Neon",
    descricao:
      "Letreiro de neon realista: tubos luminosos com brilho (glow) suave, reflexo na superfície próxima e leve halo de luz, em cores vibrantes sobre área escura.",
  },
  vintage: {
    rotulo: "Retrô / vintage",
    descricao:
      "Lettering retrô de cartaz ou rótulo antigo: slab serif ou letras de pintor de letreiros (sign painter), leve textura de impressão, paleta quente e levemente desbotada, com filetes e pequenos ornamentos.",
  },
  tridimensional: {
    rotulo: "3D",
    descricao:
      "Letras 3D volumétricas com profundidade, chanfro e iluminação realista, parecendo objetos físicos integrados à cena, com sombra de contato correta.",
  },
  minimalista: {
    rotulo: "Minimalista",
    descricao:
      "Tipografia minimalista e refinada: fonte leve e fina, bastante respiro, texto pequeno e precisamente posicionado, cor sutil, estética de revista de luxo.",
  },
  rustico: {
    rotulo: "Rústico artesanal",
    descricao:
      "Lettering rústico artesanal: manuscrito de giz em lousa, letras de madeira ou ferro forjado, aspecto autêntico e acolhedor de bar/restaurante.",
  },
} as const;
export type EstiloLetteringId = keyof typeof ESTILOS_LETTERING;
export function ehEstiloLettering(v: unknown): v is EstiloLetteringId {
  return typeof v === "string" && v in ESTILOS_LETTERING;
}

// Quando há texto na imagem, o modelo Rápido erra letras e desenha mal —
// força o Premium (Nano Banana Pro), que é o bom em tipografia.
export function exigePremium(modo: ModoId, textoExato: string): boolean {
  return modo === "lettering" || textoExato.trim().length > 0;
}

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
  estiloLettering: EstiloLetteringId;
}): string {
  const { modo, formato, pedido, textoExato, marca, usarLogo, qtdReferencias, estiloLettering } = opts;
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
    const direcao =
      modo === "editar" && estiloLettering === "auto"
        ? "Mantenha o estilo de lettering já existente na imagem, só corrigindo/alterando o texto conforme pedido."
        : ESTILOS_LETTERING[estiloLettering].descricao;
    linhas.push(
      `TEXTO NA IMAGEM — escreva exatamente o texto abaixo, letra por letra, em português, com acentos e pontuação corretos, sem erros de grafia e sem adicionar nenhum outro texto:\n"""\n${texto}\n"""`
    );
    linhas.push(
      `DIREÇÃO DE LETTERING: ${direcao}\n` +
        "Trate o texto como o elemento principal de um cartaz publicitário profissional feito por um designer gráfico premiado: hierarquia tipográfica clara (se houver mais de uma linha, título maior e complemento menor), kerning e espaçamento entrelinhas refinados, ótima legibilidade e contraste sobre o fundo (posicione o texto numa área calma da imagem; se precisar, use um degradê ou escurecimento sutil localizado atrás), margens seguras. Integre o texto à cena com iluminação, sombras e profundidade coerentes. PROIBIDO: contorno grosso, sombra pesada, efeito WordArt, fonte padrão de editor de texto, letras achatadas coladas por cima, texto torto ou cortado."
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
