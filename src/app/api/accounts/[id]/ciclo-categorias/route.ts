import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Lista/cria categorias do Story Engine de uma conta. Cada categoria já é o
// "slot" completo: nome + dias da semana ativos — os horários e as imagens
// vivem em tabelas próprias, geridas pelas rotas de baixo
// (ciclo-categorias/[id]/horarios e /itens).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: categorias, error } = await admin
    .from("story_ciclo_categoria")
    .select("*, story_ciclo_horario(*)")
    .eq("account_id", params.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const categoriaIds = (categorias ?? []).map((c) => c.id);
  const contagens: Record<string, { total: number; usadas: number }> = {};
  for (const id of categoriaIds) contagens[id] = { total: 0, usadas: 0 };

  if (categoriaIds.length > 0) {
    const { data: itens } = await admin
      .from("story_ciclo_item")
      .select("category_id, usado_em")
      .in("category_id", categoriaIds);

    for (const item of (itens ?? []) as { category_id: string; usado_em: string | null }[]) {
      if (!contagens[item.category_id]) continue;
      contagens[item.category_id].total += 1;
      if (item.usado_em) contagens[item.category_id].usadas += 1;
    }
  }

  return NextResponse.json({ categorias: categorias ?? [], contagens });
}

function normalizarDiasSemana(valor: unknown): number[] {
  if (!Array.isArray(valor)) return [1, 2, 3, 4, 5, 6, 7];
  const dias = valor.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 1 && v <= 7);
  return dias.length > 0 ? Array.from(new Set(dias)).sort() : [1, 2, 3, 4, 5, 6, 7];
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accountId = params.id;

  const { data: conta } = await admin.from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  if (!nome) {
    return NextResponse.json({ erro: "Dá um nome pra categoria." }, { status: 400 });
  }
  const diasSemana = normalizarDiasSemana(body?.diasSemana);

  const { data, error } = await admin
    .from("story_ciclo_categoria")
    .insert({ account_id: accountId, nome, dias_semana: diasSemana })
    .select("*, story_ciclo_horario(*)")
    .single();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ categoria: data });
}
