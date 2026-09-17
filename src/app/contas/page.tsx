import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
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

  // Quantos Stories automáticos do Drive já saíram hoje, por conta — só
  // aparece o card pras contas que têm essa automação configurada (evita
  // mostrar "0" pra quem nem usa esse recurso).
  const { data: storyDriveConfigs } = await admin.from("story_drive_config").select("account_id");
  const inicioDiaUTC = new Date(`${dataISO}T00:00:00-03:00`).toISOString();
  const fimDiaUTC = new Date(`${dataISO}T23:59:59-03:00`).toISOString();
  const { data: storiesHojeData } = await admin
    .from("story_posts")
    .select("account_id, status")
    .gte("scheduled_at", inicioDiaUTC)
    .lte("scheduled_at", fimDiaUTC);

  const storiesAutomaticosHoje: Record<string, { agendados: number; postados: number }> = {};
  for (const { account_id } of (storyDriveConfigs ?? []) as { account_id: string }[]) {
    storiesAutomaticosHoje[account_id] = { agendados: 0, postados: 0 };
  }
  for (const s of (storiesHojeData ?? []) as { account_id: string; status: string }[]) {
    if (!storiesAutomaticosHoje[s.account_id]) continue;
    storiesAutomaticosHoje[s.account_id].agendados += 1;
    if (s.status === "success") storiesAutomaticosHoje[s.account_id].postados += 1;
  }

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
        storiesAutomaticosHoje={storiesAutomaticosHoje}
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
