import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";

export const dynamic = "force-dynamic";

// Endpoint leve, só de leitura, usado pelo painel de "/contas" pra atualizar
// sozinho o resumo do dia (quantos posts já saíram, quantos deram erro) sem
// precisar recarregar a página inteira. Mesma lógica de cálculo que a página
// já usa no primeiro carregamento — só duas consultas, independente de
// quantas contas existirem. Fica protegido pelo middleware normal (exige
// sessão logada), como qualquer outra rota de API do app.
export async function GET() {
  const admin = createAdminClient();
  const { diaSemanaIso, dataISO } = agoraEmSaoPaulo();

  const { data: contas } = await admin.from("accounts").select("id");

  const { data: slotsHojeData } = await admin
    .from("schedule_slots")
    .select("account_id")
    .eq("day_of_week", diaSemanaIso)
    .eq("is_active", true);

  const { data: logsHojeData } = await admin
    .from("publish_log")
    .select("account_id, status")
    .eq("scheduled_for", dataISO);

  const resumo: Record<string, { total: number; postados: number; erros: number }> = {};
  for (const conta of (contas ?? []) as { id: string }[]) {
    resumo[conta.id] = { total: 0, postados: 0, erros: 0 };
  }
  for (const slot of (slotsHojeData ?? []) as { account_id: string }[]) {
    if (resumo[slot.account_id]) resumo[slot.account_id].total += 1;
  }
  for (const log of (logsHojeData ?? []) as { account_id: string | null; status: string }[]) {
    if (!log.account_id || !resumo[log.account_id]) continue;
    if (log.status === "success") resumo[log.account_id].postados += 1;
    if (log.status === "error") resumo[log.account_id].erros += 1;
  }

  return NextResponse.json({ diaHoje: diaSemanaIso, resumo });
}
