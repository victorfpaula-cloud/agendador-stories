import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarLeituraDrive } from "@/lib/driveIngestao";

// Botão "Tentar de novo agora" da aba Publicações > Drive de cada conta —
// roda exatamente a mesma lógica do robô diário (src/lib/driveIngestao.ts),
// útil quando a execução automática das 11h falha por um motivo passageiro
// (ex: timeout de rede baixando um vídeo grande do Drive ou subindo pro
// Storage). Protegida pela sessão normal de login (middleware.ts) — não
// pelo segredo do cron, já que quem chama aqui é o próprio Victor pela
// tela, não o agendador automático.
//
// Segura de clicar mais de uma vez: a reivindicação do dia por conta (ver
// reivindicar_ingestao_drive) garante que só uma execução por vez mexe no
// Drive daquela conta, e nunca cria um segundo post se um de hoje já tiver
// dado certo.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accountId = params.id;

  const { data: conta } = await admin.from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const resultado = await executarLeituraDrive(admin, accountId);
  return NextResponse.json(resultado);
}
