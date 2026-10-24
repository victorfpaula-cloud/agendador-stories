import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import { manterBackupDoCiclo } from "@/lib/backupCiclo";
import { carregarDiasFechados, chaveDiaFechado } from "@/lib/diasFechados";

// Geração de Stories do Story Engine (banco de imagens por categoria, gira
// sem repetir) — pra cada horário ativo cujo dia da semana de hoje bate com
// os dias marcados na categoria, chama a função gerar_story_ciclo do banco
// (ver supabase/story-ciclo.sql). Diferente do AutoStory, aqui não baixa
// nada de lugar nenhum — a mídia já está no nosso Storage desde o upload —
// então essa etapa é só banco de dados, rápida e barata mesmo rodando com
// frequência. Extraído de /api/cron/gerar-stories-ciclo pra poder ser
// chamado tanto pela rota individual (debug manual) quanto pelo cron
// combinado /api/cron/gerar-tudo.
const MARGEM_MINUTOS = 30;

function minutosDoDia(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

export async function executarGeracaoStoriesCiclo(admin: ReturnType<typeof createAdminClient>) {
  const { dataISO, diaSemanaIso, horaMinuto } = agoraEmSaoPaulo();

  // Antes de gerar: restaura o que sumiu (se tiver cópia) e copia o que falta.
  const backup = await manterBackupDoCiclo(admin);

  const { data: horarios, error: erroHorarios } = await admin
    .from("story_ciclo_horario")
    .select("id, category_id, horario")
    .eq("is_active", true);

  if (erroHorarios) {
    return { erro: erroHorarios.message };
  }

  // Categorias pausadas (ativa = false) ficam de fora do mapa abaixo — o
  // filtro logo depois ("diasSemana?.includes") já pula qualquer horário
  // cuja categoria não apareceu aqui, sem precisar de checagem extra.
  const categoriaIds = Array.from(new Set((horarios ?? []).map((h) => h.category_id as string)));
  const { data: categorias, error: erroCategorias } = await admin
    .from("story_ciclo_categoria")
    .select("id, account_id, dias_semana")
    .eq("ativa", true)
    .in("id", categoriaIds.length > 0 ? categoriaIds : [""]);

  if (erroCategorias) {
    return { erro: erroCategorias.message };
  }

  const diasSemanaPorCategoria = new Map<string, number[]>(
    ((categorias ?? []) as { id: string; dias_semana: number[] }[]).map((c) => [c.id, c.dias_semana])
  );
  const contaPorCategoria = new Map<string, string>(
    ((categorias ?? []) as { id: string; account_id: string }[]).map((c) => [c.id, c.account_id])
  );
  // Conta com "dia fechado" hoje: nem gera o Story (não gasta imagem da fila).
  const fechados = await carregarDiasFechados(admin, [dataISO]);

  const resultados: Record<string, { gerado: boolean; motivo: string }> = {};

  for (const h of (horarios ?? []) as { id: string; category_id: string; horario: string }[]) {
    const diasSemana = diasSemanaPorCategoria.get(h.category_id);
    if (!diasSemana?.includes(diaSemanaIso)) continue;
    // Horário que já passou hoje (mais de 30 min atrás) não gera Story: o
    // publicador mandaria na hora, fora do horário combinado.
    if (minutosDoDia(h.horario) < minutosDoDia(horaMinuto) - MARGEM_MINUTOS) {
      resultados[h.id] = { gerado: false, motivo: "horario_ja_passou" };
      continue;
    }
    if (fechados.has(chaveDiaFechado(contaPorCategoria.get(h.category_id) ?? "", dataISO))) {
      resultados[h.id] = { gerado: false, motivo: "dia_fechado" };
      continue;
    }

    const { data } = await admin
      .rpc("gerar_story_ciclo", { p_horario_id: h.id, p_dia: dataISO })
      .single<{ gerado: boolean; motivo: string; post_id: string | null }>();

    resultados[h.id] = { gerado: !!data?.gerado, motivo: data?.motivo ?? "erro_desconhecido" };
  }

  return { dataISO, diaSemanaIso, resultados, backup };
}
