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

// Só o dia e a quantidade — o Victor pediu o relatório simples (30/09/2026),
// sem separar por ferramenta que publicou.
export type DiaContagem = { data: string; diaSemana: number; total: number };

export type RelatorioConta = {
  id: string;
  nome: string;
  usuario: string | null;
  stories: DiaContagem[];
  totalStories: number;
  feed: DiaContagem[]; // só os dias com publicação (vazio = sem tabela)
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
    const stories: DiaContagem[] = dias.map((d) => ({ ...d, total: 0 }));
    const feed: DiaContagem[] = dias.map((d) => ({ ...d, total: 0 }));
    const indice = new Map(dias.map((d, i) => [d.data, i]));

    // Stories = Agendador (publish_log) + Story Engine + AutoStory.
    for (const l of logs) {
      if (l.account_id !== conta.id) continue;
      const i = indice.get(l.scheduled_for);
      if (i !== undefined) stories[i].total += 1;
    }
    for (const h of historico) {
      if (h.account_id !== conta.id) continue;
      const i = indice.get(h.dia);
      if (i === undefined) continue;
      if (h.origem === "feed") feed[i].total += 1;
      else stories[i].total += 1;
    }

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

function celula(valor: number, fundo: string): string {
  const cor = valor === 0 ? COR.mudo : COR.texto;
  return `<td align="right" style="padding:6px 10px;border-bottom:1px solid ${COR.linha};font-size:13px;font-weight:700;color:${cor};${fundo}">${valor === 0 ? "–" : valor}</td>`;
}

function linhaDia(d: DiaContagem): string {
  const fundo = d.diaSemana >= 6 ? `background:${COR.fimDeSemana};` : "";
  return (
    `<tr><td style="padding:6px 10px;border-bottom:1px solid ${COR.linha};font-size:13px;color:${COR.texto};${fundo}">` +
    `${dataBr(d.data)} <span style="color:${COR.suave};">· ${curto(d.diaSemana)}</span></td>${celula(d.total, fundo)}</tr>`
  );
}

function mini(titulo: string, dias: DiaContagem[]): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${COR.linha};">` +
    `<tr><th align="left" style="padding:7px 10px;background:${COR.zebra};border-bottom:2px solid ${COR.linha};font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:${COR.suave};">Dia</th>` +
    `<th align="right" style="padding:7px 10px;background:${COR.zebra};border-bottom:2px solid ${COR.linha};font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:${COR.suave};">${titulo}</th></tr>` +
    dias.map(linhaDia).join("") +
    `</table>`
  );
}

// Divide a lista de dias em duas colunas lado a lado (tabela dentro de
// tabela, que é o que funciona em qualquer app de e-mail).
function duasColunas(titulo: string, dias: DiaContagem[]): string {
  const meio = Math.ceil(dias.length / 2);
  const esquerda = dias.slice(0, meio);
  const direita = dias.slice(meio);
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
    `<td width="50%" valign="top" style="padding-right:6px;">${mini(titulo, esquerda)}</td>` +
    `<td width="50%" valign="top" style="padding-left:6px;">${direita.length ? mini(titulo, direita) : ""}</td>` +
    `</tr></table>`
  );
}

function secaoConta(c: RelatorioConta, primeira: boolean): string {
  const usuario = c.usuario ? ` <span style="font-weight:400;color:${COR.suave};">@${esc(c.usuario)}</span>` : "";
  const feed =
    c.feed.length > 0
      ? `<div style="margin:22px 0 8px;font-size:15px;font-weight:700;color:${COR.texto};">Feed e Reels · ${c.totalFeed} no mês</div>${duasColunas("Posts", c.feed)}`
      : "";
  // Cada cliente começa numa página nova quando o e-mail é impresso ou salvo
  // em PDF.
  const quebra = primeira ? "" : "page-break-before:always;break-before:page;";
  return (
    `<div style="${quebra}margin-top:${primeira ? 26 : 40}px;padding-top:20px;border-top:3px solid ${COR.marca};">` +
    `<div style="font-size:20px;font-weight:700;color:${COR.texto};">${esc(c.nome)}${usuario}</div>` +
    `<div style="margin:16px 0 8px;font-size:15px;font-weight:700;color:${COR.texto};">Stories · ${c.totalStories} no mês</div>` +
    duasColunas("Stories", c.stories) +
    feed +
    `</div>`
  );
}

const AVISO_PARCIAL =
  "Os números de AutoStory, Story Engine e Feed/Reels deste mês podem estar incompletos (o registro completo começou em 30/09/2026). Os Stories do Agendador estão completos.";

export function renderizarRelatorioHtml(r: RelatorioMensal): string {
  const resumo =
    r.contas.length > 1
      ? `<div style="margin:22px 0 8px;font-size:15px;font-weight:700;">Resumo</div>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${COR.linha};">` +
        r.contas
          .map(
            (c) =>
              `<tr><td style="padding:7px 10px;border-bottom:1px solid ${COR.linha};font-size:13px;">${esc(c.nome)}</td>` +
              `<td align="right" style="padding:7px 10px;border-bottom:1px solid ${COR.linha};font-size:13px;font-weight:700;">${c.totalStories} Stories` +
              (r.incluirFeed && c.totalFeed > 0 ? ` · ${c.totalFeed} Feed/Reels` : "") +
              `</td></tr>`
          )
          .join("") +
        `</table>`
      : "";

  const aviso = r.parcial
    ? `<div style="margin-top:26px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;line-height:1.5;">${AVISO_PARCIAL}</div>`
    : "";

  const corpo =
    r.contas.length === 0
      ? `<div style="margin-top:26px;font-size:14px;color:${COR.suave};">Nenhuma publicação registrada neste mês.</div>`
      : resumo + r.contas.map((c, i) => secaoConta(c, i === 0)).join("");

  return (
    `<div style="font-family:${FONTE};max-width:640px;margin:0 auto;padding:24px 16px;color:${COR.texto};">` +
    `<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${COR.marca};font-weight:700;">Agendador de Stories</div>` +
    `<div style="margin-top:4px;font-size:26px;font-weight:700;">Relatório de ${esc(r.rotuloMes)}</div>` +
    corpo +
    aviso +
    `</div>`
  );
}

export const AVISO_PARCIAL_PDF = AVISO_PARCIAL;

export function renderizarRelatorioTexto(r: RelatorioMensal): string {
  const linhas = [`Relatório de ${r.rotuloMes}`, ""];
  for (const c of r.contas) {
    linhas.push(`${c.nome}: ${c.totalStories} Stories` + (r.incluirFeed ? `, ${c.totalFeed} no Feed/Reels` : ""));
  }
  return linhas.join("\n");
}
