import { createAdminClient } from "@/lib/supabase/admin";
import { publicarStory, MetaApiError } from "@/lib/meta";
import { enviarEmail } from "@/lib/email";
import type { Account, StoryCicloPost } from "@/types/database";

function formatarDataHoraSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Motor de publicação do CicloStory. Extraído de
// /api/cron/publicar-stories-ciclo pra poder ser chamado tanto pela rota
// individual (debug manual) quanto pelo cron combinado
// /api/cron/publicar-tudo. Mesmo padrão de "reivindica antes de publicar"
// (update condicional em status='pending') dos outros motores.

// Uma falha só volta pra 'pending' (o próximo ciclo do cron, 5 min depois,
// tenta de novo sozinho) até esgotar essa quantidade de tentativas — só aí
// vira 'error' de verdade e manda o e-mail.
const LIMITE_TENTATIVAS = 3;

export async function executarPublicarStoriesCiclo(admin: ReturnType<typeof createAdminClient>) {
  const agoraISO = new Date().toISOString();

  const { data: devidos, error } = await admin
    .from("story_ciclo_posts")
    .select("*, accounts(*)")
    .eq("status", "pending")
    .lte("scheduled_at", agoraISO)
    .order("scheduled_at", { ascending: true });

  if (error) {
    return { erro: error.message };
  }

  const resultados: Array<{ postId: string; status: string; detalhe?: string }> = [];

  async function falharTentativa(item: StoryCicloPost, conta: Account, msg: string) {
    const tentativas = (item.tentativas ?? 0) + 1;
    const esgotou = tentativas >= LIMITE_TENTATIVAS;

    await admin
      .from("story_ciclo_posts")
      .update({ status: esgotou ? "error" : "pending", tentativas, error_message: msg })
      .eq("id", item.id);

    resultados.push({ postId: item.id, status: esgotou ? "error" : "pending", detalhe: msg });

    if (!esgotou) return;

    await enviarEmail({
      assunto: `Erro ao publicar Story do CicloStory — ${conta.name}`,
      corpo:
        `A conta "${conta.name}" teve um erro ao tentar publicar um Story do CicloStory agendado ` +
        `pra ${formatarDataHoraSaoPaulo(item.scheduled_at)}, depois de ${tentativas} tentativas.\n\n` +
        `Erro: ${msg}\n\n` +
        `Publica esse Story manualmente.`,
    });
  }

  for (const item of (devidos ?? []) as (StoryCicloPost & { accounts: Account })[]) {
    const { data: reivindicado } = await admin
      .from("story_ciclo_posts")
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
        .from("story_ciclo_posts")
        .update({ status: "success", ig_media_id: igMediaId, published_at: new Date().toISOString(), error_message: null })
        .eq("id", item.id);

      // Publicou com sucesso? Apaga só a CÓPIA do arquivo original (que
      // ficou reservada pra esse Story específico) — o item continua no
      // balde da categoria, pronto pra ser escolhido de novo quando a vez
      // dele voltar. A miniatura continua representando o Story na tela.
      if (item.media_path) {
        try {
          await admin.storage.from("story-media").remove([item.media_path]);
          await admin.from("story_ciclo_posts").update({ media_url: null, media_path: null }).eq("id", item.id);
        } catch {
          // Ignorado de propósito — o pior caso é um arquivo esquecido no
          // bucket, não um Story com status errado.
        }
      }

      resultados.push({ postId: item.id, status: "success" });
    } catch (err) {
      const msg = err instanceof MetaApiError || err instanceof Error ? err.message : "Erro desconhecido";
      await falharTentativa(item, conta, msg);
    }
  }

  const podados = await podarPostsAntigos(admin);

  return {
    executadoEm: agoraISO,
    candidatos: (devidos ?? []).length,
    publicados: resultados.filter((r) => r.status === "success").length,
    falhas: resultados.filter((r) => r.status === "error").length,
    detalhes: resultados,
    podados,
  };
}

// Mesmo padrão do AutoStory: só guarda os últimos N publicados com sucesso
// na tela, pra não crescer sem limite.
const LIMITE_POSTS_PUBLICADOS = 15;

async function podarPostsAntigos(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  try {
    const { data: antigos } = await admin
      .from("story_ciclo_posts")
      .select("id, media_path")
      .eq("status", "success")
      .order("published_at", { ascending: false })
      .range(LIMITE_POSTS_PUBLICADOS, LIMITE_POSTS_PUBLICADOS + 199);

    if (!antigos || antigos.length === 0) return 0;

    const { error } = await admin
      .from("story_ciclo_posts")
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
