import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import type { Account, PublishLog, ScheduleSlot } from "@/types/database";
import WeekEditor from "./WeekEditor";

export const dynamic = "force-dynamic";

export default async function ContaPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: conta } = await admin.from("accounts").select("*").eq("id", params.id).maybeSingle();
  if (!conta) notFound();

  const { data: slots } = await admin
    .from("schedule_slots")
    .select("*")
    .eq("account_id", params.id)
    .order("time_of_day", { ascending: true });

  // Status de publicação de hoje (pra bolinha colorida): só busca os logs do dia
  // atual, já que é o único dia em que "aguardando/publicado/erro" faz sentido —
  // dias futuros ainda não tiveram nenhuma tentativa.
  const { diaSemanaIso, dataISO } = agoraEmSaoPaulo();
  const { data: logs } = await admin
    .from("publish_log")
    .select("*")
    .eq("account_id", params.id)
    .eq("scheduled_for", dataISO);

  const logsHoje: Record<string, "success" | "error"> = {};
  for (const log of (logs ?? []) as PublishLog[]) {
    if (log.slot_id) logsHoje[log.slot_id] = log.status;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Link href="/contas" className="text-sm text-slate-500 hover:underline">
            ← Todas as contas
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{(conta as Account).name}</h1>
          <p className="text-sm text-slate-500">
            {(conta as Account).ig_username ? `@${(conta as Account).ig_username}` : "Instagram conectado"} ·
            rotina semanal de Stories
          </p>
        </div>
        <a
          href="/api/accounts/connect"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-brand-400 hover:text-brand-600"
        >
          Reconectar
        </a>
      </div>

      <WeekEditor
        accountId={(conta as Account).id}
        initialSlots={(slots ?? []) as ScheduleSlot[]}
        diaHoje={diaSemanaIso}
        logsHoje={logsHoje}
      />
    </main>
  );
}
