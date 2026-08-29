import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedPost } from "@/types/database";

// Aba nova, separada da grade semanal de Stories: publicações avulsas
// agendadas no feed, Reels e carrossel. Por enquanto só confirma que a tabela
// existe e mostra um placeholder — o formulário de criar publicação vem no
// próximo passo. Não mexe em nada do motor de Stories.
export const dynamic = "force-dynamic";

export default async function PublicacoesPage() {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("feed_posts")
    .select("*")
    .order("scheduled_at", { ascending: true });

  const posts = (data ?? []) as FeedPost[];

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
          Não consegui ler a tabela de publicações ({error.message}). Se você acabou de rodar o
          SQL de criação, confirma se rodou sem erro no Supabase.
        </div>
      )}

      <div className="rounded-xl2 border-2 border-dashed border-slate-300 p-8 text-center text-slate-500">
        <p className="font-medium text-slate-700">Em construção</p>
        <p className="mt-1 text-sm">
          {posts.length === 0
            ? "Nenhuma publicação agendada ainda."
            : `${posts.length} publicação(ões) já no banco.`}{" "}
          O formulário pra criar uma nova publicação vem no próximo passo.
        </p>
      </div>
    </main>
  );
}
