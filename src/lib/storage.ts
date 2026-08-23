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

// Usado por "Duplicar rotina": copia de verdade o arquivo de mídia pra uma
// pasta nova, da conta de destino, em vez de só reaproveitar o mesmo link.
// Isso é importante — se as duas contas apontassem pro mesmo arquivo, trocar
// ou remover a mídia numa conta quebraria a outra silenciosamente. Copiando,
// as duas ficam 100% independentes dali em diante.
export async function duplicarMidia(admin: SupabaseClient, accountIdDestino: string, pathOrigem: string) {
  const { data: arquivoOrigem, error: erroDownload } = await admin.storage.from(BUCKET).download(pathOrigem);

  if (erroDownload || !arquivoOrigem) {
    throw new Error(`Falha ao ler a mídia original: ${erroDownload?.message ?? "arquivo não encontrado"}`);
  }

  const extensao = (pathOrigem.split(".").pop() || "dat").toLowerCase();
  const path = `${accountIdDestino}/${randomUUID()}.${extensao}`;

  const buffer = Buffer.from(await arquivoOrigem.arrayBuffer());

  const { error: erroUpload } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: arquivoOrigem.type || undefined,
    upsert: false,
  });

  if (erroUpload) {
    throw new Error(`Falha ao salvar a cópia da mídia: ${erroUpload.message}`);
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);

  return { url: pub.publicUrl, path };
}
