import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Cancelar um Story automático do Drive antes de ele publicar — vale pra
// 'pending' (ainda não começou) e também 'error' (ex: sem horário
// reconhecido no nome do arquivo — Victor pode preferir só descartar em vez
// de definir o horário à mão). Depois de 'publishing' ou 'success' não dá
// mais: excluir o registro não desfaria nada no Instagram, só confundiria o
// histórico.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: atual } = await admin.from("story_posts").select("id, status, media_path").eq("id", params.id).maybeSingle();

  if (!atual) {
    return NextResponse.json({ erro: "Story não encontrado." }, { status: 404 });
  }
  if (atual.status !== "pending" && atual.status !== "error") {
    return NextResponse.json({ erro: "Só dá pra cancelar Stories que ainda não foram publicados." }, { status: 400 });
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

// Define/corrige o horário de um Story automático — usado quando o AutoStory
// não conseguiu reconhecer o horário no nome do arquivo do Drive (status
// "error", scheduled_at nulo) e Victor completa à mão na lista de "Stories
// de hoje", ou pra simplesmente mudar o horário de um Story ainda pendente.
// Sempre volta pro status "pending" (limpa o error_message) — o horário novo
// usa o dia já gravado em `dia`, nunca a data de hoje (evita reagendar pro
// dia errado se isso for chamado depois da meia-noite por qualquer motivo).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: atual } = await admin.from("story_posts").select("id, status, dia").eq("id", params.id).maybeSingle();
  if (!atual) {
    return NextResponse.json({ erro: "Story não encontrado." }, { status: 404 });
  }
  if (atual.status !== "pending" && atual.status !== "error") {
    return NextResponse.json({ erro: "Só dá pra editar o horário de Stories que ainda não foram publicados." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const horario = typeof body?.horario === "string" ? body.horario : "";
  if (!/^\d{2}:\d{2}$/.test(horario)) {
    return NextResponse.json({ erro: "Horário inválido." }, { status: 400 });
  }

  const scheduledAt = new Date(`${atual.dia}T${horario}:00-03:00`).toISOString();

  const { data, error } = await admin
    .from("story_posts")
    .update({ scheduled_at: scheduledAt, status: "pending", error_message: null })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ story: data });
}
