import { createAdminClient } from "@/lib/supabase/admin";

// Resumo do Story Engine pra hoje, por conta — usado tanto na primeira
// carga de /contas quanto no recheck automático (resumo-do-dia). "Agendados"
// não vem de story_ciclo_posts (que só existe depois que o cron de geração
// já rodou pra aquele horário) e sim direto de horário ativo + categoria
// ativa + dia da semana batendo com hoje — mesma lógica usada no
// "containerzinho fantasma" da tela de Stories (ver WeekEditor.tsx), assim
// o número aparece certo mesmo cedo no dia, antes da geração ter passado
// por todos os horários. Só entram contas com pelo menos 1 horário
// agendado hoje — sem isso, toda conta sem usar o recurso mostraria "0/0"
// à toa.
export async function buscarStoryEngineHoje(
  admin: ReturnType<typeof createAdminClient>,
  diaSemanaIso: number,
  dataISO: string
): Promise<Record<string, { agendados: number; postados: number }>> {
  const { data: horarios } = await admin
    .from("story_ciclo_horario")
    .select("id, category_id")
    .eq("is_active", true);

  const { data: categorias } = await admin
    .from("story_ciclo_categoria")
    .select("id, account_id, dias_semana")
    .eq("ativa", true);

  const { data: postsHoje } = await admin
    .from("story_ciclo_posts")
    .select("account_id, status")
    .eq("dia", dataISO);

  const categoriasPorId = new Map<string, { account_id: string; dias_semana: number[] }>();
  for (const c of (categorias ?? []) as { id: string; account_id: string; dias_semana: number[] }[]) {
    categoriasPorId.set(c.id, c);
  }

  const resultado: Record<string, { agendados: number; postados: number }> = {};
  for (const h of (horarios ?? []) as { id: string; category_id: string }[]) {
    const categoria = categoriasPorId.get(h.category_id);
    if (!categoria || !categoria.dias_semana.includes(diaSemanaIso)) continue;
    if (!resultado[categoria.account_id]) resultado[categoria.account_id] = { agendados: 0, postados: 0 };
    resultado[categoria.account_id].agendados += 1;
  }

  for (const p of (postsHoje ?? []) as { account_id: string; status: string }[]) {
    if (!resultado[p.account_id]) continue;
    if (p.status === "success") resultado[p.account_id].postados += 1;
  }

  return resultado;
}
