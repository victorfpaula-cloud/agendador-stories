import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaType } from "@/types/database";

const BUCKET = "story-media";

export function detectarTipoMidia(contentType: string): MediaType {
  if (contentType.startsWith("image/")) return "IMAGE";
  if (contentType.startsWith("video/")) return "VIDEO";
  throw new Error("Arquivo precisa ser uma imagem ou um vídeo.");
}

// Tamanho mínimo pra considerar um arquivo "completo" — pega principalmente
// o caso de uma foto do iCloud que não terminou de baixar no celular antes
// de ser selecionada: o navegador entrega um arquivo minúsculo/vazio em vez
// da foto de verdade. Um valor bem conservador, só pra pegar o caso óbvio
// sem arriscar recusar uma imagem legítima só um pouco mais leve.
const TAMANHO_MINIMO_BYTES: Record<MediaType, number> = {
  IMAGE: 5_000,
  VIDEO: 20_000,
};

export async function enviarMidia(admin: SupabaseClient, accountId: string, file: File) {
  const tipo = detectarTipoMidia(file.type || "");

  if (file.size < TAMANHO_MINIMO_BYTES[tipo]) {
    throw new Error(
      "O arquivo parece incompleto (muito pequeno pra ser uma foto/vídeo de verdade). " +
        "Se ele veio do iCloud, espera terminar de baixar no celular e tenta selecionar de novo."
    );
  }

  const extensao = (file.name.split(".").pop() || (tipo === "IMAGE" ? "jpg" : "mp4")).toLowerCase();
  const path = `${accountId}/${randomUUID()}.${extensao}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type || undefined,
    upsert: false,
  });

  if (error) {
    throw new Error(`Falha ao enviar o arquivo: ${error.message}`);
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);

  return { url: pub.publicUrl, path, mediaType: tipo };
}

export async function removerMidia(admin: SupabaseClient, path: string) {
  await admin.storage.from(BUCKET).remove([path]);
}
