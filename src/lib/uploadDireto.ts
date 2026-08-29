"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MediaType } from "@/types/database";

function detectarTipoMidiaCliente(contentType: string): MediaType {
  if (contentType.startsWith("image/")) return "IMAGE";
  if (contentType.startsWith("video/")) return "VIDEO";
  throw new Error("Arquivo precisa ser uma imagem ou um vídeo.");
}

// Sobe o arquivo direto do navegador pro Supabase Storage, sem passar pelo
// servidor da Vercel — evita o limite de ~4,5MB de corpo de requisição que
// afeta uploads normais (relevante principalmente pra vídeo). O servidor só
// participa gerando um link assinado (pouquíssimos bytes); o arquivo em si,
// que pode ser grande, vai direto do navegador pro Storage.
export async function enviarMidiaDireto(
  file: File,
  { bucket, accountId }: { bucket: string; accountId: string }
): Promise<{ url: string; path: string; mediaType: MediaType }> {
  const mediaType = detectarTipoMidiaCliente(file.type || "");

  const res = await fetch("/api/uploads/signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, accountId, fileName: file.name }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.signedUrl) {
    throw new Error(json?.erro || "Erro ao preparar o upload.");
  }

  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(json.path, json.token, file);

  if (error) {
    throw new Error(`Falha ao enviar o arquivo: ${error.message}`);
  }

  return { url: json.publicUrl, path: json.path, mediaType };
}
