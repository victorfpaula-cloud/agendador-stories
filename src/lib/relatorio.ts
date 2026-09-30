import { createAdminClient } from "@/lib/supabase/admin";
import { DIAS_SEMANA } from "@/lib/days";

// Relatório mensal de publicações (pedido do Victor em 30/09/2026) — o mesmo
// HTML vai por e-mail no último dia do mês (/api/cron/relatorio-mensal) e
// aparece na tela quando ele gera manualmente dentro de uma conta
// (/contas/[id]/relatorio). Stories do Agendador vêm de publish_log (que não
// é podado); AutoStory, Story Engine e Feed/Reels vêm de publicacoes_historico
// (ver supabase/publicacoes-historico.sql), porque as tabelas originais
// guardam só as 15 últimas publicações.

// Antes dessa data o registro permanente não existia: só entram no relatório
// as publicações de AutoStory/Story Engine/Feed que ainda estavam guardadas.
const REGISTRO_COMPLETO_DESDE = "2026-10-01";

type Admin = ReturnType<typeof createAdminClient>;

export type DiaStories = { data: string; diaSemana: number; agendador: number; storyEngine: number; autostory: number; total: number };
export type DiaFeed = { data: string; diaSemana: number; fotos: number; carrosseis: number; videos: number; reels: number; total: number };

export type RelatorioConta = {
  id: string;
  nome: string;
  usuario: string | null;
  stories: DiaStories[];
  totalStories: number;
  feed: DiaFeed[];
  totalFeed: number;
};

export type RelatorioMensal = {
  mes: string; // YYYY-MM
  rotuloMes: string; // "setembro de 2026"
  incluirFeed: boolean;
  contas: RelatorioConta[];
  parcial: boolean;
};

export function mesValido(mes: string | undefined | null): mes is string {
  return !!mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);
}

function diasDoMes(mes: string): { data: string; diaSemana: number }[] {
  const [ano, m] = mes.split("-").map(Number);
  const total = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const dias: { data: string; diaSemana: number }[] = [];
  for (let d = 1; d <= total; d++) {
    const js = new Date(Date.UTC(ano, m - 1, d)).getUTCDay();
    dias.push({ data: `${mes}-${String(d).padStart(2, "0")}`, diaSemana: js === 0 ? 7 : js });
  }
  return dias;
}

function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  const nome = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(ano, m - 1, 1)));
  return `${nome} de ${ano}`;
}

// O Supabase devolve no máximo 1000 linhas por consulta — um mês de Stories
// do Agendador passa disso, então busca em páginas até acabar.
async function buscarTudo<T>(montar: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null }>): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await montar(de, de + 999);
    const pagina = (data ?? []) as T[];
    tudo.push(...pagina);
    if (pagina.length < 1000) break;
  }
  return tudo;
}

