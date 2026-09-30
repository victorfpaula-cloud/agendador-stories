import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gerarRelatorioMensal, mesValido } from "@/lib/relatorio";
import { gerarPdfConta, nomeArquivoPdf } from "@/lib/relatorioPdf";

// Baixa o relatório de UMA conta em PDF (uma página, pronta pra mandar pro
// cliente) — botão "Baixar PDF" da tela de relatório.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const mes = req.nextUrl.searchParams.get("mes");
  if (!mesValido(mes)) {
    return NextResponse.json({ erro: "Mês inválido." }, { status: 400 });
  }
  const incluirFeed = req.nextUrl.searchParams.get("feed") !== "0";

  const admin = createAdminClient();
  const relatorio = await gerarRelatorioMensal(admin, { mes, contaIds: [params.id], incluirFeed });
  if (relatorio.contas.length === 0) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const pdf = await gerarPdfConta(relatorio, relatorio.contas[0]);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeArquivoPdf(relatorio, relatorio.contas[0])}"`,
      "Cache-Control": "no-store",
    },
  });
}
