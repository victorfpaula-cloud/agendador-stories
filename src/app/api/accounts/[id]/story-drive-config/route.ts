import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Configuração do Story Automático via Drive — uma linha por conta em
// story_drive_config (account_id é a chave primária). Desde 17/09/2026 só
// guarda a pasta do Drive — o horário de cada Story vem embutido no nome do
// arquivo (ver storyDriveIngestao.ts), não é mais configurado aqui. Protegida
// pela sessão normal (middleware.ts já exige login em qualquer rota que não
// esteja na lista de rotas públicas — essa não está).
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

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accountId = params.id;

  const { data: conta } = await admin.from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const pastaDriveId = typeof body?.pastaDriveId === "string" ? body.pastaDriveId.trim() : "";

  const { data, error } = await admin
    .from("story_drive_config")
    .upsert(
      {
        account_id: accountId,
        pasta_drive_id: pastaDriveId || null,
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
