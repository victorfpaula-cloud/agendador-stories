import { createAdminClient } from "@/lib/supabase/admin";
import type { Account } from "@/types/database";
import LogoutButton from "./LogoutButton";
import ListaContas from "./ListaContas";

export const dynamic = "force-dynamic";

export default async function ContasPage({
  searchParams,
}: {
  searchParams: { erro?: string };
}) {
  const admin = createAdminClient();
  const { data: contas } = await admin
    .from("accounts")
    .select("*")
    .order("name", { ascending: true });

  const lista = (contas ?? []) as Account[];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Suas contas</h1>
          <p className="text-sm text-slate-500">
            Escolha uma conta pra ver e editar a rotina semanal de Stories.
          </p>
        </div>
        <LogoutButton />
      </div>

      {searchParams.erro && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {searchParams.erro}
        </div>
      )}

      <ListaContas initialContas={lista} />

      {lista.length > 0 && (
        <p className="mt-8 text-xs text-slate-400">
          Token de uma conta expirando ou publicações falhando por erro de permissão? Clique em
          "Adicionar conta" de novo e escolha a mesma página — isso renova a conexão sem duplicar nada.
          Uma conta pausada não publica nada até você retomá-la, e nada é apagado nesse caso.
        </p>
      )}
    </main>
  );
}
