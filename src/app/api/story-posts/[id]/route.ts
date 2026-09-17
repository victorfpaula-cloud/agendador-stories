import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Cancelar um Story automático do Drive antes de ele publicar — só faz
// sentido enquanto ainda está 'pending' (depois disso já foi publicado, ou
// está no meio da publicação, e excluir o registro não desfaria nada no
// Instagram, só confundiria o histórico).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: atual } = await admin.from("story_posts").select("id, status, media_path").eq("id", params.id).maybeSingle();

  if (!atual) {
    return NextResponse.json({ erro: "Story não encontrado." }, { status: 404 });
  }
  if (atual.status !== "pending") {
    return NextResponse.json({ erro: "Só dá pra cancelar Stories que ainda não começaram a publicar." }, { status: 400 });
  }

  const { error } = await admin.from("story_posts").delete().eq("id", params.id);
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
