import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizarDiasSemana(valor: unknown): number[] | null {
  if (!Array.isArray(valor)) return null;
  const dias = valor.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 1 && v <= 7);
  return Array.from(new Set(dias)).sort();
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = {};

  if (typeof body?.nome === "string") {
    const nome = body.nome.trim();
    if (!nome) return NextResponse.json({ erro: "O nome não pode ficar em branco." }, { status: 400 });
    patch.nome = nome;
  }

  if (body?.diasSemana !== undefined) {
    const dias = normalizarDiasSemana(body.diasSemana);
    if (!dias || dias.length === 0) {
      return NextResponse.json({ erro: "Marca pelo menos um dia da semana." }, { status: 400 });
    }
    patch.dias_semana = dias;
  }

  if (typeof body?.ativa === "boolean") {
    patch.ativa = body.ativa;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ erro: "Nada pra atualizar." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("story_ciclo_categoria")
    .update(patch)
    .eq("id", params.id)
    .select("*, story_ciclo_horario(*)")
    .single();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ categoria: data });
}

// Apaga a categoria inteira — horários e itens do balde saem junto (cascade
// no banco). Os arquivos no Storage são apagados aqui, um por um, melhor
// esforço (o pior caso, se algo falhar, é um arquivo órfão no bucket).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: itens } = await admin.from("story_ciclo_item").select("media_path").eq("category_id", params.id);

  const { error } = await admin.from("story_ciclo_categoria").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const paths = ((itens ?? []) as { media_path: string }[]).map((i) => i.media_path).filter(Boolean);
  if (paths.length > 0) {
    try {
      await admin.storage.from("story-media").remove(paths);
    } catch {
      // Ignorado de propósito — ver comentário acima.
    }
  }

  return NextResponse.json({ ok: true });
}
