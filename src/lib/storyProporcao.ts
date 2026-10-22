import { randomUUID } from "crypto";
import sharp from "sharp";
import type { createAdminClient } from "@/lib/supabase/admin";
import { gerarThumbnailServidor } from "@/lib/thumbnailServidor";

// Foto que chega com proporção um pouco diferente de 9:16 (direto da câmera,
// por exemplo) é cortada no centro pra ocupar a tela inteira do Story, sem
// faixas pretas (pedido do Victor em 22/10/2026). Só pra imagens do Story
// Engine; vídeo não é mexido. Nunca trava o upload: qualquer falha mantém o
// arquivo original.
type Admin = ReturnType<typeof createAdminClient>;

const BUCKET = "story-media";
const ALVO = 9 / 16;
const FOLGA = 0.01;

const FORMATOS: Record<string, { ext: string; mime: string }> = {
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" },
  webp: { ext: "webp", mime: "image/webp" },
};

export type ItemAjustado = { url: string; path: string; thumbnailDataUrl: string | null } | null;

// Devolve o novo arquivo (já gravado no Storage, original removido) ou null
// se a imagem já está em 9:16 ou não deu pra ajustar.
export async function ajustarParaStory(admin: Admin, path: string): Promise<ItemAjustado> {
  try {
    const { data: blob, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !blob) return null;
    const original = Buffer.from(await blob.arrayBuffer());

    const meta = await sharp(original).metadata();
    const formato = FORMATOS[meta.format ?? ""];
    if (!formato) return null;

    // rotate() aplica a orientação do EXIF (fotos de celular/câmera vêm
    // "deitadas" com a orientação gravada à parte).
    const { data: girada, info } = await sharp(original).rotate().toBuffer({ resolveWithObject: true });
    const proporcao = info.width / info.height;
    if (Math.abs(proporcao - ALVO) / ALVO <= FOLGA) return null;

    let largura = info.width;
    let altura = info.height;
    if (proporcao > ALVO) largura = Math.round(info.height * ALVO);
    else altura = Math.round(info.width / ALVO);

    let pipeline = sharp(girada).extract({
      left: Math.floor((info.width - largura) / 2),
      top: Math.floor((info.height - altura) / 2),
      width: largura,
      height: altura,
    });
    pipeline =
      meta.format === "png" ? pipeline.png() : meta.format === "webp" ? pipeline.webp({ quality: 92 }) : pipeline.jpeg({ quality: 92 });
    const cortada = await pipeline.toBuffer();

    const pasta = path.split("/").slice(0, -1).join("/");
    const novoPath = `${pasta}/${randomUUID()}.${formato.ext}`;
    const { error: erroUpload } = await admin.storage.from(BUCKET).upload(novoPath, cortada, {
      contentType: formato.mime,
      upsert: false,
    });
    if (erroUpload) return null;

    await admin.storage.from(BUCKET).remove([path]);
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(novoPath);
    const thumbnailDataUrl = await gerarThumbnailServidor(cortada).catch(() => null);
    return { url: pub.publicUrl, path: novoPath, thumbnailDataUrl };
  } catch {
    return null;
  }
}
