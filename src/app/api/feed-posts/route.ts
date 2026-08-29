import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedMediaType, MediaType } from "@/types/database";

// Cria uma publicação agendada (feed/Reels/carrossel). Cobre broadcast pra
// várias contas de uma vez desde o passo 3: mesma mídia + mesma legenda,
// publicadas em cada conta escolhida, com status individual por conta.
// Desde o passo 5, o TIPO do post é decidido automaticamente pela
// quantidade/tipo de arquivo enviado — sem precisar marcar nada na tela:
// 1 vídeo = Reels, 1 foto = post normal no feed, 2 ou mais arquivos =
// carrossel (pode misturar foto e vídeo).
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const body = await req.json().catch(() => null);

  const caption = String(body?.caption ?? "");
  const scheduledAt = String(body?.scheduledAt ?? "");
  const accountIds: string[] = Array.isArray(body?.accountIds)
    ? body.accountIds.filter((x: unknown) => typeof x === "string" && x)
    : [];
  const mediaItems: { url?: string; path?: string; mediaType?: MediaType }[] = Array.isArray(body?.media)
    ? body.media
    : [];

  if (accountIds.length === 0) {
    return NextResponse.json({ erro: "Escolha ao menos uma conta." }, { status: 400 });
  }
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
    return NextResponse.json({ erro: "Escolha uma data e horário válidos." }, { status: 400 });
  }
  if (new Date(scheduledAt).getTime() <= Date.now()) {
    return NextResponse.json({ erro: "A data/horário do agendamento precisa ser no futuro." }, { status: 400 });
  }
  if (mediaItems.length === 0) {
    return NextResponse.json({ erro: "Envie ao menos uma foto ou vídeo antes de agendar." }, { status: 400 });
  }
  if (mediaItems.length > 10) {
    return NextResponse.json({ erro: "Carrossel aceita no máximo 10 arquivos." }, { status: 400 });
  }
  if (mediaItems.some((m) => !m.url || !m.path || !m.mediaType)) {
    return NextResponse.json(
      { erro: "Um ou mais arquivos enviados ficaram incompletos — tente enviar de novo." },
      { status: 400 }
    );
  }

  const { data: contasEncontradas } = await admin.from("accounts").select("id").in("id", accountIds);
  if (!contasEncontradas || contasEncontradas.length !== accountIds.length) {
    return NextResponse.json({ erro: "Uma ou mais contas selecionadas não foram encontradas." }, { status: 404 });
  }

  // Tipo decidido só pela quantidade/tipo de arquivo: 1 vídeo vira Reels,
  // 1 foto vira post normal, 2 ou mais (qualquer mistura) vira carrossel.
  const mediaType: FeedMediaType =
    mediaItems.length > 1 ? "CAROUSEL" : mediaItems[0].mediaType === "VIDEO" ? "REELS" : "IMAGE";

  try {
    const { data: post, error: erroPost } = await admin
      .from("feed_posts")
      .insert({
        caption,
        scheduled_at: scheduledAt,
        media_type: mediaType,
        share_to_feed: mediaType === "REELS", // Reels sempre aparece no feed também — sem precisar escolher
      })
      .select("*")
      .single();

    if (erroPost || !post) throw new Error(erroPost?.message || "Erro ao criar a publicação.");

    // Uma linha por arquivo enviado, na ordem em que foram escolhidos — pro
    // carrossel isso vira a ordem dos itens; pra foto/Reels avulso é só uma
    // linha só, na position 0.
    const midias = mediaItems.map((m, index) => ({
      feed_post_id: post.id,
      position: index,
      media_url: m.url,
      media_path: m.path,
      media_type: m.mediaType,
    }));

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
