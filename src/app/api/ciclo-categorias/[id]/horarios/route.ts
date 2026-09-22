import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Aceita "HH:MM" (do <input type="time">).
function normalizarHorario(valor: unknown): string | null {
  if (typeof valor !== "string" || !/^\d{2}:\d{2}$/.test(valor)) return null;
  return `${valor}:00`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const categoryId = params.id;

  const { data: categoria } = await admin.from("story_ciclo_categoria").select("id").eq("id", categoryId).maybeSingle();
  if (!categoria) {
    return NextResponse.json({ erro: "Categoria não encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const horario = normalizarHorario(body?.horario);
  if (!horario) {
    return NextResponse.json({ erro: "Horário inválido." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("story_ciclo_horario")
    .insert({ category_id: categoryId, horario })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ horario: data });
}
