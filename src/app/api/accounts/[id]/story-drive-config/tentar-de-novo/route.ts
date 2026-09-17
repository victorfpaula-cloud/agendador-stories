import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarLeituraStoryDrive } from "@/lib/storyDriveIngestao";

// Botão "Tentar de novo agora" da aba Story Automático Drive — roda a
// mesma lógica do robô diário (src/lib/storyDriveIngestao.ts), útil quando
// a execução automática das 9h falha por um motivo passageiro. Protegida
// pela sessão normal de login (middleware.ts), não pelo segredo do cron —
// quem chama aqui é o próprio Victor pela tela.
//
// Segura de clicar mais de uma vez: a reivindicação do dia por conta (ver
// reivindicar_ingestao_story_drive) garante que só uma execução por vez
// mexe no Drive daquela conta, e nunca cria Stories duplicados se um de
// hoje já tiver dado certo.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accountId = params.id;

  const { data: conta } = await admin.from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const resultado = await executarLeituraStoryDrive(admin, accountId);
  return NextResponse.json(resultado);
}
