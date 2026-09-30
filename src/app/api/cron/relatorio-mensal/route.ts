import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarEmail } from "@/lib/email";
import { agoraEmSaoPaulo } from "@/lib/days";
import { gerarPdfConta, nomeArquivoPdf } from "@/lib/relatorioPdf";
import { gerarRelatorioMensal, mesValido, renderizarRelatorioHtml, renderizarRelatorioTexto } from "@/lib/relatorio";

// Relatório mensal por e-mail (pedido do Victor em 30/09/2026). O pg_cron
// chama essa rota todo dia de madrugada UTC (23:55 em São Paulo); ela só
// envia se hoje, no fuso de São Paulo, for o último dia do mês — pg_cron não
// tem "último dia do mês", então a checagem é feita aqui. Um e-mail só, com
// um resumo por conta e uma seção detalhada pra cada conta que teve alguma
// publicação no mês. `?forcar=1` ignora a checagem do dia e `&mes=YYYY-MM`
// escolhe o mês (só pra teste/reenvio manual).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return executar(req);
}

export async function POST(req: NextRequest) {
  return executar(req);
}

async function executar(req: NextRequest) {
  const segredoEsperado = process.env.CRON_SECRET;
  if (!segredoEsperado || req.headers.get("x-cron-secret") !== segredoEsperado) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const forcar = req.nextUrl.searchParams.get("forcar") === "1";
  const { dataISO } = agoraEmSaoPaulo();

  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const ultimoDiaDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (!forcar && dia !== ultimoDiaDoMes) {
    return NextResponse.json({ enviado: false, motivo: "Hoje não é o último dia do mês." });
  }

  const mesParam = req.nextUrl.searchParams.get("mes");
  const mesRelatorio = forcar && mesValido(mesParam) ? mesParam : dataISO.slice(0, 7);

  const admin = createAdminClient();
  const completo = await gerarRelatorioMensal(admin, { mes: mesRelatorio, incluirFeed: true });
  // Só entram contas que tiveram alguma publicação no mês — conta parada não
  // vira uma tabela cheia de zeros.
  const relatorio = { ...completo, contas: completo.contas.filter((c) => c.totalStories > 0 || c.totalFeed > 0) };

  // Um PDF de uma página por cliente, anexado, pra salvar e mandar direto.
  const anexos = await Promise.all(
    relatorio.contas.map(async (c) => ({
      nome: nomeArquivoPdf(relatorio, c),
      conteudo: Buffer.from(await gerarPdfConta(relatorio, c)).toString("base64"),
    }))
  );

  const enviado = await enviarEmail({
    assunto: `Relatório de ${relatorio.rotuloMes} — Agendador de Stories`,
    corpo: renderizarRelatorioTexto(relatorio),
    html: renderizarRelatorioHtml(relatorio),
    anexos,
  });

  return NextResponse.json({
    enviado,
    mes: mesRelatorio,
    contas: relatorio.contas.map((c) => ({ nome: c.nome, stories: c.totalStories, feed: c.totalFeed })),
  });
}
