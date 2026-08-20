import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaType } from "@/types/database";

const BUCKET = "story-media";

export function detectarTipoMidia(contentType: string): MediaType {
  if (contentType.startsWith("image/")) return "IMAGE";
  if (contentType.startsWith("video/")) return "VIDEO";
  throw new Error("Arquivo precisa ser uma imagem ou um vídeo.");
}

export async function enviarMidia(admin: SupabaseClient, accountId: string, file: File) {
  const tipo = detectarTipoMidia(file.type || "");
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
