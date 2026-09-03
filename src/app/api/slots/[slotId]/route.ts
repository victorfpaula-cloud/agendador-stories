import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { removerMidia } from "@/lib/storage";

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

  const body = await req.json().catch(() => null);
  const horario = body?.time_of_day;
  // A mídia já chega pronta no Storage (upload direto do navegador — ver
  // POST /api/accounts/[id]/slots para o motivo); essa rota só recebe a
  // referência, nunca o arquivo em si.
  const media = body?.media as
    | { url?: string; path?: string; mediaType?: string; thumbnailDataUrl?: string | null }
    | undefined;

  const atualizacao: Record<string, unknown> = {};

  if (typeof horario === "string" && horario) {
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(horario)) {
      return NextResponse.json({ erro: "Horário inválido." }, { status: 400 });
    }
    atualizacao.time_of_day = horario.length === 5 ? `${horario}:00` : horario;
  }

  if (media) {
    if (!media.url || !media.path || (media.mediaType !== "IMAGE" && media.mediaType !== "VIDEO")) {
      return NextResponse.json({ erro: "Mídia inválida." }, { status: 400 });
    }
    atualizacao.media_url = media.url;
    atualizacao.media_path = media.path;
    atualizacao.media_type = media.mediaType;
    atualizacao.thumbnail_data_url = media.thumbnailDataUrl ?? null;
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
