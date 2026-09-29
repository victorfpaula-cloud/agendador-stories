import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listarPaginasGerenciadas } from "@/lib/meta";

// Renova o page_access_token de UMA conta de uma vez só, sem passar pela
// tela de escolher a Página: usa o INSTAGRAM_ACCESS_TOKEN atual (o mesmo do
// fluxo "Adicionar conta"), acha entre as Páginas que ele enxerga a que tem
// o mesmo page_id da conta e grava o token novo dela. Serve pra pegar
// permissão nova (ex: pages_manage_posts do cross-post) ou trocar um token
// vencido, sem mexer em mais nada da conta — inclusive sem despausar.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: conta } = await admin.from("accounts").select("id, page_id").eq("id", params.id).maybeSingle();
  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ erro: "Token de acesso não configurado no servidor." }, { status: 500 });
  }

  try {
    const paginas = await listarPaginasGerenciadas(token);
    const pagina = paginas.find((p) => p.id === conta.page_id);
    if (!pagina) {
      return NextResponse.json(
        { erro: "Essa Página não aparece pro token configurado. Gere o token de novo marcando essa Página." },
        { status: 404 }
      );
    }

    const { error } = await admin
      .from("accounts")
      .update({ page_access_token: pagina.access_token, token_obtained_at: new Date().toISOString() })
      .eq("id", conta.id);

    if (error) {
      return NextResponse.json({ erro: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao reconectar.";
    return NextResponse.json({ erro: msg }, { status: 502 });
  }
}
