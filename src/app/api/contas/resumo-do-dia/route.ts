import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import { AUTOSTORY_ATIVO } from "@/lib/funcoesEmStandby";
import { calcularResumoSemanal } from "@/lib/resumoDoDia";
import { carregarDiasFechados } from "@/lib/diasFechados";
import { buscarStoryEngineHoje } from "@/lib/storyCicloResumo";

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

  // Consultas em paralelo (antes uma depois da outra). AutoStory em stand-by
  // não consulta nada.
  const [{ data: contas }, { data: slotsHojeData }, { data: logsHojeData }, storyDriveConfigs, storiesHojeData, storyEngineHoje, fechados] =
    await Promise.all([
      admin.from("accounts").select("id"),
      admin.from("schedule_slots").select("id, account_id").eq("day_of_week", diaSemanaIso).eq("is_active", true),
      admin.from("publish_log").select("account_id, slot_id, status").eq("scheduled_for", dataISO),
      AUTOSTORY_ATIVO ? admin.from("story_drive_config").select("account_id").then((r) => r.data) : Promise.resolve([]),
      AUTOSTORY_ATIVO ? admin.from("story_posts").select("account_id, status").eq("dia", dataISO).then((r) => r.data) : Promise.resolve([]),
      buscarStoryEngineHoje(admin, diaSemanaIso, dataISO),
      carregarDiasFechados(admin, [dataISO]),
    ]);

  const resumo = calcularResumoSemanal(
    ((contas ?? []) as { id: string }[]).map((c) => c.id),
    (slotsHojeData ?? []) as { id: string; account_id: string }[],
    (logsHojeData ?? []) as { account_id: string | null; slot_id: string | null; status: string }[],
    fechados,
    dataISO
  );

  // Mesma ideia do resumo acima, mas pro card do robô do Story Automático
  // Drive (só aparece pras contas que têm essa automação configurada).
  // Por `dia` (não por scheduled_at) — um Story sem horário reconhecido
  // ainda conta como "agendado hoje" mesmo com scheduled_at nulo.

  const storiesAutomaticosHoje: Record<string, { agendados: number; postados: number }> = {};
  for (const { account_id } of (storyDriveConfigs ?? []) as { account_id: string }[]) {
    storiesAutomaticosHoje[account_id] = { agendados: 0, postados: 0 };
  }
  for (const s of (storiesHojeData ?? []) as { account_id: string; status: string }[]) {
    if (!storiesAutomaticosHoje[s.account_id]) continue;
    storiesAutomaticosHoje[s.account_id].agendados += 1;
    if (s.status === "success") storiesAutomaticosHoje[s.account_id].postados += 1;
  }

  return NextResponse.json({ diaHoje: diaSemanaIso, resumo, storiesAutomaticosHoje, storyEngineHoje });
}
