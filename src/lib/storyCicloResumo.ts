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
  const [{ data: horarios }, { data: categorias }, { data: postsHoje }] = await Promise.all([
    admin.from("story_ciclo_horario").select("id, category_id").eq("is_active", true),
    admin.from("story_ciclo_categoria").select("id, account_id, dias_semana").eq("ativa", true),
    admin.from("story_ciclo_posts").select("account_id, horario_id, status").eq("dia", dataISO),
  ]);

  const categoriasPorId = new Map<string, { account_id: string; dias_semana: number[] }>();
  for (const c of (categorias ?? []) as { id: string; account_id: string; dias_semana: number[] }[]) {
    categoriasPorId.set(c.id, c);
  }

  const resultado: Record<string, { agendados: number; postados: number }> = {};
  const agendadosIds = new Set<string>();
  for (const h of (horarios ?? []) as { id: string; category_id: string }[]) {
    const categoria = categoriasPorId.get(h.category_id);
    if (!categoria || !categoria.dias_semana.includes(diaSemanaIso)) continue;
    if (!resultado[categoria.account_id]) resultado[categoria.account_id] = { agendados: 0, postados: 0 };
    resultado[categoria.account_id].agendados += 1;
    agendadosIds.add(h.id);
  }

  // Cada horário conta uma vez só. Story de hoje já publicado por um horário
  // que depois foi removido/pausado conta nos dois lados (nunca "3 de 2").
  const contados = new Set<string>();
  for (const p of (postsHoje ?? []) as { account_id: string; horario_id: string | null; status: string }[]) {
    if (p.status !== "success") continue;
    if (p.horario_id && agendadosIds.has(p.horario_id)) {
      if (contados.has(p.horario_id)) continue;
      contados.add(p.horario_id);
      if (resultado[p.account_id]) resultado[p.account_id].postados += 1;
    } else {
      if (!resultado[p.account_id]) resultado[p.account_id] = { agendados: 0, postados: 0 };
      resultado[p.account_id].agendados += 1;
      resultado[p.account_id].postados += 1;
    }
  }

  return resultado;
}
