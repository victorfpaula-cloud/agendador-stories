import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { removerMidia } from "@/lib/storage";

// Pausa/retoma uma conta (is_active = false é ignorada pelo cron — a query
// de /api/cron/run já filtra accounts.is_active) e/ou liga/desliga o
// cross-post automático pro Facebook (ver supabase/cross-post-facebook.sql).
// Os dois campos são opcionais e independentes — manda só o que quer mudar.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { id } = params;

  const body = await req.json().catch(() => ({}));
  const patch: { is_active?: boolean; cross_post_facebook?: boolean; cross_post_facebook_stories?: boolean } = {};
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if (typeof body.cross_post_facebook === "boolean") patch.cross_post_facebook = body.cross_post_facebook;
  if (typeof body.cross_post_facebook_stories === "boolean") patch.cross_post_facebook_stories = body.cross_post_facebook_stories;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { erro: "Nenhum campo válido pra atualizar (is_active, cross_post_facebook ou cross_post_facebook_stories)." },
      { status: 400 }
    );
  }

  const { data: conta, error } = await admin
    .from("accounts")
    .update(patch)
    .eq("id", id)
    .select("id, name, page_id, ig_user_id, ig_username, is_active, token_obtained_at, avatar_url, avatar_atualizado_em, created_at, cross_post_facebook, cross_post_facebook_stories")
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
