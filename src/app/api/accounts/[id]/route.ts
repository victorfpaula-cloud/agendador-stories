import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { removerMidia } from "@/lib/storage";

// Pausa ou retoma uma conta. Uma conta pausada (is_active = false) é
// ignorada pelo cron — a query de /api/cron/run já filtra
// accounts.is_active, então não precisa mexer em mais nada.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { id } = params;

  const body = await req.json().catch(() => ({}));
  if (typeof body.is_active !== "boolean") {
    return NextResponse.json({ erro: "Campo is_active é obrigatório." }, { status: 400 });
  }

  const { data: conta, error } = await admin
    .from("accounts")
    .update({ is_active: body.is_active })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ conta });
}

// Exclui a conta e limpa tudo: primeiro apaga do Storage a mídia de
// cada horário agendado (pra não deixar arquivo órfão ocupando espaço),
// depois apaga a conta — o "on delete cascade" do banco já cuida de
// remover as linhas de schedule_slots automaticamente.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { id } = params;

  const { data: conta } = await admin.from("accounts").select("id").eq("id", id).maybeSingle();
  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const { data: slots } = await admin.from("schedule_slots").select("media_path").eq("account_id", id);

  for (const slot of slots ?? []) {
    if (slot.media_path) {
      await removerMidia(admin, slot.media_path as string);
    }
  }

  const { error } = await admin.from("accounts").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
