import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { DIAS_SEMANA, agoraEmSaoPaulo } from "@/lib/days";
import { AVISO_PARCIAL_PDF, type DiaContagem, type RelatorioConta, type RelatorioMensal } from "@/lib/relatorio";

// PDF de UMA conta, pronto pra salvar e mandar pro cliente (pedido do Victor
// em 30/09/2026): título, total do mês e a tabela simples dia + quantidade
// em duas colunas. Usa só as fontes padrão do PDF (sem arquivo de fonte),
// então o texto é limpo de qualquer caractere fora do alfabeto latino.
const LARGURA = 595.28;
const ALTURA = 841.89;
const MARGEM = 48;
const ALTURA_LINHA = 17;

const MARCA = rgb(0x3d / 255, 0x54 / 255, 0xe0 / 255);
const TEXTO = rgb(0.06, 0.09, 0.16);
const SUAVE = rgb(0.39, 0.45, 0.55);
const LINHA = rgb(0.89, 0.91, 0.94);
const FUNDO = rgb(0.97, 0.98, 0.99);
const FIM_DE_SEMANA = rgb(0.945, 0.96, 0.976);

const EXTRAS_WINANSI = new Set("–—‘’“”•…");
function seguro(texto: string): string {
  return [...texto]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return (c >= 32 && c < 127) || (c >= 160 && c <= 255) || EXTRAS_WINANSI.has(ch);
    })
    .join("");
}

type Contexto = { doc: PDFDocument; page: PDFPage; y: number; normal: PDFFont; negrito: PDFFont };

function texto(ctx: Contexto, t: string, x: number, y: number, tamanho: number, fonte: PDFFont, cor = TEXTO) {
  ctx.page.drawText(seguro(t), { x, y, size: tamanho, font: fonte, color: cor });
}

function textoADireita(ctx: Contexto, t: string, xDireita: number, y: number, tamanho: number, fonte: PDFFont, cor = TEXTO) {
  const limpo = seguro(t);
  ctx.page.drawText(limpo, { x: xDireita - fonte.widthOfTextAtSize(limpo, tamanho), y, size: tamanho, font: fonte, color: cor });
}

function rotuloDia(d: DiaContagem): string {
  const [, m, dia] = d.data.split("-");
  const nome = DIAS_SEMANA.find((x) => x.value === d.diaSemana)?.curto ?? "";
  return `${dia}/${m}  ·  ${nome}`;
}

function quebrarEmLinhas(t: string, fonte: PDFFont, tamanho: number, larguraMax: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of seguro(t).split(" ")) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(teste, tamanho) > larguraMax && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function novaPagina(ctx: Contexto) {
  ctx.page = ctx.doc.addPage([LARGURA, ALTURA]);
  ctx.y = ALTURA - MARGEM;
}

// Tabela "Dia | Quantidade" dividida em duas colunas lado a lado.
function tabelaDuasColunas(ctx: Contexto, titulo: string, rotuloColuna: string, dias: DiaContagem[]) {
  const meio = Math.ceil(dias.length / 2);
  const colunas = [dias.slice(0, meio), dias.slice(meio)];
  const altura = 26 + (meio + 1) * ALTURA_LINHA;
  if (ctx.y - altura < MARGEM + 30) novaPagina(ctx);

  texto(ctx, titulo, MARGEM, ctx.y - 12, 13, ctx.negrito);
  ctx.y -= 26;

  const larguraColuna = (LARGURA - MARGEM * 2 - 16) / 2;
  colunas.forEach((lista, i) => {
    if (lista.length === 0) return;
    const x = MARGEM + i * (larguraColuna + 16);
    let y = ctx.y;

    ctx.page.drawRectangle({ x, y: y - ALTURA_LINHA, width: larguraColuna, height: ALTURA_LINHA, color: FUNDO });
    texto(ctx, "DIA", x + 8, y - 12, 8, ctx.negrito, SUAVE);
    textoADireita(ctx, rotuloColuna.toUpperCase(), x + larguraColuna - 8, y - 12, 8, ctx.negrito, SUAVE);
    y -= ALTURA_LINHA;

    for (const d of lista) {
      if (d.diaSemana >= 6) {
        ctx.page.drawRectangle({ x, y: y - ALTURA_LINHA, width: larguraColuna, height: ALTURA_LINHA, color: FIM_DE_SEMANA });
      }
      ctx.page.drawLine({ start: { x, y: y - ALTURA_LINHA }, end: { x: x + larguraColuna, y: y - ALTURA_LINHA }, thickness: 0.5, color: LINHA });
      texto(ctx, rotuloDia(d), x + 8, y - 12, 10, ctx.normal);
      textoADireita(ctx, d.total === 0 ? "–" : String(d.total), x + larguraColuna - 8, y - 12, 10, ctx.negrito, d.total === 0 ? SUAVE : TEXTO);
      y -= ALTURA_LINHA;
    }
  });
  ctx.y -= (meio + 1) * ALTURA_LINHA + 24;
}

