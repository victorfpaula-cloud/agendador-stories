import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";

// Cron do CicloStory (banco de imagens por categoria, gira sem repetir) —
// roda a cada 30 min, igual o AutoStory, e pra cada horário ativo cujo dia
// da semana de hoje bate com os dias marcados na categoria, chama a função
// gerar_story_ciclo do banco (ver supabase/story-ciclo.sql). Diferente do
// AutoStory, aqui não baixa nada de lugar nenhum — a mídia já está no nosso
// Storage desde o upload — então essa etapa é só banco de dados, rápida e
// barata mesmo rodando com frequência. Isolado de AutoFeed/AutoStory:
// tabelas, rotas e crons próprios, sem nenhum ponto de contato.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return executar(req);
}

export async function POST(req: NextRequest) {
  return executar(req);
}

async function executar(req: NextRequest) {
  const segredoEsperado = process.env.CRON_SECRET;
  const segredoRecebido = req.headers.get("x-cron-secret");

  if (!segredoEsperado || segredoRecebido !== segredoEsperado) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { dataISO, diaSemanaIso } = agoraEmSaoPaulo();

  const { data: horarios, error: erroHorarios } = await admin
    .from("story_ciclo_horario")
    .select("id, category_id")
    .eq("is_active", true);

  if (erroHorarios) {
    return NextResponse.json({ erro: erroHorarios.message }, { status: 500 });
  }

  const categoriaIds = Array.from(new Set((horarios ?? []).map((h) => h.category_id as string)));
  const { data: categorias, error: erroCategorias } = await admin
    .from("story_ciclo_categoria")
    .select("id, dias_semana")
    .in("id", categoriaIds.length > 0 ? categoriaIds : [""]);

  if (erroCategorias) {
    return NextResponse.json({ erro: erroCategorias.message }, { status: 500 });
  }

  const diasSemanaPorCategoria = new Map<string, number[]>(
    ((categorias ?? []) as { id: string; dias_semana: number[] }[]).map((c) => [c.id, c.dias_semana])
  );

  const resultados: Record<string, { gerado: boolean; motivo: string }> = {};

  for (const h of (horarios ?? []) as { id: string; category_id: string }[]) {
    const diasSemana = diasSemanaPorCategoria.get(h.category_id);
    if (!diasSemana?.includes(diaSemanaIso)) continue;

    const { data } = await admin
      .rpc("gerar_story_ciclo", { p_horario_id: h.id, p_dia: dataISO })
      .single<{ gerado: boolean; motivo: string; post_id: string | null }>();

    resultados[h.id] = { gerado: !!data?.gerado, motivo: data?.motivo ?? "erro_desconhecido" };
  }

  return NextResponse.json({ dataISO, diaSemanaIso, resultados });
}
