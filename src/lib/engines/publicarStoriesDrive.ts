import { createAdminClient } from "@/lib/supabase/admin";
import { publicarStory, MetaApiError } from "@/lib/meta";
import { enviarEmail } from "@/lib/email";
import type { Account, StoryPost } from "@/types/database";

function formatarDataHoraSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Motor de publicação do Story Automático via Drive (AutoStory). Extraído
// de /api/cron/publicar-stories-drive pra poder ser chamado tanto pela
// rota individual (debug manual) quanto pelo cron combinado
// /api/cron/publicar-tudo. Publica um story_posts de cada vez, na ordem em
// que vencem — se houver mais de um Story pendente pro mesmo horário (2 ou
// 3 arquivos no dia), saem em sequência, um atrás do outro.

// Uma falha só volta pra 'pending' (o próximo ciclo do cron, 5 min depois,
// tenta de novo sozinho) até esgotar essa quantidade de tentativas — só aí
// vira 'error' de verdade e manda o e-mail. Evita alarme falso por uma
// instabilidade passageira da Graph API.
const LIMITE_TENTATIVAS = 3;

export async function executarPublicarStoriesDrive(admin: ReturnType<typeof createAdminClient>) {
  const agoraISO = new Date().toISOString();

  const { data: devidos, error } = await admin
    .from("story_posts")
    .select("*, accounts(*)")
    .eq("status", "pending")
    .lte("scheduled_at", agoraISO)
    .order("scheduled_at", { ascending: true });

  if (error) {
    return { erro: error.message };
  }

  const resultados: Array<{ storyId: string; status: string; detalhe?: string }> = [];

  // Marca uma falha: se ainda não esgotou as tentativas, volta pra
  // 'pending' (o próximo ciclo do cron tenta de novo sozinho); só manda
  // e-mail quando já é a tentativa definitiva.
  async function falharTentativa(item: StoryPost, conta: Account, msg: string) {
    const tentativas = (item.tentativas ?? 0) + 1;
    const esgotou = tentativas >= LIMITE_TENTATIVAS;

    await admin
      .from("story_posts")
      .update({ status: esgotou ? "error" : "pending", tentativas, error_message: msg })
      .eq("id", item.id);

    resultados.push({ storyId: item.id, status: esgotou ? "error" : "pending", detalhe: msg });

    if (!esgotou) return;

    await enviarEmail({
      assunto: `Erro ao publicar Story automático (Drive) — ${conta.name}`,
      corpo:
        // scheduled_at nunca é nulo aqui — a consulta acima já filtra por
        // "lte scheduled_at" (que nunca bate contra null no Postgres).
        `A conta "${conta.name}" teve um erro ao tentar publicar um Story automático do Drive agendado ` +
        `pra ${formatarDataHoraSaoPaulo(item.scheduled_at as string)}, depois de ${tentativas} tentativas.\n\n` +
        `Erro: ${msg}\n\n` +
        `Publica esse Story manualmente.`,
    });
  }

  for (const item of (devidos ?? []) as (StoryPost & { accounts: Account })[]) {
    // Reivindica antes de publicar (update condicional em status='pending'):
    // se dois ciclos do cron se sobrepuserem, só um consegue "ganhar" o
    // Story — o outro vê 0 linhas afetadas e pula. Mesmo cuidado do motor
    // do Feed (feed_posts nunca é retentado depois de sair de 'pending',
    // então esse claim simples basta — diferente do motor semanal, que
    // precisa da função reivindicar_publicacao por causa da recorrência).
    const { data: reivindicado } = await admin
      .from("story_posts")
      .update({ status: "publishing" })
      .eq("id", item.id)
      .eq("status", "pending")
      .select("id");

    if (!reivindicado || reivindicado.length === 0) continue;

    const conta = item.accounts;

    if (!conta.is_active) {
      await falharTentativa(item, conta, "Conta está pausada — retome a conta pra publicar o Story.");
      continue;
    }

    if (!item.media_url) {
      await falharTentativa(item, conta, "A mídia original já não está mais disponível pra publicar (estado inesperado).");
      continue;
    }

    try {
      const igMediaId = await publicarStory({
        igUserId: conta.ig_user_id,
        pageAccessToken: conta.page_access_token,
        mediaUrl: item.media_url,
        mediaType: item.media_type,
      });

      await admin
        .from("story_posts")
        .update({ status: "success", ig_media_id: igMediaId, published_at: new Date().toISOString(), error_message: null })
        .eq("id", item.id);

      // Publicou com sucesso? O Instagram já buscou a mídia — a miniatura
      // (baixada do próprio Drive na hora da ingestão) continua
      // representando o Story na tela. Mesmo cuidado do Drive do Feed:
      // apaga o arquivo original na hora em vez de esperar a poda.
      if (item.media_path) {
        try {
          await admin.storage.from("story-media").remove([item.media_path]);
          await admin.from("story_posts").update({ media_url: null, media_path: null }).eq("id", item.id);
        } catch {
          // Ignorado de propósito — o pior caso é um arquivo esquecido no
          // bucket, não um Story com status errado.
        }
      }

      resultados.push({ storyId: item.id, status: "success" });
    } catch (err) {
      const msg = err instanceof MetaApiError || err instanceof Error ? err.message : "Erro desconhecido";
      await falharTentativa(item, conta, msg);
    }
  }

  const podados = await podarStoriesAntigos(admin);

  return {
    executadoEm: agoraISO,
    candidatos: (devidos ?? []).length,
    publicados: resultados.filter((r) => r.status === "success").length,
    falhas: resultados.filter((r) => r.status === "error").length,
    detalhes: resultados,
    podados,
  };
}

// Quantos Stories automáticos publicados ficam guardados na tela (só o
// registro + a miniatura — o arquivo original já foi apagado na hora, ver
// bloco acima). Mesmo padrão do Drive do Feed.
const LIMITE_STORIES_PUBLICADOS = 15;

async function podarStoriesAntigos(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  try {
    const { data: antigos } = await admin
      .from("story_posts")
      .select("id, media_path")
      .eq("status", "success")
      .order("published_at", { ascending: false })
      .range(LIMITE_STORIES_PUBLICADOS, LIMITE_STORIES_PUBLICADOS + 199);

    if (!antigos || antigos.length === 0) return 0;

    const { error } = await admin
      .from("story_posts")
      .delete()
      .in("id", antigos.map((p) => p.id));

    if (error) return 0;

    const paths = (antigos as { media_path: string | null }[]).map((p) => p.media_path).filter((p): p is string => !!p);
    if (paths.length > 0) {
      await admin.storage.from("story-media").remove(paths);
    }

    return antigos.length;
  } catch {
    return 0;
  }
}
