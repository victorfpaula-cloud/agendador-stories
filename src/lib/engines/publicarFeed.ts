import { createAdminClient } from "@/lib/supabase/admin";
import { publicarPostFeed, publicarPostCarrossel, MetaApiError } from "@/lib/meta";
import { enviarEmail } from "@/lib/email";
import type { Account, FeedPostAccount, FeedPostMedia } from "@/types/database";

function formatarDataHoraSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Motor de publicação do módulo de Publicações (feed/Reels/carrossel).
// Extraído de /api/cron/publicar-feed pra poder ser chamado tanto pela
// rota individual (debug manual) quanto pelo cron combinado
// /api/cron/publicar-tudo.
//
// Passo 5: Carrossel também é suportado agora — os 3 tipos do fluxo manual
// (foto avulsa, Reels, carrossel) já publicam de verdade.

// Uma falha numa conta-alvo só volta pra 'pending' (o próximo ciclo do
// cron, 5 min depois, tenta de novo sozinho pra essa conta) até esgotar
// essa quantidade de tentativas — só aí vira 'error' de verdade pra essa
// conta e entra no e-mail. Contas que já publicaram com sucesso não são
// re-tentadas.
const LIMITE_TENTATIVAS = 3;

export async function executarPublicarFeed(admin: ReturnType<typeof createAdminClient>) {
  const agoraISO = new Date().toISOString();

  const { data: devidos, error } = await admin
    .from("feed_posts")
    .select("*, feed_post_media(*), feed_post_accounts(*, accounts(*))")
    .eq("status", "pending")
    .lte("scheduled_at", agoraISO);

  if (error) {
    return { erro: error.message };
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
    // Só as que ainda estão 'pending' — as que já publicaram ('success') ou
    // já esgotaram as tentativas ('error') não são tocadas de novo.
    const contasParaTentar = contasAlvo.filter((c) => c.status === "pending");

    if (midias.length === 0) {
      await admin
        .from("feed_posts")
        .update({ status: "error", error_message: "Publicação sem nenhuma mídia associada." })
        .eq("id", post.id);
      resultados.push({ postId: post.id, status: "error", detalhe: "sem mídia" });
      continue;
    }

    // Nunca deveria acontecer num post 'pending' recém-reivindicado (o
    // arquivo original só é apagado depois de status='success' — ver bloco
    // no fim deste loop), mas o TypeScript não sabe disso e a checagem é
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

    // Seeds a partir do estado que já veio de rodadas anteriores (posts
    // retentados passam por aqui de novo) — accounts 'success'/'error' de
    // antes contam pro resultado final mesmo que não sejam re-tentadas
    // nesta rodada.
    let algumSucesso = contasAlvo.some((c) => c.status === "success");
    let algumErroDefinitivo = contasAlvo.some((c) => c.status === "error");
    let aindaPendente = false;
    const falhasPorConta: { conta: string; mensagem: string }[] = [];

    async function falharTentativaConta(contaAlvo: FeedPostAccount, conta: Account, mensagem: string) {
      const tentativas = (contaAlvo.tentativas ?? 0) + 1;
      const esgotou = tentativas >= LIMITE_TENTATIVAS;
      await admin
        .from("feed_post_accounts")
        .update({ status: esgotou ? "error" : "pending", tentativas, error_message: mensagem })
        .eq("id", contaAlvo.id);

      if (esgotou) {
        algumErroDefinitivo = true;
        falhasPorConta.push({ conta: conta.name, mensagem });
      } else {
        aindaPendente = true;
      }
    }

    for (const contaAlvo of contasParaTentar) {
      const conta = contaAlvo.accounts;

      if (!conta.is_active) {
        await falharTentativaConta(contaAlvo, conta, "Conta está pausada — retome a conta pra publicar nela.");
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
        await falharTentativaConta(contaAlvo, conta, msg);
      }
    }

    // Status final do post: "pending" enquanto sobrar conta ainda
    // tentando, "success" só se TODAS as contas-alvo publicaram, "error" se
    // pelo menos uma esgotou as tentativas.
    const statusFinal = aindaPendente ? "pending" : algumErroDefinitivo ? "error" : "success";
    await admin
      .from("feed_posts")
      .update({
        status: statusFinal,
        published_at: algumSucesso ? new Date().toISOString() : null,
        error_message: algumErroDefinitivo ? "Falhou em pelo menos uma conta-alvo — veja o detalhe por conta." : null,
      })
      .eq("id", post.id);

    // Só manda e-mail quando o post realmente chegou num estado final
    // ("error" só acontece depois de esgotar as tentativas de cada conta
    // que falhou) — enquanto estiver "pending" o próximo ciclo do cron
    // tenta de novo sozinho, sem alarme falso por uma falha passageira.
    if (statusFinal === "error") {
      await enviarEmail({
        assunto: `Erro ao publicar no Feed — ${post.media_type}`,
        corpo:
          `A publicação agendada pra ${formatarDataHoraSaoPaulo(post.scheduled_at)} teve erro em ` +
          `${falhasPorConta.length} conta(s):\n\n` +
          falhasPorConta.map((f) => `• ${f.conta}: ${f.mensagem}`).join("\n") +
          `\n\nPublica manualmente enquanto isso.`,
      });
    }

    // Publicou com sucesso em todas as contas-alvo? A mídia original não
    // precisa mais ficar no Storage — o Instagram já buscou ela na hora de
    // publicar, e a miniatura pequena (gerada no navegador pro fluxo manual,
    // ou pelo próprio Drive pro fluxo automático — sempre presente antes do
    // post chegar aqui) continua representando o post na tela. Apaga na
    // hora, em vez de esperar a poda dos 15 mais antigos: mídia original
    // costuma ser MB, a miniatura é só alguns KB de texto no banco — não
    // faz sentido manter o arquivo grande por dias só pra um post que já
    // foi ao ar. Best-effort: se der algum problema aqui, não desfaz nem
    // afeta o status já salvo acima — o pior caso é um arquivo esquecido no
    // bucket, não um post com status errado.
    if (statusFinal === "success") {
      try {
        const paths = midias.map((m) => m.media_path).filter((p): p is string => !!p);
        if (paths.length > 0) {
          await admin.storage.from("feed-media").remove(paths);
        }
        await admin
          .from("feed_post_media")
          .update({ media_url: null, media_path: null })
          .eq("feed_post_id", post.id);
      } catch {
        // Ignorado de propósito — ver comentário acima.
      }
    }

    resultados.push({ postId: post.id, status: statusFinal });
  }

  const podados = await podarPublicacoesAntigas(admin);

  return {
    executadoEm: agoraISO,
    candidatos: (devidos ?? []).length,
    publicados: resultados.filter((r) => r.status === "success").length,
    falhas: resultados.filter((r) => r.status === "error").length,
    detalhes: resultados,
    podados,
  };
}

// Quantos posts publicados ficam guardados na tela (só o registro + a
// miniatura pequena — o arquivo original já foi apagado na hora, ver bloco
// acima). Só conta publicações com status "success" — as pendentes/com erro
// nunca são tocadas aqui, precisam continuar visíveis até serem resolvidas.
const LIMITE_PUBLICACOES_PUBLICADAS = 15;

// Roda a cada ciclo do cron (a cada 5 min): apaga o registro dos posts
// publicados mais antigos que isso (até 200 de uma vez, o suficiente pra
// zerar qualquer atraso em poucos ciclos) — normalmente não sobra arquivo
// nenhum no Storage pra remover aqui (isso já foi feito na hora da
// publicação), mas o remove() abaixo cobre qualquer caso em que aquele
// passo tenha falhado antes. Best-effort e isolado: se algo aqui falhar,
// não afeta em nada o que já foi publicado acima nesta mesma execução.
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
