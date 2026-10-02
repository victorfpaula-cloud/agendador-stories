import sharp from "sharp";
import { renderizarTexto, type OpcoesTexto, type PosicaoTexto } from "./tipografia";
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
  angulo: "Novo ângulo / enquadramento",
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
    descricao:
      "Choose the most sophisticated, on-brand typographic treatment for this subject, the way a senior brand designer would: one expressive display typeface for the headline paired with one small, widely tracked supporting sans-serif.",
  },
  elegante: {
    rotulo: "Elegante dourado",
    descricao:
      "High-contrast Didone serif (Bodoni / Playfair Display feel) with hairline serifs and thick stems, ALL CAPS, wide letter-spacing, finished in brushed gold-leaf foil with soft specular highlights and a subtle emboss; the supporting line in a thin, spaced-out sans-serif; a hairline gold divider between them.",
  },
  caligrafico: {
    rotulo: "Caligráfico",
    descricao:
      "Hand-lettered brush-pen calligraphy script with fluid connected strokes, natural thick-thin stroke contrast and a few restrained flourishes, in warm cream ink; paired with a tiny, widely tracked uppercase sans-serif for the secondary line.",
  },
  moderno: {
    rotulo: "Moderno bold",
    descricao:
      "Bold modern poster typography: ultra-condensed heavy grotesque sans-serif (Anton / Bebas Neue feel), ALL CAPS, tight leading, strong scale contrast between the huge headline and a small tracked subtitle in one accent color; flat solid color, razor-clean edges.",
  },
  neon: {
    rotulo: "Neon",
    descricao:
      "Realistic glass-tube neon sign lettering in a monoline script, with a warm inner glow, a soft halo bleeding onto nearby surfaces, small tube mounts, and reflections on the surface below.",
  },
  vintage: {
    rotulo: "Retrô / vintage",
    descricao:
      "Retro vintage poster lettering: fat-face or slab serif in sign-painter style, cream white with a hard offset drop shadow in deep red, subtle printed-paper grain and slight ink wear; thin double rules and small ornaments.",
  },
  tridimensional: {
    rotulo: "3D",
    descricao:
      "Chunky 3D lettering that looks like a real physical object (glossy inflated, carved or ceramic), with bevels, true volume, contact shadows and reflections matching the scene's light.",
  },
  minimalista: {
    rotulo: "Minimalista",
    descricao:
      "Refined editorial minimalism: ultra-light high-contrast serif (Cormorant feel) in widely tracked capitals, a tiny supporting sans-serif line, generous negative space, a single calm color.",
  },
  rustico: {
    rotulo: "Rústico artesanal",
    descricao:
      "Authentic rustic lettering: chalk hand-lettering on a blackboard, or branded wood / forged-iron letters, slight irregularity, dusty texture, warm tavern feel.",
  },
} as const;
export type EstiloLetteringId = keyof typeof ESTILOS_LETTERING;
export function ehEstiloLettering(v: unknown): v is EstiloLetteringId {
  return typeof v === "string" && v in ESTILOS_LETTERING;
}

// Posições de câmera do modo "Novo ângulo".
export const ANGULOS = {
  macro: {
    rotulo: "Macro (bem de perto)",
    descricao:
      "fotografia MACRO extrema: câmera muito próxima do prato, lente macro 100mm, enquadrando só uma parte do prato e preenchendo o quadro com textura e detalhes (brilho, vapor, molhos, grãos), profundidade de campo bem rasa com o fundo e as bordas bem desfocados",
  },
  tres_quartos: {
    rotulo: "45° (3/4)",
    descricao:
      "câmera a cerca de 45 graus acima do prato (ângulo clássico de cardápio/delivery), mostrando o topo e a lateral do prato, leve profundidade de campo",
  },
  topo: {
    rotulo: "De cima (flat lay)",
    descricao: "visto diretamente de cima (90 graus, flat lay), composição organizada em torno do prato, com a mesa e os utensílios ao redor",
  },
  rente: {
    rotulo: "Rente à mesa",
    descricao:
      "câmera baixa, na altura do prato (ângulo frontal rente à mesa), mostrando as camadas e a altura da comida, com fundo desfocado ao fundo",
  },
  livre: {
    rotulo: "Do jeito que eu pedir",
    descricao: "o ponto de vista descrito no pedido abaixo",
  },
} as const;
export type AnguloId = keyof typeof ANGULOS;
export function ehAngulo(v: unknown): v is AnguloId {
  return typeof v === "string" && v in ANGULOS;
}

