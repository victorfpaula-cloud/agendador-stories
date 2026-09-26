import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarGeracaoStoriesCiclo } from "@/lib/storyCicloGeracao";

// Cron do Story Engine — a lógica de verdade vive em
// src/lib/storyCicloGeracao.ts (compartilhada com o cron combinado
// /api/cron/gerar-tudo, que é quem o pg_cron chama de 30 em 30 min de
// verdade). Esta rota continua existindo pra debug/retry manual isolado.
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
  const segredoRecebido = req.headers.get("x-cron-secret");

  if (!segredoEsperado || segredoRecebido !== segredoEsperado) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const resultado = await executarGeracaoStoriesCiclo(admin);
  return NextResponse.json(resultado);
}
