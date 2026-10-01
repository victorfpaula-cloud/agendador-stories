import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_GERADOR } from "@/lib/geradorImagens";

const MIMES_OK = new Set(["image/png", "image/jpeg", "image/webp"]);

// Guarda o logo como PNG (mantém transparência). Só limita o tamanho máximo
// (2000px) — não recorta, não filtra, não recolore. A cópia guardada é a que
// vai ser colada, idêntica, em toda imagem.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: conta } = await admin.from("accounts").select("id").eq("id", params.id).maybeSingle();
  if (!conta) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("logo");
  if (!(arquivo instanceof File)) return NextResponse.json({ erro: "Envie o arquivo do logo." }, { status: 400 });
  if (!MIMES_OK.has(arquivo.type)) return NextResponse.json({ erro: "O logo precisa ser PNG (de preferência com fundo transparente), JPG ou WebP." }, { status: 400 });
  if (arquivo.size > 4_000_000) return NextResponse.json({ erro: "Logo grande demais (máx. 4MB)." }, { status: 400 });

  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await arquivo.arrayBuffer()))
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return NextResponse.json({ erro: "Não consegui ler esse arquivo como imagem." }, { status: 400 });
  }

  const path = `${params.id}/logo-${randomUUID()}.png`;
  const { error: upErr } = await admin.storage.from(BUCKET_GERADOR).upload(path, png, { contentType: "image/png" });
  if (upErr) return NextResponse.json({ erro: `Falha ao salvar o logo: ${upErr.message}` }, { status: 500 });

  const { data: antigo } = await admin.from("gerador_marca").select("logo_path").eq("account_id", params.id).maybeSingle();
  const { error } = await admin
    .from("gerador_marca")
    .upsert({ account_id: params.id, logo_path: path, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  if (antigo?.logo_path) await admin.storage.from(BUCKET_GERADOR).remove([antigo.logo_path]);

  const { data: pub } = admin.storage.from(BUCKET_GERADOR).getPublicUrl(path);
  return NextResponse.json({ logo_url: pub.publicUrl });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: marca } = await admin.from("gerador_marca").select("logo_path").eq("account_id", params.id).maybeSingle();
  if (marca?.logo_path) {
    await admin.storage.from(BUCKET_GERADOR).remove([marca.logo_path]);
    await admin.from("gerador_marca").update({ logo_path: null }).eq("account_id", params.id);
  }
  return NextResponse.json({ ok: true });
}
