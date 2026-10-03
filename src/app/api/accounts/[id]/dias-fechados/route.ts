import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";

// Dias em que a conta não publica nada (ver src/lib/diasFechados.ts).
function diaValido(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { dataISO } = agoraEmSaoPaulo();
  const { data, error } = await admin
    .from("dias_fechados")
    .select("dia, motivo")
    .eq("account_id", params.id)
    .gte("dia", dataISO)
    .order("dia", { ascending: true });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ dias: data ?? [], hoje: dataISO });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const dia: unknown = body?.dia;
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim().slice(0, 120) : "";
  if (!diaValido(dia)) return NextResponse.json({ erro: "Escolha uma data válida." }, { status: 400 });

  const { dataISO } = agoraEmSaoPaulo();
  if (dia < dataISO) return NextResponse.json({ erro: "Essa data já passou." }, { status: 400 });

  const admin = createAdminClient();
  const { data: conta } = await admin.from("accounts").select("id").eq("id", params.id).maybeSingle();
  if (!conta) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  const { error } = await admin
    .from("dias_fechados")
    .upsert({ account_id: params.id, dia, motivo: motivo || null }, { onConflict: "account_id,dia" });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const dia = req.nextUrl.searchParams.get("dia");
  if (!diaValido(dia)) return NextResponse.json({ erro: "Data inválida." }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin.from("dias_fechados").delete().eq("account_id", params.id).eq("dia", dia);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
