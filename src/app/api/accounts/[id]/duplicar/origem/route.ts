import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduleSlot } from "@/types/database";

// Primeira etapa do "Duplicar rotina": só lê a lista de horários da conta de
// origem (sem copiar nenhum arquivo ainda), pra o navegador saber quantos
// itens existem e poder mostrar uma barra de progresso real.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const destinoId = params.id;

  const { searchParams } = new URL(req.url);
  const origemId = searchParams.get("origem_id");

  if (!origemId) {
    return NextResponse.json({ erro: "Escolha a conta de origem." }, { status: 400 });
  }
  if (origemId === destinoId) {
    return NextResponse.json({ erro: "A conta de origem precisa ser diferente da conta atual." }, { status: 400 });
  }

  const { data: destino } = await admin.from("accounts").select("id").eq("id", destinoId).maybeSingle();
  if (!destino) {
    return NextResponse.json({ erro: "Conta de destino não encontrada." }, { status: 404 });
  }

  const { data: origem } = await admin.from("accounts").select("id, name").eq("id", origemId).maybeSingle();
  if (!origem) {
    return NextResponse.json({ erro: "Conta de origem não encontrada." }, { status: 404 });
  }

  const { data: slotsOrigem, error } = await admin
    .from("schedule_slots")
    .select("*")
    .eq("account_id", origemId);

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const slots = (slotsOrigem ?? []) as ScheduleSlot[];

  if (slots.length === 0) {
    return NextResponse.json(
      { erro: `A conta "${origem.name}" ainda não tem nenhum horário configurado.` },
      { status: 400 }
    );
  }

  return NextResponse.json({ nomeOrigem: origem.name, slots });
}
