import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarLeituraDrive } from "@/lib/driveIngestao";

// Cron diário do sub-módulo do Drive (passo 7) — roda 1x por dia (ver
// supabase/drive-cron.sql), lê a pasta do dia de CADA conta com automação
// configurada no Google Drive e cria o post agendado (com source='drive')
// — quem publica de verdade continua sendo o motor de sempre
// (/api/cron/publicar-feed), sem nenhuma mudança nele. Rota própria,
// isolada: se algo aqui falhar pra uma conta, não afeta as outras contas
// nem o fluxo manual nem o motor de publicação — só fica sem post
// automático naquele dia pra aquela conta, e o motivo fica registrado em
// `drive_execucoes` (visível na aba Publicações > Drive de cada conta, com
// um botão pra tentar de novo).
//
// A lógica de verdade mora em src/lib/driveIngestao.ts — compartilhada com
// /api/accounts/[id]/drive-config/tentar-de-novo (botão manual), só o jeito
// de autenticar muda: aqui é o segredo do cron, lá é a sessão logada do
// Victor. Desde a migração drive_config_por_conta (16/09/2026), cada conta
// tem sua própria linha em drive_config — esse cron busca todas e roda uma
// ingestão independente pra cada uma.
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Máximo permitido no plano Hobby da Vercel — dá folga pra baixar/subir vídeo.

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
  const { data: configs } = await admin.from("drive_config").select("account_id");

  const resultados: Record<string, Awaited<ReturnType<typeof executarLeituraDrive>>> = {};
  for (const { account_id } of configs ?? []) {
    resultados[account_id] = await executarLeituraDrive(admin, account_id);
  }

  return NextResponse.json({ resultados });
}
