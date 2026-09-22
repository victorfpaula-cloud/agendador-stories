import { NextRequest, NextResponse } from "next/server";
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

// Motor de publicação do CicloStory — rota própria, isolada dos outros
// três motores (Stories semanal, Drive do Feed, AutoStory), mesmo padrão de
// "reivindica antes de publicar" (update condicional em status='pending').
// Roda a cada 5 min, mesma cadência dos outros.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    .from("story_ciclo_posts")
    .select("*, accounts(*)")
    .eq("status", "pending")
    .lte("scheduled_at", agoraISO)
    .order("scheduled_at", { ascending: true });

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const resultados: Array<{ postId: string; status: string; detalhe?: string }> = [];

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
      const msg = "Conta está pausada — retome a conta pra publicar o Story.";
      await admin.from("story_ciclo_posts").update({ status: "error", error_message: msg }).eq("id", item.id);
      resultados.push({ postId: item.id, status: "error", detalhe: msg });
      continue;
    }

    if (!item.media_url) {
      const msg = "A mídia original já não está mais disponível pra publicar (estado inesperado).";
      await admin.from("story_ciclo_posts").update({ status: "error", error_message: msg }).eq("id", item.id);
      resultados.push({ postId: item.id, status: "error", detalhe: msg });
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

      await admin.from("story_ciclo_posts").update({ status: "error", error_message: msg }).eq("id", item.id);
      resultados.push({ postId: item.id, status: "error", detalhe: msg });

      await enviarEmail({
        assunto: `Erro ao publicar Story do CicloStory — ${conta.name}`,
        corpo:
          `A conta "${conta.name}" teve um erro ao tentar publicar um Story do CicloStory agendado ` +
          `pra ${formatarDataHoraSaoPaulo(item.scheduled_at)}.\n\n` +
          `Erro: ${msg}\n\n` +
          `Publica esse Story manualmente enquanto isso.`,
      });
    }
  }

  const podados = await podarPostsAntigos(admin);

  return NextResponse.json({
    executadoEm: agoraISO,
    candidatos: (devidos ?? []).length,
    publicados: resultados.filter((r) => r.status === "success").length,
    falhas: resultados.filter((r) => r.status === "error").length,
    detalhes: resultados,
    podados,
  });
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