function caixaDeTotal(ctx: Contexto, x: number, largura: number, numero: number, rotulo: string) {
  ctx.page.drawRectangle({ x, y: ctx.y - 62, width: largura, height: 62, color: FUNDO, borderColor: LINHA, borderWidth: 0.7 });
  texto(ctx, String(numero), x + 14, ctx.y - 38, 28, ctx.negrito, MARCA);
  texto(ctx, rotulo, x + 14, ctx.y - 54, 9, ctx.normal, SUAVE);
}

export async function gerarPdfConta(r: RelatorioMensal, c: RelatorioConta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(seguro(`Relatório de ${r.rotuloMes} - ${c.nome}`));
  const ctx: Contexto = {
    doc,
    page: doc.addPage([LARGURA, ALTURA]),
    y: ALTURA - MARGEM,
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrito: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  texto(ctx, "AGENDADOR DE STORIES", MARGEM, ctx.y - 9, 9, ctx.negrito, MARCA);
  texto(ctx, `Relatório de ${r.rotuloMes}`, MARGEM, ctx.y - 36, 22, ctx.negrito);
  texto(ctx, c.nome, MARGEM, ctx.y - 62, 15, ctx.negrito);
  if (c.usuario) {
    const largNome = ctx.negrito.widthOfTextAtSize(seguro(c.nome), 15);
    texto(ctx, `@${c.usuario}`, MARGEM + largNome + 8, ctx.y - 62, 11, ctx.normal, SUAVE);
  }
  ctx.y -= 86;

  const temFeed = r.incluirFeed && c.totalFeed > 0;
  const larguraCaixa = temFeed ? (LARGURA - MARGEM * 2 - 16) / 2 : 200;
  caixaDeTotal(ctx, MARGEM, larguraCaixa, c.totalStories, "Stories no mês");
  if (temFeed) caixaDeTotal(ctx, MARGEM + larguraCaixa + 16, larguraCaixa, c.totalFeed, "Posts no Feed e Reels");
  ctx.y -= 84;

  tabelaDuasColunas(ctx, "Stories por dia", "Stories", c.stories);
  if (temFeed) tabelaDuasColunas(ctx, "Feed e Reels por dia", "Posts", c.feed);

  // Rodapé na última página.
  const [ano, mes, dia] = agoraEmSaoPaulo().dataISO.split("-");
  textoADireita(ctx, `Gerado em ${dia}/${mes}/${ano}`, LARGURA - MARGEM, MARGEM - 14, 8, ctx.normal, SUAVE);
  if (r.parcial) {
    quebrarEmLinhas(AVISO_PARCIAL_PDF, ctx.normal, 8, LARGURA - MARGEM * 2 - 110).forEach((linha, i) =>
      texto(ctx, linha, MARGEM, MARGEM - 14 - i * 10, 8, ctx.normal, SUAVE)
    );
  }

  return doc.save();
}

export function nomeArquivoPdf(r: RelatorioMensal, c: RelatorioConta): string {
  const base = seguro(c.nome).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Relatorio-${base || "conta"}-${r.mes}.pdf`;
}
