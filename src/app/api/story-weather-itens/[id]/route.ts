import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Apaga uma arte do Story Weather (ação do Victor) e o arquivo dela.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: item } = await admin.from("story_weather_itens").select("id, media_path").eq("id", params.id).maybeSingle();
  if (!item) return NextResponse.json({ erro: "Arte não encontrada." }, { status: 404 });
  const { error } = await admin.from("story_weather_itens").delete().eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  await admin.storage.from("story-media").remove([item.media_path]).catch(() => null);
  return NextResponse.json({ ok: true });
}
