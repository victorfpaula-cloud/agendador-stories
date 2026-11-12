import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ajustarParaStory } from "@/lib/storyProporcao";

export const maxDuration = 60;

// Adiciona artes já enviadas ao Storage (upload direto do navegador).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const tipo = body?.tipo;
  const itens: { url?: string; path?: string; mediaType?: "IMAGE" | "VIDEO"; thumbnailDataUrl?: string | null }[] = Array.isArray(body?.itens) ? body.itens : [];
  if (tipo !== "chuva" && tipo !== "calor" && tipo !== "frio") return NextResponse.json({ erro: "Tipo inválido." }, { status: 400 });
  if (itens.length === 0) return NextResponse.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  if (itens.some((i) => !i.url || !i.path || !i.mediaType)) return NextResponse.json({ erro: "Arquivo incompleto — tente de novo." }, { status: 400 });

  const admin = createAdminClient();
  // Foto fora de 9:16 é cortada no centro (mesmo ajuste do Story Engine).
  for (const it of itens) {
    if (it.mediaType !== "IMAGE" || !it.path) continue;
    const ajustado = await ajustarParaStory(admin, it.path);
    if (ajustado) {
      it.url = ajustado.url;
      it.path = ajustado.path;
      it.thumbnailDataUrl = ajustado.thumbnailDataUrl;
    }
  }

  const { data, error } = await admin
    .from("story_weather_itens")
    .insert(itens.map((i) => ({ account_id: params.id, tipo, media_url: i.url, media_path: i.path, media_type: i.mediaType, thumbnail_data_url: i.thumbnailDataUrl ?? null })))
    .select("id, tipo, media_url, media_type, thumbnail_data_url, usado_em, created_at");
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ itens: data ?? [] });
}
