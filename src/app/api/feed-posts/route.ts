import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedMediaType } from "@/types/database";

// Cria uma publicação agendada (feed/Reels/carrossel). Cobre broadcast pra
// várias contas de uma vez desde o passo 3: mesma mídia + mesma legenda,
// publicadas em cada conta escolhida, com status individual por conta.
// Reels e carrossel ainda não têm formulário próprio — chegam nos próximos
// passos, mas o desenho da tabela já suporta.
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const body = await req.json().catch(() => null);

  const caption = String(body?.caption ?? "");
  const scheduledAt = String(body?.scheduledAt ?? "");
  const accountIds: string[] = Array.isArray(body?.accountIds)
    ? body.accountIds.filter((x: unknown) => typeof x === "string" && x)
    : [];
  const media = body?.media as { url?: string; path?: string; mediaType?: FeedMediaType } | undefined;

  if (accountIds.length === 0) {
    return NextResponse.json({ erro: "Escolha ao menos uma conta." }, { status: 400 });
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

  const { data: contasEncontradas } = await admin.from("accounts").select("id").in("id", accountIds);
  if (!contasEncontradas || contasEncontradas.length !== accountIds.length) {
    return NextResponse.json({ erro: "Uma ou mais contas selecionadas não foram encontradas." }, { status: 404 });
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

    const { error: erroMedia } = await admin.from("feed_post_media").insert({
      feed_post_id: post.id,
      position: 0,
      media_url: media.url,
      media_path: media.path,
      media_type: media.mediaType,
    });

    if (erroMedia) {
      // Desfaz o post criado — evita deixar uma publicação "fantasma" sem
      // nenhuma mídia associada, que o cron não saberia o que fazer com ela.
      await admin.from("feed_posts").delete().eq("id", post.id);
      throw new Error(erroMedia.message);
    }

    // Insert em lote: se qualquer conta da lista falhar (ex: id inválido),
    // o Postgres desfaz o lote inteiro sozinho — nunca fica pela metade.
    const { error: erroContas } = await admin
      .from("feed_post_accounts")
      .insert(accountIds.map((accountId) => ({ feed_post_id: post.id, account_id: accountId })));

    if (erroContas) {
      // Cascade cuida de apagar a mídia junto (on delete cascade em feed_post_media).
      await admin.from("feed_posts").delete().eq("id", post.id);
      throw new Error(erroContas.message);
    }

    const { data: postCompleto, error: erroFetch } = await admin
      .from("feed_posts")
      .select("*, feed_post_media(*), feed_post_accounts(*, accounts(id, name, ig_username))")
      .eq("id", post.id)
      .single();

    if (erroFetch || !postCompleto) {
      throw new Error(erroFetch?.message || "Publicação criada, mas houve erro ao carregar os detalhes.");
    }

    return NextResponse.json({ post: postCompleto });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao agendar a publicação.";
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
