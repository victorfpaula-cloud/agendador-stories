import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Acha (e, com confirmar=true, remove) imagens duplicadas de uma categoria do
// Story Engine. Compara a APARÊNCIA (miniatura 24x24 em cinza), não
// o arquivo — então uma imagem recuperada do Instagram, recomprimida, ainda é
// reconhecida. Também elimina o item antigo "sem arquivo" quando a mesma
// imagem foi reenviada. Nunca apaga a única cópia com arquivo.
// Miniatura 24x24 em tons de cinza; duas imagens são "a mesma" quando a
// diferença média por pixel é pequena (recompressão/redimensionamento ficam
// abaixo disso; fotos diferentes ficam bem acima).
const LIMIAR = 7; // de 255

type Item = { id: string; media_path: string; thumbnail_data_url: string | null; created_at: string };

async function assinatura(dataUrl: string | null): Promise<Uint8Array | null> {
  if (!dataUrl) return null;
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const px = await sharp(Buffer.from(b64, "base64")).resize(24, 24, { fit: "fill" }).greyscale().raw().toBuffer();
    return new Uint8Array(px);
  } catch {
    return null;
  }
}

function distancia(a: Uint8Array, b: Uint8Array): number {
  let soma = 0;
  for (let i = 0; i < a.length; i++) soma += Math.abs(a[i] - b[i]);
  return soma / a.length;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const confirmar = body?.confirmar === true;
  const admin = createAdminClient();

  const { data } = await admin
    .from("story_ciclo_item")
    .select("id, media_path, thumbnail_data_url, created_at")
    .eq("category_id", params.id)
    .order("created_at", { ascending: true });
  const itens = (data ?? []) as Item[];

  const { data: arquivos } = await admin.storage.from("story-media").list(`ciclo/${params.id}`, { limit: 1000 });
  const tamanhos = new Map<string, number>(
    (arquivos ?? []).map((a) => [`ciclo/${params.id}/${a.name}`, Number((a.metadata as { size?: number } | null)?.size ?? 1)])
  );

  const hashes = await Promise.all(itens.map((i) => assinatura(i.thumbnail_data_url)));

  // Agrupa por semelhança.
  const grupos: number[][] = [];
  const usado = new Set<number>();
  for (let i = 0; i < itens.length; i++) {
    if (usado.has(i) || hashes[i] === null) continue;
    const g = [i];
    for (let j = i + 1; j < itens.length; j++) {
      if (usado.has(j) || hashes[j] === null) continue;
      if (distancia(hashes[i]!, hashes[j]!) <= LIMIAR) g.push(j);
    }
    if (g.length > 1) {
      g.forEach((k) => usado.add(k));
      grupos.push(g);
    }
  }

  // Em cada grupo mantém UM: prefere quem tem arquivo (o maior); senão o mais antigo.
  const remover: Item[] = [];
  for (const g of grupos) {
    const ordenados = [...g].sort((a, b) => {
      const ta = tamanhos.get(itens[a].media_path) ?? 0;
      const tb = tamanhos.get(itens[b].media_path) ?? 0;
      return tb - ta || itens[a].created_at.localeCompare(itens[b].created_at);
    });
    for (const k of ordenados.slice(1)) remover.push(itens[k]);
  }

  const semArquivo = remover.filter((i) => !tamanhos.has(i.media_path)).length;
  if (!confirmar) return NextResponse.json({ duplicadas: remover.length, semArquivo, grupos: grupos.length });

  for (const i of remover) {
    await admin.from("story_ciclo_item").delete().eq("id", i.id);
    await admin.storage.from("story-media").remove([i.media_path]).catch(() => null);
    await admin.storage.from("story-backup").remove([i.media_path]).catch(() => null);
  }
  return NextResponse.json({ removidas: remover.length });
}
