import sharp from "sharp";

// Equivalente a gerarThumbnail() (thumbnail.ts) só que rodando no servidor,
// usado só pra preencher a miniatura de horários de Stories que já
// existiam antes dela existir (ver gerarMiniaturaSeFaltar em
// /api/cron/run). Só cobre foto — o navegador tem Canvas/<video> de graça
// pra tirar um frame de vídeo, o servidor não, e trazer isso pra cá exigiria
// ffmpeg (bem mais pesado/arriscado numa função serverless). Vídeo antigo
// sem miniatura continua mostrando o arquivo original até alguém trocar a
// mídia pela tela — aí o navegador gera a miniatura normalmente.
const TAMANHO_MAXIMO = 240;
const QUALIDADE_JPEG = 60;

export async function gerarThumbnailServidor(buffer: Buffer): Promise<string | null> {
  try {
    const redimensionado = await sharp(buffer)
      .resize(TAMANHO_MAXIMO, TAMANHO_MAXIMO, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: QUALIDADE_JPEG })
      .toBuffer();
    return `data:image/jpeg;base64,${redimensionado.toString("base64")}`;
  } catch {
    return null;
  }
}