export async function gerarRelatorioMensal(
  admin: Admin,
  { mes, contaIds, incluirFeed }: { mes: string; contaIds?: string[]; incluirFeed: boolean }
): Promise<RelatorioMensal> {
  const dias = diasDoMes(mes);
  const inicio = dias[0].data;
  const [ano, m] = mes.split("-").map(Number);
  const proximoMes = m === 12 ? `${ano + 1}-01-01` : `${ano}-${String(m + 1).padStart(2, "0")}-01`;

  let consultaContas = admin.from("accounts").select("id, name, ig_username").order("name", { ascending: true });
  if (contaIds) consultaContas = consultaContas.in("id", contaIds);
  const { data: contasData } = await consultaContas;
  const contas = (contasData ?? []) as { id: string; name: string; ig_username: string | null }[];
  const ids = contas.map((c) => c.id);
  if (ids.length === 0) return { mes, rotuloMes: rotuloDoMes(mes), incluirFeed, contas: [], parcial: inicio < REGISTRO_COMPLETO_DESDE };

  const logs = await buscarTudo<{ account_id: string; scheduled_for: string }>((de, ate) =>
    admin
      .from("publish_log")
      .select("account_id, scheduled_for")
      .eq("status", "success")
      .in("account_id", ids)
      .gte("scheduled_for", inicio)
      .lt("scheduled_for", proximoMes)
      .order("scheduled_for", { ascending: true })
      .range(de, ate)
  );

  const historico = await buscarTudo<{ account_id: string; origem: string; tipo: string | null; dia: string }>((de, ate) =>
    admin
      .from("publicacoes_historico")
      .select("account_id, origem, tipo, dia")
      .in("account_id", ids)
      .gte("dia", inicio)
      .lt("dia", proximoMes)
      .order("dia", { ascending: true })
      .range(de, ate)
  );

  const relatorio: RelatorioConta[] = contas.map((conta) => {
    const stories: DiaStories[] = dias.map((d) => ({ ...d, agendador: 0, storyEngine: 0, autostory: 0, total: 0 }));
    const feed: DiaFeed[] = dias.map((d) => ({ ...d, fotos: 0, carrosseis: 0, videos: 0, reels: 0, total: 0 }));
    const indice = new Map(dias.map((d, i) => [d.data, i]));

    for (const l of logs) {
      if (l.account_id !== conta.id) continue;
      const i = indice.get(l.scheduled_for);
      if (i !== undefined) stories[i].agendador += 1;
    }
    for (const h of historico) {
      if (h.account_id !== conta.id) continue;
      const i = indice.get(h.dia);
      if (i === undefined) continue;
      if (h.origem === "story_engine") stories[i].storyEngine += 1;
      else if (h.origem === "autostory") stories[i].autostory += 1;
      else if (h.origem === "feed") {
        if (h.tipo === "CAROUSEL") feed[i].carrosseis += 1;
        else if (h.tipo === "REELS") feed[i].reels += 1;
        else if (h.tipo === "VIDEO") feed[i].videos += 1;
        else feed[i].fotos += 1;
      }
    }
    for (const s of stories) s.total = s.agendador + s.storyEngine + s.autostory;
    for (const f of feed) f.total = f.fotos + f.carrosseis + f.videos + f.reels;

    const feedComPosts = feed.filter((f) => f.total > 0);
    return {
      id: conta.id,
      nome: conta.name.trim(),
      usuario: conta.ig_username,
      stories,
      totalStories: stories.reduce((soma, s) => soma + s.total, 0),
      feed: incluirFeed ? feedComPosts : [],
      totalFeed: incluirFeed ? feedComPosts.reduce((soma, f) => soma + f.total, 0) : 0,
    };
  });

  return { mes, rotuloMes: rotuloDoMes(mes), incluirFeed, contas: relatorio, parcial: inicio < REGISTRO_COMPLETO_DESDE };
}

// ---------- HTML (estilos inline — e-mail não carrega CSS externo) ----------

