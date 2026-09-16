import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Account, FeedPostComDetalhes } from "@/types/database";
import ContaTabs from "../ContaTabs";
import PublicacoesClient from "./PublicacoesClient";

// Publicações (feed/Reels/carrossel) dessa conta — parte do redesign que
// tirou Publicações de uma tela global solta e colocou dentro de cada
// conta, como aba irmã de Stories (ver ContaTabs). O broadcast pra várias
// contas de uma vez continua existindo (não mudou), só a entrada mudou: ao
// abrir por aqui, a conta atual já vem pré-marcada, mas dá pra marcar
// outras também.
export const dynamic = "force-dynamic";

export default async function PublicacoesDaContaPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: conta } = await admin.from("accounts").select("*").eq("id", params.id).maybeSingle();
  if (!conta) notFound();

  const { data: contas } = await admin
    .from("accounts")
    .select("id, name, ig_username")
    .eq("is_active", true)
    .order("name", { ascending: true });

  const { data: posts, error } = await admin
    .from("feed_posts")
    .select("*, feed_post_media(*), feed_post_accounts!inner(*, accounts(id, name, ig_username))")
    .eq("feed_post_accounts.account_id", params.id)
    .order("scheduled_at", { ascending: true });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4">
        <Link href="/contas" className="text-sm text-slate-500 hover:underline">
          ← Todas as contas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{(conta as Account).name}</h1>
        <p className="text-sm text-slate-500">Feed, Reels e carrossel — agendamento avulso.</p>
      </div>

      <ContaTabs accountId={(conta as Account).id} />

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          Não consegui ler as publicações ({error.message}).
        </div>
      )}

      <PublicacoesClient
        accounts={contas ?? []}
        defaultAccountId={(conta as Account).id}
        initialPosts={(posts ?? []) as FeedPostComDetalhes[]}
      />
    </main>
  );
}
