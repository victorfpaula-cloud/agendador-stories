import { createAdminClient } from "@/lib/supabase/admin";
import { publicarStory, MetaApiError } from "@/lib/meta";
import { crossPostStoryFacebook } from "@/lib/crossPostStoryFacebook";
import { enviarEmail } from "@/lib/email";
import { MENSAGEM_DIA_FECHADO, carregarDiasFechados, chaveDiaFechado } from "@/lib/diasFechados";

// Motor do Agendamento Único: cada linha de story_unico_posts é um Story de
// um dia. Mesmo padrão dos outros motores (reivindica, 3 tentativas, e-mail
// só no erro definitivo, respeita "dias fechados"). As linhas do mesmo
// grupo dividem UM arquivo — ele só é apagado quando nenhuma linha do grupo
// está mais pendente.
const LIMITE_TENTATIVAS = 3;

type Linha = {
  id: string;
  grupo_id: string;
  account_id: string;
  dia: string;
  scheduled_at: string;
  media_url: string | null;
  media_path: string | null;
  media_type: "IMAGE" | "VIDEO";
  tentativas: number;
  accounts: import("@/types/database").Account;
};

export async function executarPublicarStoriesUnico(admin: ReturnType<typeof createAdminClient>) {
  const { data: devidos, error } = await admin
    .from("story_unico_posts")
    .select("*, accounts(*)")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true });
  if (error) return { erro: error.message };

  const lista = (devidos ?? []) as Linha[];
  const fechados = await carregarDiasFechados(admin, lista.map((l) => l.dia));
  const resultados: { id: string; status: string; detalhe?: string }[] = [];

  async function limparArquivoSeAcabou(grupoId: string, path: string | null) {
    if (!path) return;
    const { count } = await admin
      .from("story_unico_posts")
      .select("id", { count: "exact", head: true })
      .eq("grupo_id", grupoId)
      .in("status", ["pending", "publishing"]);
    if ((count ?? 0) === 0) {
      await admin.storage.from("story-media").remove([path]);
      await admin.from("story_unico_posts").update({ media_url: null, media_path: null }).eq("grupo_id", grupoId);
    }
  }

  for (const item of lista) {
    if (fechados.has(chaveDiaFechado(item.account_id, item.dia))) {
      await admin.from("story_unico_posts").update({ status: "error", error_message: MENSAGEM_DIA_FECHADO }).eq("id", item.id).eq("status", "pending");
      resultados.push({ id: item.id, status: "fechado" });
      await limparArquivoSeAcabou(item.grupo_id, item.media_path);
      continue;
    }

    const { data: reivindicado } = await admin
      .from("story_unico_posts")
      .update({ status: "publishing" })
      .eq("id", item.id)
      .eq("status", "pending")
      .select("id");
    if (!reivindicado || reivindicado.length === 0) continue;

    const conta = item.accounts;

    async function falhar(msg: string) {
      const tentativas = (item.tentativas ?? 0) + 1;
      const esgotou = tentativas >= LIMITE_TENTATIVAS;
      await admin.from("story_unico_posts").update({ status: esgotou ? "error" : "pending", tentativas, error_message: msg }).eq("id", item.id);
      resultados.push({ id: item.id, status: esgotou ? "error" : "pending", detalhe: msg });
      if (!esgotou) return;
      await enviarEmail({
        assunto: `Erro ao publicar Story (Agendamento Único) — ${conta.name}`,
        corpo: `A conta "${conta.name}" teve um erro ao publicar um Story do Agendamento Único (dia ${item.dia}), depois de ${tentativas} tentativas.\n\nErro: ${msg}\n\nPublica esse Story manualmente.`,
      });
      await limparArquivoSeAcabou(item.grupo_id, item.media_path);
    }

    if (!conta.is_active) {
      await falhar("Conta está pausada — retome a conta pra publicar o Story.");
      continue;
    }
    if (!item.media_url) {
      await falhar("A mídia já não está mais disponível pra publicar.");
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
        .from("story_unico_posts")
        .update({ status: "success", ig_media_id: igMediaId, published_at: new Date().toISOString(), error_message: null })
        .eq("id", item.id);

      await crossPostStoryFacebook(admin, {
        conta,
        origem: "agendador",
        refId: item.id,
        dia: item.dia,
        mediaUrl: item.media_url,
        mediaType: item.media_type,
      });

      resultados.push({ id: item.id, status: "success" });
      await limparArquivoSeAcabou(item.grupo_id, item.media_path);
    } catch (err) {
      await falhar(err instanceof MetaApiError || err instanceof Error ? err.message : "Erro desconhecido");
    }
  }

  return { candidatos: lista.length, detalhes: resultados };
}
