import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Configuração do sub-módulo do Drive (passo 6, agora por conta desde a
// migração drive_config_por_conta — 16/09/2026) — uma linha por conta em
// drive_config, chave primária account_id. Protegida pela sessão normal
// (middleware.ts já exige login em qualquer rota que não esteja na lista de
// rotas públicas — essa não está, então só quem estiver logado acessa).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("drive_config").select("*").eq("account_id", params.id).maybeSingle();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ config: data });
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
  const horarioPublicacao = typeof body?.horarioPublicacao === "string" ? body.horarioPublicacao : "";

  if (!/^\d{2}:\d{2}$/.test(horarioPublicacao)) {
    return NextResponse.json({ erro: "Horário de publicação inválido." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("drive_config")
    .upsert(
      {
        account_id: accountId,
        pasta_drive_id: pastaDriveId || null,
        horario_publicacao: `${horarioPublicacao}:00`,
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
