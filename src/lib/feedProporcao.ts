import { randomUUID } from "crypto";
import sharp from "sharp";
import type { createAdminClient } from "@/lib/supabase/admin";

// Fotos do Feed ficam em 4:5, centralizadas e sem bordas (pedido do Victor em
// 18/11/2026: num carrossel da Dona Baunilha um slide com proporção diferente
// do primeiro saiu com bordas brancas no Instagram).
//  - Carrossel: o Instagram usa a proporção do 1º slide pra todos, então toda
//    foto fora de 4:5 é cortada no centro pra 4:5.
//  - Foto única: só as mais "em pé" que 4:5 são cortadas (as mais largas, até
//    1,91:1, o Instagram já mostra inteiras e sem borda).
// Vídeo não é mexido. Qualquer falha mantém o arquivo original.
type Admin = ReturnType<typeof createAdminClient>;

const ALVO = 4 / 5;
const FOLGA = 0.01;
const FORMATOS: Record<string, { ext: string; mime: string }> = {
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" },
  webp: { ext: "webp", mime: "image/webp" },
};

export async function ajustarBufferFeed(
  original: Buffer,
  carrossel: boolean
): Promise<{ buffer: Buffer; ext: string; mime: string } | null> {
  try {
    const meta = await sharp(original).metadata();
    const formato = FORMATOS[meta.format ?? ""];
    if (!formato) return null;

    // rotate() aplica a orientação do EXIF (foto de celular/câmera).
    const { data: girada, info } = await sharp(original).rotate().toBuffer({ resolveWithObject: true });
    const proporcao = info.width / info.height;
    const diferente = Math.abs(proporcao - ALVO) / ALVO > FOLGA;
    const maisEmPe = proporcao < ALVO;
    if (!(carrossel ? diferente : diferente && maisEmPe)) return null;

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
    pipeline = meta.format === "png" ? pipeline.png() : meta.format === "webp" ? pipeline.webp({ quality: 92 }) : pipeline.jpeg({ quality: 92 });
    return { buffer: await pipeline.toBuffer(), ext: formato.ext, mime: formato.mime };
  } catch {
    return null;
  }
}

// Versão pra arquivo já enviado ao Storage (fluxo manual): baixa, ajusta,
// grava num caminho novo e remove o original. Devolve null se nada mudou.
export async function ajustarArquivoFeed(
  admin: Admin,
  path: string,
  carrossel: boolean
): Promise<{ url: string; path: string } | null> {
  try {
    const { data: blob, error } = await admin.storage.from("feed-media").download(path);
    if (error || !blob) return null;
    const ajustado = await ajustarBufferFeed(Buffer.from(await blob.arrayBuffer()), carrossel);
    if (!ajustado) return null;

    const pasta = path.split("/").slice(0, -1).join("/");
    const novoPath = `${pasta}/${randomUUID()}.${ajustado.ext}`;
    const { error: erroUpload } = await admin.storage.from("feed-media").upload(novoPath, ajustado.buffer, {
      contentType: ajustado.mime,
      upsert: false,
    });
    if (erroUpload) return null;
    await admin.storage.from("feed-media").remove([path]);
    const { data: pub } = admin.storage.from("feed-media").getPublicUrl(novoPath);
    return { url: pub.publicUrl, path: novoPath };
  } catch {
    return null;
  }
}
