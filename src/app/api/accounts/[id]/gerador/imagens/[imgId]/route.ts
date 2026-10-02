import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_GERADOR } from "@/lib/geradorImagens";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; imgId: string } }) {
  const body = await req.json().catch(() => null);
  if (typeof body?.favorita !== "boolean") return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin
    .from("imagens_geradas")
    .update({ favorita: body.favorita })
    .eq("id", params.imgId)
    .eq("account_id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; imgId: string } }) {
  const admin = createAdminClient();
  const { data: img } = await admin
    .from("imagens_geradas")
    .select("storage_path, base_path")
    .eq("id", params.imgId)
    .eq("account_id", params.id)
    .maybeSingle();
  if (!img) return NextResponse.json({ ok: true });
  await admin.storage.from(BUCKET_GERADOR).remove([img.storage_path, ...(img.base_path ? [img.base_path] : [])]);
  await admin.from("imagens_geradas").delete().eq("id", params.imgId).eq("account_id", params.id);
  return NextResponse.json({ ok: true });
}
