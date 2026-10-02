import sharp from "sharp";
import * as opentype from "opentype.js";
import { FONTES_BASE64 } from "./fontesDados";

// Motor de tipografia: escreve o texto da arte com FONTES DE VERDADE (curvas
// vetoriais, kerning, espaçamento entre letras, degradê, sombra, glow), em
// vez de pedir pra IA desenhar as letras — a IA erra ortografia e improvisa
// um estilo feio. A IA faz só a arte de fundo; este módulo cola o texto por
// cima, nítido e idêntico ao que o Victor digitou.
//
// O texto vira caminhos (paths) SVG e o sharp rasteriza — não depende de
// nenhuma fonte instalada no servidor.

export const TEMAS_TEXTO = {
  elegante: "Elegante dourado",
  classico: "Clássico serifado",
  caligrafico: "Caligráfico",
  moderno: "Moderno impacto",
  neon: "Neon",
  vintage: "Retrô / vintage",
  minimalista: "Minimalista",
  rustico: "Rústico (giz)",
} as const;
export type TemaTextoId = keyof typeof TEMAS_TEXTO;
export function ehTemaTexto(v: unknown): v is TemaTextoId {
  return typeof v === "string" && v in TEMAS_TEXTO;
}

export type PosicaoTexto = "topo" | "centro" | "baixo";
export function ehPosicaoTexto(v: unknown): v is PosicaoTexto {
  return v === "topo" || v === "centro" || v === "baixo";
}

export type OpcoesTexto = {
  texto: string;
  tema: TemaTextoId;
  posicao: PosicaoTexto;
  tamanhoPct: number; // tamanho base do título, em % da largura (6–22)
  cor: string | null; // #rrggbb; null = cor do tema
  veu: boolean; // escurecimento suave atrás do texto, pra dar contraste
};

type Sombra = { dx: number; dy: number; blur: number; cor: string; op: number };
type Tema = {
  titulo: {
    fonte: string;
    caixaAlta: boolean;
    tracking: number; // em "em"
    escala: number;
    fill: string[]; // 1 cor = sólido; 2+ = degradê vertical
    entrelinha: number;
    sombra?: Sombra;
    glow?: string;
  };
  subtitulo: { fonte: string; tracking: number; escala: number; cor: string; sombra?: Sombra; glow?: string };
  ornamento: "nenhum" | "linha" | "barra" | "dupla";
  corOrnamento: string;
};

