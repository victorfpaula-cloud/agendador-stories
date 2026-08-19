import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarMidia, removerMidia } from "@/lib/storage";

export async function PATCH(req: NextRequest, { params }: { params: { slotId: string } }) {
  const admin = createAdminClient();
  const { slotId } = params;

  const { data: slotAtual } = await admin
    .from("schedule_slots")
    .select("*")
    .eq("id", slotId)
    .maybeSingle();

  if (!slotAtual) {
    return NextResponse.json({ erro: "Horário não encontrado." }, { status: 404 });
  }

  const formData = await req.formData();
  const horario = formData.get("time_of_day");
  const file = formData.get("file") as File | null;

  const atualizacao: Record<string, unknown> = {};

  if (typeof horario === "string" && horario) {
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(horario)) {
      return NextResponse.json({ erro: "Horário inválido." }, { status: 400 });
    }
    atualizacao.time_of_day = horario.length === 5 ? `${horario}:00` : horario;
  }

  if (file && file.size > 0) {
    try {
      const midia = await enviarMidia(admin, slotAtual.account_id, file);
      atualizacao.media_url = midia.url;
      atualizacao.media_path = midia.path;
      atualizacao.media_type = midia.mediaType;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao enviar o novo arquivo.";
      return NextResponse.json({ erro: msg }, { status: 500 });
    }
  }

  if (Object.keys(atualizacao).length === 0) {
    return NextResponse.json({ erro: "Nada pra atualizar." }, { status: 400 });
  }

  const { data: slotAtualizado, error } = await admin
    .from("schedule_slots")
    .update(atualizacao)
    .eq("id", slotId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  if (atualizacao.media_path && slotAtual.media_path) {
    await removerMidia(admin, slotAtual.media_path as string);
  }

  return NextResponse.json({ slot: slotAtualizado });
}

export async function DELETE(_req: NextRequest, { params }: { params: { slotId: string } }) {
  const admin = createAdminClient();
  const { slotId } = params;

  const { data: slot } = await admin.from("schedule_slots").select("media_path").eq("id", slotId).maybeSingle();

  const { error } = await admin.from("schedule_slots").delete().eq("id", slotId);
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  if (slot?.media_path) {
    await removerMidia(admin, slot.media_path);
  }

  return NextResponse.json({ ok: true });
}
