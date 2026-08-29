import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicarPostFeed, MetaApiError } from "@/lib/meta";
import type { Account, FeedPostAccount, FeedPostMedia } from "@/types/database";

// Motor de publicação do módulo de Publicações (feed/Reels/carrossel) — rota
// própria, separada de /api/cron/run (o motor de Stories), pra nunca correr
// risco de uma mexer na outra. Roda a cada 5 min (mesma cadência dos
// Stories), num agendamento próprio no Supabase Cron — ver
// supabase/cron-feed.sql.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return executar(req);
}

export async function POST(req: NextRequest) {
  return executar(req);
}

async function executar(req: NextRequest) {
  const segredoEsperado = process.env.CRON_SECRET;
  const segredoRecebido = req.headers.get("x-cron-secret");

  if (!segredoEsperado || segredoRecebido !== segredoEsperado) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const agoraISO = new Date().toISOString();

  const { data: devidos, error } = await admin
    .from("feed_posts")
    .select("*, feed_post_media(*), feed_post_accounts(*, accounts(*))")
    .eq("status", "pending")
    .lte("scheduled_at", agoraISO);

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const resultados: Array<{ postId: string; status: string; detalhe?: string }> = [];

  for (const post of (devidos ?? []) as any[]) {
    // Reivindica o post antes de publicar (update condicional em status='pending'):
    // se dois ciclos do cron se sobrepuserem por qualquer motivo, só um consegue
    // "ganhar" o post — o outro vê 0 linhas afetadas e pula. Mesmo cuidado que já
    // existe no motor de Stories contra publicação duplicada.
    const { data: reivindicado } = await admin
      .from("feed_posts")
      .update({ status: "publishing" })
      .eq("id", post.id)
      .eq("status", "pending")
      .select("id");

    if (!reivindicado || reivindicado.length === 0) continue;

    const midias = (post.feed_post_media ?? []) as FeedPostMedia[];
    const contasAlvo = (post.feed_post_accounts ?? []) as (FeedPostAccount & { accounts: Account })[];
    const midiaPrincipal = [...midias].sort((a, b) => a.position - b.position)[0];

    if (!midiaPrincipal) {
      await admin
        .from("feed_posts")
        .update({ status: "error", error_message: "Publicação sem nenhuma mídia associada." })
        .eq("id", post.id);
      resultados.push({ postId: post.id, status: "error", detalhe: "sem mídia" });
      continue;
    }

    if (post.media_type === "CAROUSEL" || post.media_type === "REELS") {
      const msg = `Publicação do tipo ${post.media_type} ainda não é suportada (chega em um próximo passo).`;
      await admin.from("feed_posts").update({ status: "error", error_message: msg }).eq("id", post.id);
      resultados.push({ postId: post.id, status: "error", detalhe: msg });
      continue;
    }

    let algumSucesso = false;
    let algumErro = false;

    for (const contaAlvo of contasAlvo) {
      const conta = contaAlvo.accounts;

      if (!conta.is_active) {
        await admin
          .from("feed_post_accounts")
          .update({ status: "error", error_message: "Conta está pausada — retome a conta pra publicar nela." })
          .eq("id", contaAlvo.id);
        algumErro = true;
        continue;
      }

      try {
        const igMediaId = await publicarPostFeed({
          igUserId: conta.ig_user_id,
          pageAccessToken: conta.page_access_token,
          mediaUrl: midiaPrincipal.media_url,
          mediaType: midiaPrincipal.media_type,
          caption: post.caption,
        });

        await admin
          .from("feed_post_accounts")
          .update({
            status: "success",
            ig_media_id: igMediaId,
            published_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", contaAlvo.id);

        algumSucesso = true;
      } catch (err) {
        const msg = err instanceof MetaApiError || err instanceof Error ? err.message : "Erro desconhecido";
        await admin
          .from("feed_post_accounts")
          .update({ status: "error", error_message: msg })
          .eq("id", contaAlvo.id);
        algumErro = true;
      }
    }

    // Status final do post: só "success" se TODAS as contas-alvo publicaram.
    // Com o fluxo manual de hoje (1 conta só) isso na prática é sempre
    // sucesso-total ou erro-total; quando o broadcast pra várias contas
    // chegar, vale revisar se "parcial" merece um status próprio.
    const statusFinal = algumErro ? "error" : "success";
    await admin
      .from("feed_posts")
      .update({
        status: statusFinal,
        published_at: algumSucesso ? new Date().toISOString() : null,
        error_message: algumErro ? "Falhou em pelo menos uma conta-alvo — veja o detalhe por conta." : null,
      })
      .eq("id", post.id);

    resultados.push({ postId: post.id, status: statusFinal });
  }

  return NextResponse.json({
    executadoEm: agoraISO,
    candidatos: (devidos ?? []).length,
    publicados: resultados.filter((r) => r.status === "success").length,
    falhas: resultados.filter((r) => r.status === "error").length,
    detalhes: resultados,
  });
}
