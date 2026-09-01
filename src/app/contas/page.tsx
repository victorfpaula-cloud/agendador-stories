import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import { buscarFotoDePerfilInstagram } from "@/lib/meta";
import type { Account } from "@/types/database";
import LogoutButton from "./LogoutButton";
import ListaContas, { type ResumoDoDia } from "./ListaContas";

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

  // Resumo do dia por conta (pra mostrar "3 de 10 postados" nos cards).
  // Só duas consultas no total, independente de quantas contas existirem.
  const { diaSemanaIso, dataISO } = agoraEmSaoPaulo();

  const { data: slotsHojeData } = await admin
    .from("schedule_slots")
    .select("account_id")
    .eq("day_of_week", diaSemanaIso)
    .eq("is_active", true);

  const { data: logsHojeData } = await admin
    .from("publish_log")
    .select("account_id, status")
    .eq("scheduled_for", dataISO);

  const resumoHoje: Record<string, ResumoDoDia> = {};
  for (const conta of lista) {
    resumoHoje[conta.id] = { total: 0, postados: 0, erros: 0 };
  }
  for (const slot of (slotsHojeData ?? []) as { account_id: string }[]) {
    if (resumoHoje[slot.account_id]) resumoHoje[slot.account_id].total += 1;
  }
  for (const log of (logsHojeData ?? []) as { account_id: string | null; status: string }[]) {
    if (!log.account_id || !resumoHoje[log.account_id]) continue;
    if (log.status === "success") resumoHoje[log.account_id].postados += 1;
    if (log.status === "error") resumoHoje[log.account_id].erros += 1;
  }

  // Avatares são buscados direto na Graph API a cada carregamento (a URL do
  // Meta expira, então não vale guardar no banco). Uma conta com token
  // vencido ou instável não deve derrubar a tela inteira — só fica sem foto.
  const avataresPorConta: Record<string, string | null> = {};
  await Promise.all(
    lista.map(async (conta) => {
      try {
        avataresPorConta[conta.id] = await buscarFotoDePerfilInstagram(
          conta.ig_user_id,
          conta.page_access_token
        );
      } catch {
        avataresPorConta[conta.id] = null;
      }
    })
  );

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

      <ListaContas
        initialContas={lista}
        diaHoje={diaSemanaIso}
        resumoHoje={resumoHoje}
        avataresPorConta={avataresPorConta}
      />

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
