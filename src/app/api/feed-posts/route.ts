import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedMediaType } from "@/types/database";

// Cria uma publicação agendada (feed/Reels/carrossel). Por enquanto só cobre
// o caso mínimo: 1 mídia (a mídia já sobe direto pro Storage antes desta
// chamada, ver src/lib/uploadDireto.ts) + 1 conta de destino. Escolher várias
// contas de uma vez (broadcast) e carrossel/Reels chegam nos próximos passos
// — a tabela já foi desenhada pra suportar isso, só a criação aqui ainda é
// simples.
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const body = await req.json().catch(() => null);

  const caption = String(body?.caption ?? "");
  const scheduledAt = String(body?.scheduledAt ?? "");
  const accountId = String(body?.accountId ?? "");
  const media = body?.media as { url?: string; path?: string; mediaType?: FeedMediaType } | undefined;

  if (!accountId) {
    return NextResponse.json({ erro: "Escolha uma conta." }, { status: 400 });
  }
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
    return NextResponse.json({ erro: "Escolha uma data e horário válidos." }, { status: 400 });
  }
  if (new Date(scheduledAt).getTime() <= Date.now()) {
    return NextResponse.json({ erro: "A data/horário do agendamento precisa ser no futuro." }, { status: 400 });
  }
  if (!media?.url || !media?.path || !media?.mediaType) {
    return NextResponse.json({ erro: "Envie uma foto ou vídeo antes de agendar." }, { status: 400 });
  }

  const { data: conta } = await admin
    .from("accounts")
    .select("id, name, ig_username")
    .eq("id", accountId)
    .maybeSingle();

  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  try {
    const { data: post, error: erroPost } = await admin
      .from("feed_posts")
      .insert({
        caption,
        scheduled_at: scheduledAt,
        media_type: media.mediaType, // IMAGE ou VIDEO por enquanto
      })
      .select("*")
      .single();

    if (erroPost || !post) throw new Error(erroPost?.message || "Erro ao criar a publicação.");

    const { data: mediaRow, error: erroMedia } = await admin
      .from("feed_post_media")
      .insert({
        feed_post_id: post.id,
        position: 0,
        media_url: media.url,
        media_path: media.path,
        media_type: media.mediaType,
      })
      .select("*")
      .single();

    if (erroMedia || !mediaRow) {
      // Desfaz o post criado — evita deixar uma publicação "fantasma" sem
      // nenhuma mídia associada, que o cron não saberia o que fazer com ela.
      await admin.from("feed_posts").delete().eq("id", post.id);
      throw new Error(erroMedia?.message || "Erro ao salvar a mídia da publicação.");
    }

    const { data: contaRow, error: erroConta } = await admin
      .from("feed_post_accounts")
      .insert({ feed_post_id: post.id, account_id: accountId })
      .select("*")
      .single();

    if (erroConta || !contaRow) {
      // Cascade cuida de apagar a mídia junto (on delete cascade em feed_post_media).
      await admin.from("feed_posts").delete().eq("id", post.id);
      throw new Error(erroConta?.message || "Erro ao vincular a conta de destino.");
    }

    return NextResponse.json({
      post: {
        ...post,
        feed_post_media: [mediaRow],
        feed_post_accounts: [{ ...contaRow, accounts: conta }],
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao agendar a publicação.";
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
