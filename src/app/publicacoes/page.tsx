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
      <div className="mb-4">
        <Link href="/contas" className="text-sm text-slate-500 hover:underline">
          ← Todas as contas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Publicações</h1>
        <p className="text-sm text-slate-500">
          Feed, Reels e carrossel — agendamento avulso, separado da rotina semanal de Stories.
        </p>
      </div>

      <Link
        href="/publicacoes/drive"
        className="group mb-8 flex items-center gap-3 rounded-xl2 bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-teal-300"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 group-hover:bg-teal-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900 group-hover:text-teal-700">Automação do Drive</p>
          <p className="text-sm text-slate-500">O robô publica sozinho, todo dia, direto de uma pasta do Drive</p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-teal-400">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Link>

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
