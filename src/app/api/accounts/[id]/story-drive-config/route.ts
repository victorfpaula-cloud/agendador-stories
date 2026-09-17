import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Configuração do Story Automático via Drive — uma linha por conta em
// story_drive_config (account_id é a chave primária), com até 5 horários
// (um por arquivo do dia, ver storyDriveIngestao.ts). Protegida pela sessão
// normal (middleware.ts já exige login em qualquer rota que não esteja na
// lista de rotas públicas — essa não está).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("story_drive_config")
    .select("*")
    .eq("account_id", params.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ config: data });
}

// Aceita "HH:MM" (do <input type="time">) ou string vazia/nula (campo em
// branco = essa posição não publica nada).
function normalizarHorario(valor: unknown): string | null {
  if (typeof valor !== "string" || !valor) return null;
  if (!/^\d{2}:\d{2}$/.test(valor)) throw new Error("Horário inválido.");
  return `${valor}:00`;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accountId = params.id;

  const { data: conta } = await admin.from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const pastaDriveId = typeof body?.pastaDriveId === "string" ? body.pastaDriveId.trim() : "";

  let horarios: (string | null)[];
  try {
    horarios = [1, 2, 3, 4, 5].map((n) => normalizarHorario(body?.[`horario${n}`]));
  } catch {
    return NextResponse.json({ erro: "Um dos horários está inválido." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("story_drive_config")
    .upsert(
      {
        account_id: accountId,
        pasta_drive_id: pastaDriveId || null,
        horario_1: horarios[0],
        horario_2: horarios[1],
        horario_3: horarios[2],
        horario_4: horarios[3],
        horario_5: horarios[4],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ config: data });
}
