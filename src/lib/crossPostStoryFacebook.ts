import { createAdminClient } from "@/lib/supabase/admin";
import { publicarStoryNaPagina } from "@/lib/meta";
import type { Account } from "@/types/database";

// Ponto único dos 3 motores de Stories (Agendador, Story Engine, AutoStory)
// pra também publicar o Story na Página do Facebook (pedido do Victor em
// 01/10/2026). Chamado só DEPOIS do Instagram já ter publicado e salvo o
// sucesso, e NUNCA lança erro: uma falha no Facebook (permissão, mídia
// recusada, lentidão) não pode virar falha, nova tentativa nem e-mail do
// Story do Instagram, que já saiu. O resultado fica em fb_stories_log.
//
// Tem limite de tempo próprio porque os motores rodam todos dentro de uma
// função de 60s da Vercel: um Facebook lento não pode atrasar as outras
// contas do mesmo ciclo.
const LIMITE_MS = 20_000;

export async function crossPostStoryFacebook(
  admin: ReturnType<typeof createAdminClient>,
  {
    conta,
    origem,
    refId,
    dia,
    mediaUrl,
    mediaType,
  }: {
    conta: Account;
    origem: "agendador" | "story_engine" | "autostory";
    refId: string;
    dia: string;
    mediaUrl: string;
    mediaType: "IMAGE" | "VIDEO";
  }
): Promise<void> {
  if (!conta.cross_post_facebook_stories) return;

  let status: "success" | "error" = "success";
  let erro: string | null = null;

  try {
    await Promise.race([
      publicarStoryNaPagina({ pageId: conta.page_id, pageAccessToken: conta.page_access_token, mediaUrl, mediaType }),
      new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error("Tempo esgotado esperando o Facebook.")), LIMITE_MS)),
    ]);
  } catch (err) {
    status = "error";
    erro = err instanceof Error ? err.message : "Erro desconhecido";
  }

  try {
    await admin
      .from("fb_stories_log")
      .upsert({ account_id: conta.id, origem, ref_id: refId, dia, status, erro }, { onConflict: "origem,ref_id,dia" });
  } catch {
    // Só o registro falhou — o Story em si já foi (ou não) pro Facebook.
  }
}
