import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MediaType } from "@/types/database";

// Galeria de uma categoria — usada quando a tela expande uma categoria pra
// gerenciar as imagens dela (a lista de categorias em si não carrega isso
// de cara, só a contagem — ver GET /api/accounts/[id]/ciclo-categorias).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("story_ciclo_item")
    .select("*")
    .eq("category_id", params.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ itens: data ?? [] });
}

// Adiciona um ou mais arquivos já enviados ao Storage (ver
// /api/uploads/signed-url) no balde da categoria — mesmo fluxo de upload
// direto do navegador já usado pelo resto do app.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const categoryId = params.id;

  const { data: categoria } = await admin.from("story_ciclo_categoria").select("id").eq("id", categoryId).maybeSingle();
  if (!categoria) {
    return NextResponse.json({ erro: "Categoria não encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const itens: { url?: string; path?: string; mediaType?: MediaType; thumbnailDataUrl?: string | null }[] = Array.isArray(
    body?.itens
  )
    ? body.itens
    : [];

  if (itens.length === 0) {
    return NextResponse.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  }
  if (itens.some((i) => !i.url || !i.path || !i.mediaType)) {
    return NextResponse.json({ erro: "Um ou mais arquivos ficaram incompletos — tente enviar de novo." }, { status: 400 });
  }

  const linhas = itens.map((i) => ({
    category_id: categoryId,
    media_url: i.url,
    media_path: i.path,
    media_type: i.mediaType,
    thumbnail_data_url: i.thumbnailDataUrl ?? null,
  }));

  const { data, error } = await admin.from("story_ciclo_item").insert(linhas).select("*");

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ itens: data ?? [] });
}