// Quando a IA desenha o texto, o modelo Rápido erra letras e desenha mal —
// força o Premium (Nano Banana Pro), que é o bom em tipografia.
// O mesmo vale pra qualquer trabalho com imagem de referência (produto,
// ângulo, estilo): o Premium segue instruções e mantém a identidade do
// objeto bem melhor.
export function exigePremium(modo: ModoId, textoNaIA: boolean, temReferencia: boolean): boolean {
  return (
    modo === "produto" ||
    modo === "angulo" ||
    textoNaIA ||
    (temReferencia && modo !== "editar")
  );
}

// Detecta quando o modelo devolveu a própria referência (quase) sem mudar:
// compara miniaturas 48x48 em tons de cinza. Imagem nova do mesmo prato
// de outro ângulo difere bastante; cópia fica abaixo de ~9/255.
export async function quaseIgual(a: Buffer, b: Buffer): Promise<boolean> {
  try {
    const mini = (x: Buffer) => sharp(x).resize(48, 48, { fit: "fill" }).greyscale().raw().toBuffer();
    const [ma, mb] = await Promise.all([mini(a), mini(b)]);
    let soma = 0;
    for (let i = 0; i < ma.length; i++) soma += Math.abs(ma[i] - mb[i]);
    return soma / ma.length < 9;
  } catch {
    return false;
  }
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
  angulo?: AnguloId;
  reforcoAnticopia?: boolean;
  // "camada": o texto NÃO é desenhado pela IA — o app escreve depois com
  // fontes de verdade (src/lib/tipografia.ts); a IA só reserva o espaço.
  textoNaCamada?: boolean;
  posicaoTexto?: PosicaoTexto;
}): string {
  const { modo, formato, pedido, textoExato, marca, usarLogo, qtdReferencias, estiloLettering } = opts;
  const angulo = opts.angulo ?? "livre";
  const f = FORMATOS[formato];
  const linhas: string[] = [];

  if (modo === "produto") {
    linhas.push(
      "Você é um fotógrafo publicitário. A primeira imagem anexada é o PRODUTO REAL. Preserve o produto exatamente como é: forma, proporções, cores, rótulo, embalagem e qualquer logotipo ou texto impresso nele — não redesenhe, não invente detalhes, não troque a marca. Melhore apenas o entorno: iluminação, fundo, cenário, sombras, reflexos e composição, com qualidade de foto profissional de catálogo. O resultado NÃO pode ser a mesma foto de entrada: o cenário, a luz e a composição precisam ficar claramente melhores e diferentes."
    );
  } else if (modo === "angulo") {
    linhas.push(
      `A imagem anexada mostra o prato/produto REAL. Crie uma FOTOGRAFIA NOVA do MESMO prato/produto, tirada de outra posição de câmera: ${ANGULOS[angulo].descricao}.\n` +
        "A imagem final NÃO pode ser cópia, recorte ou ampliação simples da foto anexada: o ponto de vista, a perspectiva, o enquadramento e a profundidade de campo devem ser claramente diferentes dela. " +
        "Mantenha a identidade do prato: mesmos ingredientes, mesma disposição, mesmas cores, texturas, louça/embalagem e rótulos — como se o fotógrafo tivesse girado a câmera em volta do mesmo prato, no mesmo instante. Reconstrua com realismo as partes que passam a ficar visíveis ou escondidas nessa nova perspectiva, com iluminação e reflexos coerentes. Não adicione, remova nem troque ingredientes."
    );
  } else if (modo === "editar") {
    linhas.push(
      "A primeira imagem anexada é a imagem a ser editada. Aplique SOMENTE a alteração pedida abaixo e mantenha todo o resto idêntico (composição, cores, textos, rostos, objetos, estilo)."
    );
  } else if (modo === "lettering" && opts.textoNaCamada) {
    linhas.push("Crie a arte visual de fundo (cenário, objetos, luz) para uma arte de rede social. O texto será aplicado depois por fora.");
  } else if (modo === "lettering") {
    linhas.push(
      "Crie uma arte gráfica de redes sociais com tipografia/lettering de alto nível: hierarquia visual clara, texto grande, legível e bem integrado ao design."
    );
  } else {
    linhas.push("Crie uma imagem de alta qualidade para redes sociais (Instagram).");
  }

  if (pedido.trim()) linhas.push(modo === "angulo" ? `Observações do cliente: ${pedido.trim()}` : `Pedido: ${pedido.trim()}`);

  if (qtdReferencias > 0 && modo !== "produto" && modo !== "editar" && modo !== "angulo") {
    linhas.push(
      `Há ${qtdReferencias} imagem(ns) de referência anexada(s): use-as como referência visual (estilo, produto, pessoa, objeto, composição) conforme o pedido, mantendo fidelidade ao que aparece nelas. Mas a imagem final deve ser uma criação NOVA que cumpra o pedido — nunca devolva a referência igual ou apenas recortada.`
    );
  }

  if (opts.reforcoAnticopia) {
    linhas.push(
      "ATENÇÃO: a tentativa anterior devolveu a imagem de referência praticamente idêntica, o que é inaceitável. Gere uma imagem NOVA, com ponto de vista de câmera, enquadramento e perspectiva radicalmente diferentes da referência, mantendo apenas a identidade do objeto/prato."
    );
  }

  const texto = textoExato.trim();
  if (texto && opts.textoNaCamada) {
    const faixa = opts.posicaoTexto === "topo" ? "do TOPO" : opts.posicaoTexto === "baixo" ? "do terço INFERIOR" : "do CENTRO";
    linhas.push(
      `Não escreva NENHUM texto, letra, número ou símbolo na imagem. Deixe livre, calma e sem elementos importantes a faixa ${faixa} do quadro (cerca de 30% da altura): um título será aplicado ali depois, por fora. Componha o assunto principal fora dessa faixa, com uma área de fundo limpa e de tonalidade uniforme nela.`
    );
  } else if (texto) {
    const direcao =
      modo === "editar" && estiloLettering === "auto"
        ? "Keep the lettering style already present in the image; only correct/change the text as requested."
        : ESTILOS_LETTERING[estiloLettering].descricao;
    linhas.push(
      [
        "=== TYPOGRAPHY BRIEF — this lettering is the hero of the design ===",
        'Text to render, in Brazilian Portuguese. Reproduce it EXACTLY, character by character, keeping every accent (ã, õ, é, ê, ç, ...) and all punctuation. Do not translate, abbreviate, add or omit any word:',
        `"""\n${texto}\n"""`,
        `Lettering style: ${direcao}`,
        "Craft rules:",
        "- If there are several lines: the first line is the headline (largest); the following lines are secondary (about 25–35% of the headline size) with a clear hierarchy.",
        "- Use at most two typefaces. Optical kerning, balanced leading, comfortable margins (at least 8% from every edge).",
        "- Razor sharp and fully legible at phone size: strong value contrast against the background; place the text over a calm area of the image, or add a soft localized darkening behind it.",
        "- Integrate the lettering with the scene: same light direction, color temperature, depth of field and perspective (cast shadows, reflections, material interaction).",
        "- Before finishing, re-read each word of the supplied text and fix any misspelled or malformed letter.",
        "- FORBIDDEN: thick outline/stroke around the letters, heavy generic drop shadow, WordArt or preset gradients, default system fonts, flat stickers pasted on top, extra words, watermarks, gibberish text.",
      ].join("\n")
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

// Redimensiona pro tamanho final do formato (a "base": arte da IA, sem texto
// e sem logo). Mantém o metadado que o sharp consegue manter (nada é
// removido de propósito).
export async function prepararBase(bruta: Buffer, formato: FormatoId): Promise<Buffer> {
  const f = FORMATOS[formato];
  return sharp(bruta)
    .keepMetadata()
    .resize(f.largura, f.altura, { fit: "cover", position: "centre" })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

export type LogoParaColar = { buffer: Buffer; posicao: PosicaoLogo; tamanhoPct: number; margemPct: number };

// Monta a imagem final sobre a base: (1) texto com fontes de verdade, se
// houver; (2) o logo COLADO por cima. O logo nunca passa pelo modelo: é o
// arquivo original enviado pelo Victor, só escalado proporcionalmente pro
// tamanho escolhido (sem corte, sem filtro, sem recolorir).
export async function comporFinal(
  base: Buffer,
  formato: FormatoId,
  texto: OpcoesTexto | null,
  logo: LogoParaColar | null
): Promise<Buffer> {
  const f = FORMATOS[formato];
  const camadas: { input: Buffer; top: number; left: number }[] = [];

  if (texto && texto.texto.trim()) {
    camadas.push({ input: await renderizarTexto(f.largura, f.altura, texto), top: 0, left: 0 });
  }

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

    camadas.push({ input: logoRedim.data, top: Math.max(0, top), left: Math.max(0, left) });
  }

  if (camadas.length === 0) return base;
  return sharp(base).keepMetadata().composite(camadas).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
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
