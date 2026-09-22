import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizarHorario(valor: unknown): string | null {
  if (typeof valor !== "string" || !/^\d{2}:\d{2}$/.test(valor)) return null;
  return `${valor}:00`;
}

// Pausar/reativar um horário, ou mudar a hora dele — pausar não apaga o
// histórico de Stories que ele já gerou, só impede o robô de gerar novos.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = {};

  if (typeof body?.isActive === "boolean") {
    patch.is_active = body.isActive;
  }
  if (body?.horario !== undefined) {
    const horario = normalizarHorario(body.horario);
    if (!horario) return NextResponse.json({ erro: "Horário inválido." }, { status: 400 });
    patch.horario = horario;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ erro: "Nada pra atualizar." }, { status: 400 });
  }

  const { data, error } = await admin.from("story_ciclo_horario").update(patch).eq("id", params.id).select("*").single();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ horario: data });
}

// Apaga o horário — os Stories que ele já gerou continuam no histórico
// (horario_id vira uma referência "orfã" só no sentido de não ter mais o
// registro do horário, mas a linha em si não é afetada).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { error } = await admin.from("story_ciclo_horario").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
