"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MediaType } from "@/types/database";

function detectarTipoMidiaCliente(contentType: string): MediaType {
  if (contentType.startsWith("image/")) return "IMAGE";
  if (contentType.startsWith("video/")) return "VIDEO";
  throw new Error("Arquivo precisa ser uma imagem ou um vídeo.");
}

// Pega o caso de uma foto/vídeo do iCloud que não terminou de baixar no
// celular antes de ser selecionado: o navegador entrega um arquivo
// minúsculo/vazio em vez da mídia de verdade.
const TAMANHO_MINIMO_BYTES: Record<MediaType, number> = {
  IMAGE: 5_000,
  VIDEO: 20_000,
};

// Sobe o arquivo direto do navegador pro Supabase Storage, sem passar pelo
// servidor da Vercel — evita o limite de ~4,5MB de corpo de requisição que
// afeta uploads normais (relevante principalmente pra vídeo). O servidor só
// participa gerando um link assinado (pouquíssimos bytes); o arquivo em si,
// que pode ser grande, vai direto do navegador pro Storage.
export async function enviarMidiaDireto(
  file: File,
  { bucket, pasta }: { bucket: string; pasta: string }
): Promise<{ url: string; path: string; mediaType: MediaType }> {
  const mediaType = detectarTipoMidiaCliente(file.type || "");

  if (file.size < TAMANHO_MINIMO_BYTES[mediaType]) {
    throw new Error(
      "O arquivo parece incompleto (muito pequeno pra ser uma foto/vídeo de verdade). " +
        "Se ele veio do iCloud, espera terminar de baixar no celular e tenta selecionar de novo."
    );
  }

  const res = await fetch("/api/uploads/signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, pasta, fileName: file.name }),
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
