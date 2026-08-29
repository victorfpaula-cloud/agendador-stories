import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedPostComDetalhes } from "@/types/database";
import PublicacoesClient from "./PublicacoesClient";

// Aba nova, separada da grade semanal de Stories: publicações avulsas
// agendadas no feed, Reels e carrossel. Passo 2: fluxo manual mínimo (1
// mídia, 1 conta, legenda, data/hora) já publicando de verdade via o cron
// próprio em /api/cron/publicar-feed. Broadcast pra várias contas, Reels e
// carrossel chegam nos próximos passos. Não mexe em nada do motor de Stories.
export const dynamic = "force-dynamic";

export default async function PublicacoesPage() {
  const admin = createAdminClient();

  const { data: contas } = await admin
    .from("accounts")
    .select("id, name, ig_username")
    .eq("is_active", true)
    .order("name", { ascending: true });

  const { data: posts, error } = await admin
    .from("feed_posts")
    .select("*, feed_post_media(*), feed_post_accounts(*, accounts(id, name, ig_username))")
    .order("scheduled_at", { ascending: true });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-start justify-between gap-3">
        <div>
          <Link href="/contas" className="text-sm text-slate-500 hover:underline">
            ← Todas as contas
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Publicações</h1>
          <p className="text-sm text-slate-500">
            Feed, Reels e carrossel — agendamento avulso, separado da rotina semanal de Stories.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          Não consegui ler as publicações ({error.message}).
        </div>
      )}

      <PublicacoesClient
        accounts={contas ?? []}
        initialPosts={(posts ?? []) as FeedPostComDetalhes[]}
      />
    </main>
  );
}