const TEMAS: Record<TemaTextoId, Tema> = {
  elegante: {
    titulo: {
      fonte: "playfair700", caixaAlta: true, tracking: 0.05, escala: 1,
      fill: ["#fbe9a3", "#d8a93a", "#f6dd8a", "#a9741a"], entrelinha: 1.12,
      sombra: { dx: 0, dy: 4, blur: 6, cor: "#000000", op: 0.55 },
    },
    subtitulo: { fonte: "montserrat300", tracking: 0.32, escala: 0.26, cor: "#f7efdc", sombra: { dx: 0, dy: 2, blur: 4, cor: "#000000", op: 0.6 } },
    ornamento: "linha", corOrnamento: "#d8a93a",
  },
  classico: {
    titulo: {
      fonte: "cinzel700", caixaAlta: true, tracking: 0.08, escala: 0.92,
      fill: ["#ffffff"], entrelinha: 1.15,
      sombra: { dx: 0, dy: 3, blur: 7, cor: "#000000", op: 0.55 },
    },
    subtitulo: { fonte: "montserrat300", tracking: 0.34, escala: 0.24, cor: "#ffffff", sombra: { dx: 0, dy: 2, blur: 4, cor: "#000000", op: 0.6 } },
    ornamento: "dupla", corOrnamento: "#ffffff",
  },
  caligrafico: {
    titulo: {
      fonte: "greatvibes", caixaAlta: false, tracking: 0, escala: 1.4,
      fill: ["#fff6e5"], entrelinha: 1.0,
      sombra: { dx: 0, dy: 3, blur: 6, cor: "#000000", op: 0.6 },
    },
    subtitulo: { fonte: "montserrat500", tracking: 0.3, escala: 0.22, cor: "#fff6e5", sombra: { dx: 0, dy: 2, blur: 4, cor: "#000000", op: 0.6 } },
    ornamento: "nenhum", corOrnamento: "#fff6e5",
  },
  moderno: {
    titulo: {
      fonte: "anton", caixaAlta: true, tracking: 0.02, escala: 1.18,
      fill: ["#ffffff"], entrelinha: 1.02,
      sombra: { dx: 0, dy: 6, blur: 10, cor: "#000000", op: 0.5 },
    },
    subtitulo: { fonte: "montserrat600", tracking: 0.22, escala: 0.24, cor: "#ffd23f", sombra: { dx: 0, dy: 2, blur: 5, cor: "#000000", op: 0.6 } },
    ornamento: "barra", corOrnamento: "#ffd23f",
  },
  neon: {
    titulo: { fonte: "pacifico", caixaAlta: false, tracking: 0.01, escala: 1.0, fill: ["#ffffff"], entrelinha: 1.1, glow: "#ff2d95" },
    subtitulo: { fonte: "montserrat500", tracking: 0.28, escala: 0.24, cor: "#c9fbff", glow: "#22d3ee" },
    ornamento: "nenhum", corOrnamento: "#22d3ee",
  },
  vintage: {
    titulo: {
      fonte: "abril", caixaAlta: true, tracking: 0.03, escala: 0.95,
      fill: ["#f5e6bf"], entrelinha: 1.1,
      sombra: { dx: 5, dy: 5, blur: 0, cor: "#7a1f12", op: 1 },
    },
    subtitulo: { fonte: "oswald500", tracking: 0.25, escala: 0.28, cor: "#f5e6bf", sombra: { dx: 0, dy: 2, blur: 4, cor: "#000000", op: 0.6 } },
    ornamento: "dupla", corOrnamento: "#f5e6bf",
  },
  minimalista: {
    titulo: {
      fonte: "cormorant300", caixaAlta: true, tracking: 0.22, escala: 0.85,
      fill: ["#ffffff"], entrelinha: 1.2,
      sombra: { dx: 0, dy: 2, blur: 8, cor: "#000000", op: 0.4 },
    },
    subtitulo: { fonte: "montserrat300", tracking: 0.38, escala: 0.2, cor: "#ffffff", sombra: { dx: 0, dy: 2, blur: 6, cor: "#000000", op: 0.45 } },
    ornamento: "nenhum", corOrnamento: "#ffffff",
  },
  rustico: {
    titulo: {
      fonte: "marker", caixaAlta: false, tracking: 0.01, escala: 0.9,
      fill: ["#f4f1e8"], entrelinha: 1.1,
      sombra: { dx: 0, dy: 3, blur: 5, cor: "#000000", op: 0.6 },
    },
    subtitulo: { fonte: "oswald500", tracking: 0.2, escala: 0.3, cor: "#f4f1e8", sombra: { dx: 0, dy: 2, blur: 4, cor: "#000000", op: 0.6 } },
    ornamento: "nenhum", corOrnamento: "#f4f1e8",
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fonte = any;
const cacheFontes = new Map<string, Fonte>();
function fonte(chave: string): Fonte {
  let f = cacheFontes.get(chave);
  if (!f) {
    const b64 = FONTES_BASE64[chave];
    if (!b64) throw new Error(`Fonte desconhecida: ${chave}`);
    const buf = Buffer.from(b64, "base64");
    f = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    cacheFontes.set(chave, f);
  }
  return f;
}

// Layout "manual" (glifo a glifo): o shaping interno do opentype.js quebra com
// algumas fontes (tabela GSUB de formatos raros, ex.: Great Vibes, Abril
// Fatface). Aqui só usamos o glifo de cada letra + kerning + espaçamento.
function kern(f: Fonte, a: Fonte, b: Fonte): number {
  try {
    return f.getKerningValue(a, b) || 0;
  } catch {
    return 0;
  }
}

function glifos(f: Fonte, txt: string): Fonte[] {
  return Array.from(txt).map((ch) => f.charToGlyph(ch));
}

// Serialização própria do caminho SVG, com separadores explícitos: o
// toPathData() do opentype.js gera números colados ("34-1.90L34 0") e o
// rasterizador do sharp (librsvg) descartava letras no meio da frase.
const num = (v: number) => String(Math.round(v * 100) / 100);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dadosDoCaminho(cmds: any[]): string {
  return cmds
    .map((c) => {
      if (c.type === "M" || c.type === "L") return `${c.type} ${num(c.x)} ${num(c.y)} `;
      if (c.type === "Q") return `Q ${num(c.x1)} ${num(c.y1)} ${num(c.x)} ${num(c.y)} `;
      if (c.type === "C") return `C ${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)} `;
      return "Z ";
    })
    .join("");
}

function largura(f: Fonte, txt: string, tam: number, tracking: number): number {
  const gs = glifos(f, txt);
  const e = tam / f.unitsPerEm;
  let x = 0;
  gs.forEach((g, i) => {
    x += (g.advanceWidth || 0) * e;
    if (i < gs.length - 1) x += kern(f, g, gs[i + 1]) * e + tracking * tam;
  });
  return x;
}

function quebrar(f: Fonte, txt: string, tam: number, tracking: number, maxW: number): { linhas: string[]; cabe: boolean } {
  const palavras = txt.split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = "";
  let cabe = true;
  for (const p of palavras) {
    if (largura(f, p, tam, tracking) > maxW) cabe = false;
    const tentativa = atual ? `${atual} ${p}` : p;
    if (!atual || largura(f, tentativa, tam, tracking) <= maxW) atual = tentativa;
    else {
      linhas.push(atual);
      atual = p;
    }
  }
  if (atual) linhas.push(atual);
  return { linhas, cabe };
}

const esc = (n: number) => Math.round(n * 100) / 100;

export async function renderizarTexto(W: number, H: number, o: OpcoesTexto): Promise<Buffer> {
  const tema = TEMAS[o.tema];
  const todas = o.texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (todas.length === 0) return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();

  const tituloTxt = tema.titulo.caixaAlta ? todas[0].toLocaleUpperCase("pt-BR") : todas[0];
  const subTxts = todas.slice(1).map((l) => l.toLocaleUpperCase("pt-BR"));

  const fT = fonte(tema.titulo.fonte);
  const fS = fonte(tema.subtitulo.fonte);
  const maxW = W * 0.84;
  const base = (Math.min(22, Math.max(6, o.tamanhoPct)) / 100) * W;

  // Reduz o tamanho até o título caber em até 3 linhas sem estourar a largura.
  let fator = 1;
  let titulo: string[] = [];
  let subs: string[] = [];
  for (let i = 0; i < 40; i++) {
    const tam = base * tema.titulo.escala * fator;
    const t = quebrar(fT, tituloTxt, tam, tema.titulo.tracking, maxW);
    const stam = base * tema.subtitulo.escala * fator;
    const s = subTxts.map((l) => quebrar(fS, l, stam, tema.subtitulo.tracking, maxW));
    if (t.cabe && t.linhas.length <= 3 && s.every((x) => x.cabe && x.linhas.length <= 2)) {
      titulo = t.linhas;
      subs = s.flatMap((x) => x.linhas);
      break;
    }
    titulo = t.linhas;
    subs = s.flatMap((x) => x.linhas);
    fator *= 0.93;
  }
  const tamT = base * tema.titulo.escala * fator;
  const tamS = base * tema.subtitulo.escala * fator;

  const lhT = tamT * tema.titulo.entrelinha;
  const lhS = tamS * 1.55;
  const gapOrn = subs.length ? tamT * 0.5 : 0;
  const alturaBloco = titulo.length * lhT + gapOrn + subs.length * lhS;

  // Zona segura vertical (Story deixa topo e rodapé livres pra interface do Instagram).
  const story = H / W >= 1.7;
  const zTop = story ? H * 0.14 : H * 0.07;
  const zBot = story ? H * 0.8 : H * 0.93;
  const zH = zBot - zTop;
  const centro = o.posicao === "topo" ? zTop + zH * 0.22 : o.posicao === "baixo" ? zTop + zH * 0.78 : zTop + zH * 0.5;
  const topoBloco = Math.min(Math.max(centro - alturaBloco / 2, zTop), zBot - alturaBloco);

  const corSolida = o.cor && /^#[0-9a-fA-F]{6}$/.test(o.cor) ? o.cor : null;
  const fillTitulo = corSolida ? [corSolida] : tema.titulo.fill;
  const corOrn = corSolida ?? tema.corOrnamento;
  const glowT = corSolida ?? tema.titulo.glow;

  const defs: string[] = [];
  const corpo: string[] = [];

  if (fillTitulo.length > 1) {
    const stops = fillTitulo.map((c, i) => `<stop offset="${(i / (fillTitulo.length - 1)) * 100}%" stop-color="${c}"/>`).join("");
    defs.push(`<linearGradient id="fill" gradientUnits="userSpaceOnUse" x1="0" y1="${esc(topoBloco)}" x2="0" y2="${esc(topoBloco + titulo.length * lhT)}">${stops}</linearGradient>`);
  }
  const fillAttr = fillTitulo.length > 1 ? "url(#fill)" : fillTitulo[0];

  const filtroSombra = (id: string, s: Sombra) =>
    `<filter id="${id}" x="-20%" y="-30%" width="140%" height="170%"><feGaussianBlur in="SourceAlpha" stdDeviation="${s.blur}"/><feOffset dx="${s.dx}" dy="${s.dy}" result="o"/><feFlood flood-color="${s.cor}" flood-opacity="${s.op}"/><feComposite in2="o" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const filtroBlur = (id: string, r: number) =>
    `<filter id="${id}" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="${r}"/></filter>`;

  if (tema.titulo.sombra) defs.push(filtroSombra("sT", tema.titulo.sombra));
  if (tema.subtitulo.sombra) defs.push(filtroSombra("sS", tema.subtitulo.sombra));
  defs.push(filtroBlur("gA", tamT * 0.18), filtroBlur("gB", tamT * 0.06), filtroBlur("gSA", tamS * 0.35), filtroBlur("gSB", tamS * 0.12));

  // Véu: escurecimento suave atrás do bloco (ajuda o contraste sobre fotos claras).
  if (o.veu) {
    const pad = alturaBloco * 0.55;
    const y0 = Math.max(0, topoBloco - pad);
    const y1 = Math.min(H, topoBloco + alturaBloco + pad);
    defs.push(
      `<linearGradient id="veu" gradientUnits="userSpaceOnUse" x1="0" y1="${esc(y0)}" x2="0" y2="${esc(y1)}"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.35" stop-color="#000" stop-opacity="0.42"/><stop offset="0.65" stop-color="#000" stop-opacity="0.42"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`
    );
    corpo.push(`<rect x="0" y="${esc(y0)}" width="${W}" height="${esc(y1 - y0)}" fill="url(#veu)"/>`);
  }

  const caminho = (f: Fonte, txt: string, tam: number, tracking: number, baseline: number): string => {
    const gs = glifos(f, txt);
    const e = tam / f.unitsPerEm;
    let x = (W - largura(f, txt, tam, tracking)) / 2;
    const partes: string[] = [];
    gs.forEach((g, i) => {
      partes.push(dadosDoCaminho(g.getPath(x, baseline, tam).commands));
      x += (g.advanceWidth || 0) * e;
      if (i < gs.length - 1) x += kern(f, g, gs[i + 1]) * e + tracking * tam;
    });
    return partes.join(" ");
  };

  // Título
  let y = topoBloco;
  const dsT: string[] = [];
  for (const l of titulo) {
    dsT.push(caminho(fT, l, tamT, tema.titulo.tracking, y + tamT * 0.82 + (lhT - tamT) / 2));
    y += lhT;
  }
  const dT = dsT.join(" ");
  if (glowT) {
    corpo.push(`<path d="${dT}" fill="${glowT}" filter="url(#gA)" opacity="0.95"/>`);
    corpo.push(`<path d="${dT}" fill="${glowT}" filter="url(#gB)"/>`);
    corpo.push(`<path d="${dT}" fill="${fillAttr}"/>`);
  } else {
    corpo.push(`<path d="${dT}" fill="${fillAttr}"${tema.titulo.sombra ? ' filter="url(#sT)"' : ""}/>`);
  }

  // Ornamento entre título e subtítulo (ou em volta do título, no estilo "dupla")
  const linhaW = W * 0.16;
  const esp = Math.max(2, W * 0.0028);
  const yOrn = y + gapOrn * 0.5;
  if (tema.ornamento === "linha" && subs.length)
    corpo.push(`<rect x="${esc((W - linhaW) / 2)}" y="${esc(yOrn)}" width="${esc(linhaW)}" height="${esc(esp)}" fill="${corOrn}"/>`);
  if (tema.ornamento === "barra" && subs.length)
    corpo.push(`<rect x="${esc((W - linhaW * 0.5) / 2)}" y="${esc(yOrn - esp)}" width="${esc(linhaW * 0.5)}" height="${esc(esp * 3)}" fill="${corOrn}"/>`);
  if (tema.ornamento === "dupla") {
    const ww = Math.min(maxW, Math.max(...titulo.map((l) => largura(fT, l, tamT, tema.titulo.tracking))) * 1.05);
    for (const yy of [topoBloco - tamT * 0.18, topoBloco + titulo.length * lhT + tamT * 0.04])
      corpo.push(`<rect x="${esc((W - ww) / 2)}" y="${esc(yy)}" width="${esc(ww)}" height="${esc(esp)}" fill="${corOrn}"/>`);
  }

  // Subtítulo
  y += gapOrn;
  const dsS: string[] = [];
  for (const l of subs) {
    dsS.push(caminho(fS, l, tamS, tema.subtitulo.tracking, y + tamS * 0.9 + (lhS - tamS) / 2));
    y += lhS;
  }
  if (dsS.length) {
    const dS = dsS.join(" ");
    const glowS = corSolida ? null : tema.subtitulo.glow;
    if (glowS) {
      corpo.push(`<path d="${dS}" fill="${glowS}" filter="url(#gSA)" opacity="0.95"/>`);
      corpo.push(`<path d="${dS}" fill="${glowS}" filter="url(#gSB)"/>`);
      corpo.push(`<path d="${dS}" fill="${tema.subtitulo.cor}"/>`);
    } else {
      corpo.push(`<path d="${dS}" fill="${tema.subtitulo.cor}"${tema.subtitulo.sombra ? ' filter="url(#sS)"' : ""}/>`);
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join("")}</defs>${corpo.join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
