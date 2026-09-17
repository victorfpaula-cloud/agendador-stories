import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarLeituraStoryDrive } from "@/lib/storyDriveIngestao";

// Cron do sub-módulo AutoStory (Story Automático via Drive) — roda a cada
// 30 min (ver supabase/story-drive-permite-rodar-mais-vezes.sql), lê a
// pasta do dia de CADA conta com automação configurada e cria os Stories
// pendentes que ainda não existem (até 5, um por horário configurado) —
// quem publica de verdade é o motor próprio
// (/api/cron/publicar-stories-drive), sem nenhuma relação com o motor
// semanal de Stories (/api/cron/run) nem com o AutoFeed (Drive do Feed).
//
// Diferente do AutoFeed (1x/dia, às 11h): aqui Victor costuma adicionar
// arquivo 2, 3 na pasta ao longo do dia, então rodar só 1x de manhã deixava
// esses arquivos sem Story até o dia seguinte. Rodar a cada 30 min é seguro
// e barato porque a ingestão é idempotente por posição/horário (ver
// storyDriveIngestao.ts) — na maioria das vezes só confere a pasta, não
// acha nada novo, e volta rápido sem baixar nada. Passa por fora do limite
// de 1x/dia do cron nativo da Vercel no plano Hobby porque quem dispara essa
// rota é o pg_cron do Supabase via HTTP comum, não o cron da própria Vercel
// (mesmo truque usado pelos outros crons do projeto — ver supabase/cron.sql).
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
