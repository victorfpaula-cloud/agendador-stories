import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Configuração do sub-módulo do Drive (passo 6) — linha única (id fixo = 1)
// na tabela drive_config. Só guarda a configuração por enquanto; nenhum cron
// lê essa tabela ainda (isso chega no passo 7). Protegida pela sessão normal
// (middleware.ts já exige login em qualquer rota que não esteja na lista de
// rotas públicas — essa não está, então só quem estiver logado acessa).
export async function GET() {
  const admin = createAdminClient();
  const { data, error } = await admin.from("drive_config").select("*").eq("id", 1).maybeSingle();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ config: data });
}

export async function PUT(req: NextRequest) {
  const admin = createAdminClient();
  const body = await req.json().catch(() => null);

  const pastaDriveId = typeof body?.pastaDriveId === "string" ? body.pastaDriveId.trim() : "";
  const horarioPublicacao = typeof body?.horarioPublicacao === "string" ? body.horarioPublicacao : "";
  const accountIds: string[] = Array.isArray(body?.accountIds)
    ? body.accountIds.filter((x: unknown) => typeof x === "string" && x)
    : [];

  if (!/^\d{2}:\d{2}$/.test(horarioPublicacao)) {
    return NextResponse.json({ erro: "Horário de publicação inválido." }, { status: 400 });
  }

  // Mesma checagem usada em /api/feed-posts: se alguma conta escolhida não
  // existir (id inválido, por exemplo), rejeita em vez de salvar mesmo assim.
  if (accountIds.length > 0) {
    const { data: contasEncontradas } = await admin.from("accounts").select("id").in("id", accountIds);
    if (!contasEncontradas || contasEncontradas.length !== accountIds.length) {
      return NextResponse.json({ erro: "Uma ou mais contas selecionadas não foram encontradas." }, { status: 404 });
    }
  }

  const { data, error } = await admin
    .from("drive_config")
    .update({
      pasta_drive_id: pastaDriveId || null,
      horario_publicacao: `${horarioPublicacao}:00`,
      account_ids: accountIds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ config: data });
}
