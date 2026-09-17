import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarLeituraStoryDrive } from "@/lib/storyDriveIngestao";

// Cron diário do sub-módulo Story Automático via Drive — roda 1x por dia,
// às 9h horário de Brasília (ver supabase/story-drive-automation.sql), lê
// a pasta do dia de CADA conta com automação configurada e cria os Stories
// pendentes (até 5, um por horário configurado) — quem publica de verdade é
// o motor próprio (/api/cron/publicar-stories-drive), sem nenhuma relação
// com o motor semanal de Stories (/api/cron/run) nem com o Drive do Feed.
// Roda mais cedo que o do Feed (9h vs 11h) porque aqui os horários de
// publicação são configuráveis por arquivo e podem ser bem cedo no dia.
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
  const { data: configs } = await admin.from("story_drive_config").select("account_id");

  const resultados: Record<string, Awaited<ReturnType<typeof executarLeituraStoryDrive>>> = {};
  for (const { account_id } of configs ?? []) {
    resultados[account_id] = await executarLeituraStoryDrive(admin, account_id);
  }

  return NextResponse.json({ resultados });
}
