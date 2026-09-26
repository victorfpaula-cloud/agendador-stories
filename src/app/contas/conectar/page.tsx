import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PendingConnectionPage } from "@/types/database";
import { conectarPagina } from "./actions";

export default async function ConectarPage({
  searchParams,
}: {
  searchParams: { pid?: string };
}) {
  const pendingId = searchParams.pid;

  if (!pendingId) {
    return <Mensagem texto="Link inválido." />;
  }

  const admin = createAdminClient();
  const { data: pending } = await admin
    .from("pending_connections")
    .select("payload")
    .eq("id", pendingId)
    .maybeSingle();

  if (!pending) {
    return <Mensagem texto='Essa sessão de conexão expirou. Volte e clique em "Adicionar conta" de novo.' />;
  }

  const paginas = pending.payload as PendingConnectionPage[];

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-2 text-xl font-semibold text-slate-900">Escolha a página pra conectar</h1>
      <p className="mb-6 text-sm text-slate-500">
        Encontramos {paginas.length} página{paginas.length > 1 ? "s" : ""} do Facebook com Instagram
        profissional vinculado nessa conta. Clique em "Conectar" na que você quer adicionar (ou
        reconectar, se ela já existir).
      </p>

      <div className="space-y-3">
        {paginas.map((p) => (
          <form
            key={p.page_id}
            action={conectarPagina}
            className="flex items-center justify-between rounded-xl2 bg-white p-4 shadow-sm ring-1 ring-slate-200"
          >
            <input type="hidden" name="pendingId" value={pendingId} />
            <input type="hidden" name="pageId" value={p.page_id} />
            <div>
              <p className="font-medium text-slate-900">{p.name}</p>
              <p className="text-sm text-slate-500">
                {p.ig_username ? `@${p.ig_username}` : "conta do Instagram vinculada"}
              </p>
            </div>
            <button
              type="submit"
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600"
            >
              Conectar
            </button>
          </form>
        ))}
      </div>

      <Link href="/contas" className="mt-6 inline-block text-sm text-slate-500 hover:underline">
        Cancelar e voltar
      </Link>
    </main>
  );
}

function Mensagem({ texto }: { texto: string }) {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="text-slate-600">{texto}</p>
      <Link href="/contas" className="mt-4 inline-block text-brand-600 hover:underline">
        Voltar
      </Link>
    </main>
  );
}
