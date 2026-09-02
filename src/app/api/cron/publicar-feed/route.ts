import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicarPostFeed, publicarPostCarrossel, MetaApiError } from "@/lib/meta";
import type { Account, FeedPostAccount, FeedPostMedia } from "@/types/database";

// Motor de publicação do módulo de Publicações (feed/Reels/carrossel) — rota
// própria, separada de /api/cron/run (o motor de Stories), pra nunca correr
// risco de uma mexer na outra. Roda a cada 5 min (mesma cadência dos
// Stories), num agendamento próprio no Supabase Cron — ver
// supabase/cron-feed.sql.
//
// Passo 5: Carrossel também é suportado agora — os 3 tipos do fluxo manual
// (foto avulsa, Reels, carrossel) já publicam de verdade.
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

    // Sempre em ordem de position — pro carrossel isso é a ordem dos itens;
    // pra foto/Reels avulso é só a mídia única, na position 0.
    const midias = [...((post.feed_post_media ?? []) as FeedPostMedia[])].sort((a, b) => a.position - b.position);
    const contasAlvo = (post.feed_post_accounts ?? []) as (FeedPostAccount & { accounts: Account })[];

    if (midias.length === 0) {
      await admin
        .from("feed_posts")
        .update({ status: "error", error_message: "Publicação sem nenhuma mídia associada." })
        .eq("id", post.id);
      resultados.push({ postId: post.id, status: "error", detalhe: "sem mídia" });
      continue;
    }

    // Nunca deveria acontecer num post 'pending' recém-reivindicado (a
    // poda automática só mexe em posts 'success' — ver podarPublicacoesAntigas
    // no fim deste arquivo), mas o TypeScript não sabe disso e a checagem é
    // barata: se por algum motivo a mídia já não existir mais, marca erro
    // em vez de mandar uma URL nula pro Instagram.
    const midiaSemArquivo = midias.some((m) => !m.media_url);
    if (midiaSemArquivo) {
      await admin
        .from("feed_posts")
        .update({
          status: "error",
          error_message: "A mídia original já não está mais disponível pra publicar (estado inesperado).",
        })
        .eq("id", post.id);
      resultados.push({ postId: post.id, status: "error", detalhe: "mídia já removida" });
      continue;
    }
    const midiasComUrl = midias as (FeedPostMedia & { media_url: string })[];

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
        const igMediaId =
          post.media_type === "CAROUSEL"
            ? await publicarPostCarrossel({
                igUserId: conta.ig_user_id,
                pageAccessToken: conta.page_access_token,
                itens: midiasComUrl.map((m) => ({ mediaUrl: m.media_url, mediaType: m.media_type })),
                caption: post.caption,
              })
            : await publicarPostFeed({
                igUserId: conta.ig_user_id,
                pageAccessToken: conta.page_access_token,
                mediaUrl: midiasComUrl[0].media_url,
                mediaType: post.media_type === "REELS" ? "REELS" : midiasComUrl[0].media_type,
                caption: post.caption,
                shareToFeed: post.media_type === "REELS" ? post.share_to_feed : undefined,
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
    // A mídia original fica no Storage mesmo depois de publicar (ela é o que
    // a tela mostra até virar um post "antigo") — quem cuida de limpar isso
    // é a poda automática no fim desta rota, não aqui.
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

  const podados = await podarPublicacoesAntigas(admin);

  return NextResponse.json({
    executadoEm: agoraISO,
    candidatos: (devidos ?? []).length,
    publicados: resultados.filter((r) => r.status === "success").length,
    falhas: resultados.filter((r) => r.status === "error").length,
    detalhes: resultados,
    podados,
  });
}

// Quantas publicações já postadas ficam disponíveis na tela (com a mídia de
// verdade, não só a miniatura) antes de serem limpas pra não acumular
// arquivo pra sempre no Storage. Só conta publicações com status "success"
// — as pendentes/com erro nunca são tocadas aqui, precisam continuar
// visíveis até serem resolvidas.
const LIMITE_PUBLICACOES_PUBLICADAS = 15;

// Roda a cada ciclo do cron (a cada 5 min): busca publicações já postadas
// além das mais recentes (até 200 de uma vez, o suficiente pra zerar
// qualquer atraso em poucos ciclos) e apaga tudo — registro e arquivo no
// Storage. Best-effort e isolado: se algo aqui falhar, não afeta em nada o
// que já foi publicado acima nesta mesma execução.
async function podarPublicacoesAntigas(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  try {
    const { data: antigos } = await admin
      .from("feed_posts")
      .select("id, feed_post_media(media_path)")
      .eq("status", "success")
      .order("published_at", { ascending: false })
      .range(LIMITE_PUBLICACOES_PUBLICADAS, LIMITE_PUBLICACOES_PUBLICADAS + 199);

    if (!antigos || antigos.length === 0) return 0;

    const paths = (antigos as any[])
      .flatMap((p) => (p.feed_post_media ?? []).map((m: { media_path: string | null }) => m.media_path))
      .filter((p): p is string => !!p);

    const { error } = await admin
      .from("feed_posts")
      .delete()
      .in("id", antigos.map((p) => p.id));

    if (error) return 0;

    if (paths.length > 0) {
      await admin.storage.from("feed-media").remove(paths);
    }

    return antigos.length;
  } catch {
    return 0;
  }
}
