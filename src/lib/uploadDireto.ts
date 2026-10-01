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

  // Limites de tempo: antes, se qualquer uma dessas etapas pendurasse, a
  // tela ficava em "Enviando mídia…" sem nunca dar erro nem terminar.
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch("/api/uploads/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket, pasta, fileName: file.name }),
      signal: controle.signal,
    });
  } catch {
    throw new Error("Não consegui falar com o servidor pra preparar o envio. Verifique a internet e tente de novo.");
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.signedUrl) {
    throw new Error(json?.erro || "Erro ao preparar o upload.");
  }

  const supabase = createSupabaseBrowserClient();
  const envio = supabase.storage.from(bucket).uploadToSignedUrl(json.path, json.token, file);
  const { error } = await Promise.race([
    envio,
    new Promise<never>((_, rejeitar) =>
      setTimeout(() => rejeitar(new Error("O envio do arquivo demorou demais. Verifique a internet e tente de novo.")), 5 * 60_000)
    ),
  ]);

  if (error) {
    throw new Error(`Falha ao enviar o arquivo: ${error.message}`);
  }

  return { url: json.publicUrl, path: json.path, mediaType };
}