function esc(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const COR = { marca: "#3d54e0", texto: "#0f172a", suave: "#64748b", mudo: "#cbd5e1", linha: "#e2e8f0", zebra: "#f8fafc", fimDeSemana: "#f1f5f9" };
const FONTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function curto(diaSemana: number): string {
  return DIAS_SEMANA.find((d) => d.value === diaSemana)?.label ?? "";
}

function dataBr(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function celula(valor: number, negrito = false): string {
  const cor = valor === 0 ? COR.mudo : COR.texto;
  return `<td align="center" style="padding:7px 8px;border-bottom:1px solid ${COR.linha};font-size:13px;color:${cor};${negrito ? "font-weight:700;" : ""}">${valor === 0 ? "–" : valor}</td>`;
}

function cabecalho(colunas: string[]): string {
  return `<tr>${colunas
    .map(
      (c, i) =>
        `<th align="${i < 2 ? "left" : "center"}" style="padding:8px;background:${COR.zebra};border-bottom:2px solid ${COR.linha};font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:${COR.suave};font-weight:600;">${c}</th>`
    )
    .join("")}</tr>`;
}

function linhaDia(d: { data: string; diaSemana: number }, valores: number[], total: number): string {
  const fundo = d.diaSemana >= 6 ? `background:${COR.fimDeSemana};` : "";
  const base = `padding:7px 8px;border-bottom:1px solid ${COR.linha};font-size:13px;${fundo}`;
  return (
    `<tr style="${fundo}">` +
    `<td style="${base}color:${COR.suave};">${dataBr(d.data)}</td>` +
    `<td style="${base}color:${COR.texto};">${curto(d.diaSemana)}</td>` +
    valores.map((v) => celula(v)).join("") +
    celula(total, true) +
    `</tr>`
  );
}

function tabela(titulo: string, cabecalhoColunas: string[], linhas: string, rodape: string): string {
  return (
    `<div style="margin:22px 0 6px;font-size:15px;font-weight:700;color:${COR.texto};">${titulo}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${COR.linha};border-radius:8px;">` +
    cabecalho(cabecalhoColunas) +
    linhas +
    rodape +
    `</table>`
  );
}

function rodapeTotais(rotulo: string, totais: number[], total: number): string {
  const td = (v: number) =>
    `<td align="center" style="padding:9px 8px;font-size:13px;font-weight:700;color:${COR.marca};background:${COR.zebra};">${v}</td>`;
  return `<tr><td colspan="2" style="padding:9px 8px;font-size:13px;font-weight:700;color:${COR.texto};background:${COR.zebra};">${rotulo}</td>${totais.map(td).join("")}${td(total)}</tr>`;
}

function secaoConta(c: RelatorioConta): string {
  const soma = (f: (d: DiaStories) => number) => c.stories.reduce((s, d) => s + f(d), 0);
  const somaFeed = (f: (d: DiaFeed) => number) => c.feed.reduce((s, d) => s + f(d), 0);

  const storiesHtml = tabela(
    "Stories",
    ["Data", "Dia", "Agendador", "Story Engine", "AutoStory", "Total"],
    c.stories.map((d) => linhaDia(d, [d.agendador, d.storyEngine, d.autostory], d.total)).join(""),
    rodapeTotais("Total do mês", [soma((d) => d.agendador), soma((d) => d.storyEngine), soma((d) => d.autostory)], c.totalStories)
  );

  const feedHtml =
    c.feed.length > 0
      ? tabela(
          "Feed e Reels",
          ["Data", "Dia", "Fotos", "Carrosséis", "Vídeos", "Reels", "Total"],
          c.feed.map((d) => linhaDia(d, [d.fotos, d.carrosseis, d.videos, d.reels], d.total)).join(""),
          rodapeTotais("Total do mês", [somaFeed((d) => d.fotos), somaFeed((d) => d.carrosseis), somaFeed((d) => d.videos), somaFeed((d) => d.reels)], c.totalFeed)
        )
      : "";

  const usuario = c.usuario ? ` <span style="font-weight:400;color:${COR.suave};">@${esc(c.usuario)}</span>` : "";
  return (
    `<div style="margin-top:34px;padding-top:22px;border-top:3px solid ${COR.marca};">` +
    `<div style="font-size:20px;font-weight:700;color:${COR.texto};">${esc(c.nome)}${usuario}</div>` +
    storiesHtml +
    feedHtml +
    `</div>`
  );
}

export function renderizarRelatorioHtml(r: RelatorioMensal): string {
  const resumo =
    r.contas.length > 1
      ? tabela(
          "Resumo por conta",
          ["Conta", "", "Stories", ...(r.incluirFeed ? ["Feed e Reels"] : [])],
          r.contas
            .map(
              (c) =>
                `<tr><td colspan="2" style="padding:8px;border-bottom:1px solid ${COR.linha};font-size:13px;color:${COR.texto};">${esc(c.nome)}</td>` +
                celula(c.totalStories, true) +
                (r.incluirFeed ? celula(c.totalFeed, true) : "") +
                `</tr>`
            )
            .join(""),
          ""
        )
      : "";

  const aviso = r.parcial
    ? `<div style="margin-top:26px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;line-height:1.5;">Atenção: o registro completo de AutoStory, Story Engine e Feed/Reels começou em 30/09/2026. Neste mês, esses números incluem só as publicações que ainda estavam guardadas; os Stories do Agendador estão completos.</div>`
    : "";

  const corpo = r.contas.length === 0
    ? `<div style="margin-top:26px;font-size:14px;color:${COR.suave};">Nenhuma publicação registrada neste mês.</div>`
    : resumo + r.contas.map(secaoConta).join("");

  return (
    `<div style="font-family:${FONTE};max-width:640px;margin:0 auto;padding:24px 16px;color:${COR.texto};">` +
    `<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${COR.marca};font-weight:700;">Agendador de Stories</div>` +
    `<div style="margin-top:4px;font-size:26px;font-weight:700;">Relatório de ${esc(r.rotuloMes)}</div>` +
    `<div style="margin-top:4px;font-size:14px;color:${COR.suave};">Publicações que foram ao ar no mês, por dia.</div>` +
    corpo +
    aviso +
    `</div>`
  );
}

export function renderizarRelatorioTexto(r: RelatorioMensal): string {
  const linhas = [`Relatório de ${r.rotuloMes}`, ""];
  for (const c of r.contas) {
    linhas.push(`${c.nome}: ${c.totalStories} Stories` + (r.incluirFeed ? `, ${c.totalFeed} no Feed/Reels` : ""));
  }
  return linhas.join("\n");
}
