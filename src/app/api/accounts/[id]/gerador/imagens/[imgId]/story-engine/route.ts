import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { baixarDoBucket } from "@/lib/geradorImagens";

export const maxDuration = 30;

// Manda uma imagem da galeria do Gerador pra uma categoria do Story Engine da
// MESMA conta. O arquivo é copiado como está (bytes idênticos, sem nenhum
// reprocessamento) pro balde do Story Engine — este envio não adiciona nem
// remove nada do arquivo, inclusive sinais de origem por IA.
export async function POST(req: NextRequest, { params }: { params: { id: string; imgId: string } }) {
  const body = await req.json().catch(() => null);
  const categoryId = typeof body?.categoryId === "string" ? body.categoryId : "";
  if (!categoryId) return NextResponse.json({ erro: "Escolha uma categoria." }, { status: 400 });

  const admin = createAdminClient();

  const { data: categoria } = await admin
    .from("story_ciclo_categoria")
    .select("id, nome")
    .eq("id", categoryId)
    .eq("account_id", params.id)
    .maybeSingle();
  if (!categoria) return NextResponse.json({ erro: "Categoria não encontrada nessa conta." }, { status: 404 });

  const { data: img } = await admin
    .from("imagens_geradas")
    .select("id, storage_path")
    .eq("id", params.imgId)
    .eq("account_id", params.id)
    .maybeSingle();
  if (!img) return NextResponse.json({ erro: "Imagem não encontrada." }, { status: 404 });

  try {
    const arquivo = await baixarDoBucket(admin, img.storage_path);

    const path = `ciclo/${categoryId}/${randomUUID()}.jpg`;
    const { error: upErr } = await admin.storage.from("story-media").upload(path, arquivo, { contentType: "image/jpeg" });
    if (upErr) throw new Error(`Falha ao enviar pro Story Engine: ${upErr.message}`);
    const { data: pub } = admin.storage.from("story-media").getPublicUrl(path);

    // Miniatura pra lista da categoria (guardada como texto no banco).
    let thumbnail: string | null = null;
    try {
      const mini = await sharp(arquivo).resize(240, 240, { fit: "inside" }).jpeg({ quality: 60 }).toBuffer();
      thumbnail = `data:image/jpeg;base64,${mini.toString("base64")}`;
    } catch {
      thumbnail = null;
    }

    const { error } = await admin.from("story_ciclo_item").insert({
      category_id: categoryId,
      media_url: pub.publicUrl,
      media_path: path,
      media_type: "IMAGE",
      thumbnail_data_url: thumbnail,
    });
    if (error) {
      await admin.storage.from("story-media").remove([path]);
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, categoria: categoria.nome });
  } catch (err) {
    return NextResponse.json({ erro: err instanceof Error ? err.message : "Erro ao enviar pro Story Engine." }, { status: 500 });
  }
}
