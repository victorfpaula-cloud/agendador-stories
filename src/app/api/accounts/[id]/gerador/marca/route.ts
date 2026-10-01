import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { POSICOES_LOGO } from "@/lib/geradorImagens";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: conta } = await admin.from("accounts").select("id").eq("id", params.id).maybeSingle();
  if (!conta) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  const body = await req.json().catch(() => null);
  const posicao = String(body?.logo_posicao ?? "");
  const tamanho = Number(body?.logo_tamanho_pct);
  const margem = Number(body?.logo_margem_pct);
  const estilo = String(body?.estilo ?? "").slice(0, 1500);

  if (!(POSICOES_LOGO as readonly string[]).includes(posicao)) return NextResponse.json({ erro: "Posição inválida." }, { status: 400 });
  if (!Number.isInteger(tamanho) || tamanho < 5 || tamanho > 60) return NextResponse.json({ erro: "Tamanho do logo inválido." }, { status: 400 });
  if (!Number.isInteger(margem) || margem < 0 || margem > 20) return NextResponse.json({ erro: "Margem inválida." }, { status: 400 });

  const { error } = await admin
    .from("gerador_marca")
    .upsert(
      { account_id: params.id, logo_posicao: posicao, logo_tamanho_pct: tamanho, logo_margem_pct: margem, estilo, updated_at: new Date().toISOString() },
      { onConflict: "account_id" }
    );
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
