import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarLeituraDrive } from "@/lib/driveIngestao";

// Cron diário do sub-módulo do Drive (passo 7) — roda 1x por dia (ver
// supabase/drive-cron.sql), lê a pasta do dia da Dona Baunilha no Google
// Drive e cria o post agendado (com source='drive') — quem publica de
// verdade continua sendo o motor de sempre (/api/cron/publicar-feed), sem
// nenhuma mudança nele. Rota própria, isolada: se algo aqui falhar, não
// afeta o fluxo manual nem o motor de publicação — só fica sem post
// automático naquele dia, e o motivo fica registrado em `drive_execucoes`
// (visível na telinha /publicacoes/drive, com um botão pra tentar de novo).
//
// A lógica de verdade mora em src/lib/driveIngestao.ts — compartilhada com
// /api/drive-config/tentar-de-novo (botão manual), só o jeito de autenticar
// muda: aqui é o segredo do cron, lá é a sessão logada do Victor.
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
  const resultado = await executarLeituraDrive(admin);
  return NextResponse.json(resultado);
}
