import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Account, StoryCicloCategoria } from "@/types/database";
import ContaTabs from "../ContaTabs";
import CicloClient, { type CategoriaComHorarios, type Contagem } from "./CicloClient";

// CicloStory: banco de imagens/vídeos por categoria, que gira sem repetir.
// Módulo isolado de AutoFeed/AutoStory — tabelas, rotas e crons próprios,
// sem nenhum ponto de contato por baixo dos panos (ver src/lib para os dois
// robôs: /api/cron/gerar-stories-ciclo e /api/cron/publicar-stories-ciclo).
export const dynamic = "force-dynamic";

export default async function StoryCicloPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: conta } = await admin.from("accounts").select("*").eq("id", params.id).maybeSingle();
  if (!conta) notFound();

  const { data: categorias, error } = await admin
    .from("story_ciclo_categoria")
    .select("*, story_ciclo_horario(*)")
    .eq("account_id", params.id)
    .order("created_at", { ascending: true });

  const categoriaIds = ((categorias ?? []) as StoryCicloCategoria[]).map((c) => c.id);
  const contagens: Record<string, Contagem> = {};
  for (const id of categoriaIds) contagens[id] = { total: 0, usadas: 0 };

  if (categoriaIds.length > 0) {
    const { data: itens } = await admin
      .from("story_ciclo_item")
      .select("category_id, usado_em")
      .in("category_id", categoriaIds);

    for (const item of (itens ?? []) as { category_id: string; usado_em: string | null }[]) {
      if (!contagens[item.category_id]) continue;
      contagens[item.category_id].total += 1;
      if (item.usado_em) contagens[item.category_id].usadas += 1;
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4">
        <Link href="/contas" className="text-sm text-slate-500 hover:underline">
          ← Todas as contas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{(conta as Account).name}</h1>
        <p className="text-sm text-slate-500">
          Cada categoria gira as próprias imagens sem repetir: sempre publica a que está há mais tempo sem uso.
        </p>
      </div>

      <ContaTabs accountId={(conta as Account).id} />

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          Não consegui carregar as categorias ({error.message}).
        </div>
      )}

      <CicloClient
        accountId={params.id}
        initialCategorias={(categorias ?? []) as CategoriaComHorarios[]}
        initialContagens={contagens}
      />
    </main>
  );
}
