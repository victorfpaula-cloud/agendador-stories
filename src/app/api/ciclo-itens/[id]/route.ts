import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Remove uma imagem/vídeo do balde de uma categoria. Não afeta Stories já
// gerados a partir dela (media_url/media_path deles são cópia própria, ver
// comentário em supabase/story-ciclo.sql) — só tira essa mídia das
// próximas escolhas do robô.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: atual } = await admin.from("story_ciclo_item").select("id, media_path").eq("id", params.id).maybeSingle();
  if (!atual) {
    return NextResponse.json({ erro: "Item não encontrado." }, { status: 404 });
  }

  const { error } = await admin.from("story_ciclo_item").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  if (atual.media_path) {
    try {
      await admin.storage.from("story-media").remove([atual.media_path]);
    } catch {
      // Ignorado de propósito — o pior caso é um arquivo órfão no bucket.
    }
  }

  return NextResponse.json({ ok: true });
}
