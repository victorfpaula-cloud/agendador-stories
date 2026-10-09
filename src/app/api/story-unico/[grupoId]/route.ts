import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Cancela os dias que ainda não saíram de um Agendamento Único (o que já foi publicado fica).
export async function DELETE(_req: NextRequest, { params }: { params: { grupoId: string } }) {
  const admin = createAdminClient();
  const { data: pendentes } = await admin
    .from("story_unico_posts")
    .select("id, media_path")
    .eq("grupo_id", params.grupoId)
    .eq("status", "pending");
  if (pendentes && pendentes.length > 0) {
    await admin.from("story_unico_posts").delete().in("id", pendentes.map((p) => p.id));
  }
  const { count } = await admin
    .from("story_unico_posts")
    .select("id", { count: "exact", head: true })
    .eq("grupo_id", params.grupoId)
    .in("status", ["pending", "publishing"]);
  const path = pendentes?.[0]?.media_path;
  if (path && (count ?? 0) === 0) {
    await admin.storage.from("story-media").remove([path]);
    await admin.from("story_unico_posts").update({ media_url: null, media_path: null }).eq("grupo_id", params.grupoId);
  }
  return NextResponse.json({ ok: true });
}
