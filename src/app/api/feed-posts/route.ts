import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedMediaType, MediaType } from "@/types/database";

// Cria uma publicação agendada (feed/Reels/carrossel). Cobre broadcast pra
// várias contas de uma vez desde o passo 3: mesma mídia + mesma legenda,
// publicadas em cada conta escolhida, com status individual por conta.
// Desde o passo 4, também aceita marcar a publicação como Reels — com
// "compartilhar no feed" (share_to_feed) e capa opcional (segunda mídia,
// position 1). Carrossel ainda não tem formulário próprio — chega no
// próximo passo, mas o desenho da tabela já suporta.
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const body = await req.json().catch(() => null);

  const caption = String(body?.caption ?? "");
  const scheduledAt = String(body?.scheduledAt ?? "");
  const accountIds: string[] = Array.isArray(body?.accountIds)
    ? body.accountIds.filter((x: unknown) => typeof x === "string" && x)
    : [];
  const media = body?.media as { url?: string; path?: string; mediaType?: MediaType } | undefined;
  const ehReels = Boolean(body?.ehReels);
  const shareToFeed = body?.shareToFeed !== false; // padrão: compartilha no feed também
  const capa = body?.capa as { url?: string; path?: string; mediaType?: MediaType } | null | undefined;

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
  if (ehReels && media.mediaType !== "VIDEO") {
    return NextResponse.json({ erro: "Reels precisa de um vídeo — a mídia enviada é uma foto." }, { status: 400 });
  }
  if (capa && (!capa.url || !capa.path || capa.mediaType !== "IMAGE")) {
    return NextResponse.json({ erro: "Capa inválida — envie uma imagem." }, { status: 400 });
  }

  const { data: contasEncontradas } = await admin.from("accounts").select("id").in("id", accountIds);
  if (!contasEncontradas || contasEncontradas.length !== accountIds.length) {
    return NextResponse.json({ erro: "Uma ou mais contas selecionadas não foram encontradas." }, { status: 404 });
  }

  const mediaType: FeedMediaType = ehReels ? "REELS" : media.mediaType;

  try {
    const { data: post, error: erroPost } = await admin
      .from("feed_posts")
      .insert({
        caption,
        scheduled_at: scheduledAt,
        media_type: mediaType,
        share_to_feed: ehReels ? shareToFeed : false,
      })
      .select("*")
      .single();

    if (erroPost || !post) throw new Error(erroPost?.message || "Erro ao criar a publicação.");

    // Mídia principal sempre na position 0. Se for Reels com capa enviada,
    // a capa entra como uma segunda linha (position 1) — o cron busca por
    // essa posição na hora de publicar.
    const midias = [
      {
        feed_post_id: post.id,
        position: 0,
        media_url: media.url,
        media_path: media.path,
        media_type: media.mediaType,
      },
    ];
    if (ehReels && capa?.url && capa?.path) {
      midias.push({
        feed_post_id: post.id,
        position: 1,
        media_url: capa.url,
        media_path: capa.path,
        media_type: "IMAGE",
      });
    }

    const { error: erroMedia } = await admin.from("feed_post_media").insert(midias);

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
      // Cascade cuida de apagar a(s) mídia(s) junto (on delete cascade em feed_post_media).
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
