import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Account } from "@/types/database";
import LogoutButton from "./LogoutButton";

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {lista.map((conta) => (
          <Link
            key={conta.id}
            href={`/contas/${conta.id}`}
            className="group rounded-xl2 bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-brand-200"
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-600">
              {conta.name.charAt(0).toUpperCase()}
            </div>
            <p className="font-medium text-slate-900 group-hover:text-brand-700">{conta.name}</p>
            <p className="text-sm text-slate-500">
              {conta.ig_username ? `@${conta.ig_username}` : "Instagram conectado"}
            </p>
          </Link>
        ))}

        <a
          href="/api/auth/facebook"
          className="flex flex-col items-center justify-center rounded-xl2 border-2 border-dashed border-slate-300 p-5 text-slate-500 transition hover:border-brand-400 hover:text-brand-600"
        >
          <span className="mb-1 text-2xl leading-none">+</span>
          <span className="text-sm font-medium">Adicionar conta</span>
        </a>
      </div>

      {lista.length > 0 && (
        <p className="mt-8 text-xs text-slate-400">
          Token de uma conta expirando ou publicações falhando por erro de permissão? Clique em
          "Adicionar conta" de novo e escolha a mesma página — isso renova a conexão sem duplicar nada.
        </p>
      )}
    </main>
  );
}
