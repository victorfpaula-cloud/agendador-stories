import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { criarUploadAssinado } from "@/lib/storage";

// Lista fechada de propósito — essa rota gera um link que autoriza escrita
// direta no Storage, então não pode aceitar qualquer nome de bucket vindo
// do cliente.
const BUCKETS_PERMITIDOS = new Set(["feed-media", "story-media"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const bucket = String(body?.bucket || "");
  const pasta = String(body?.pasta || "");
  const fileName = String(body?.fileName || "");

  if (!BUCKETS_PERMITIDOS.has(bucket)) {
    return NextResponse.json({ erro: "Destino de upload inválido." }, { status: 400 });
  }
  if (!pasta) {
    return NextResponse.json({ erro: "Pasta de destino não informada." }, { status: 400 });
  }
  if (!fileName) {
    return NextResponse.json({ erro: "Nome do arquivo não informado." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const resultado = await criarUploadAssinado(admin, bucket, pasta, fileName);
    return NextResponse.json(resultado);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao gerar o link de upload.";
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
