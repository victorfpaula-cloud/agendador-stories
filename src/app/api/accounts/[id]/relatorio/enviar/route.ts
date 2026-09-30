import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarEmail } from "@/lib/email";
import { gerarPdfConta, nomeArquivoPdf } from "@/lib/relatorioPdf";
import { gerarRelatorioMensal, mesValido, renderizarRelatorioHtml, renderizarRelatorioTexto } from "@/lib/relatorio";

// Manda pro e-mail do Victor o relatório de UMA conta (botão "Enviar por
// e-mail" da tela de relatório) — mesmo HTML do envio automático mensal.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (!mesValido(body.mes)) {
    return NextResponse.json({ erro: "Mês inválido." }, { status: 400 });
  }
  const incluirFeed = body.incluirFeed !== false;

  const admin = createAdminClient();
  const relatorio = await gerarRelatorioMensal(admin, { mes: body.mes, contaIds: [params.id], incluirFeed });
  if (relatorio.contas.length === 0) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const enviado = await enviarEmail({
    assunto: `Relatório de ${relatorio.rotuloMes} — ${relatorio.contas[0].nome}`,
    corpo: renderizarRelatorioTexto(relatorio),
    html: renderizarRelatorioHtml(relatorio),
    anexos: [
      {
        nome: nomeArquivoPdf(relatorio, relatorio.contas[0]),
        conteudo: Buffer.from(await gerarPdfConta(relatorio, relatorio.contas[0])).toString("base64"),
      },
    ],
  });
  if (!enviado) {
    return NextResponse.json({ erro: "Não consegui enviar o e-mail. Confira RESEND_API_KEY e ALERT_EMAIL." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
