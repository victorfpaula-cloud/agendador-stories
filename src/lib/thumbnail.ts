"use client";

// Gera uma miniatura pequena (thumbnail) de uma foto ou vídeo, direto no
// navegador, antes do upload — usada pra mostrar o preview na lista de
// publicações mesmo depois que o arquivo original for apagado do Storage.
// A mídia original só precisa existir até o Instagram buscar ela na hora
// de publicar (ver /api/cron/publicar-feed: depois que o post tem sucesso,
// o arquivo original é apagado do Storage) — daí em diante, só essa
// miniatura pequena (guardada como texto no banco, não como arquivo)
// continua representando o post na tela.
//
// Nunca lança erro — se não conseguir gerar por qualquer motivo, devolve
// `null` e quem chama simplesmente segue sem thumbnail (a tela tem um
// "placeholder" genérico pra esse caso, então nunca trava o agendamento
// por causa disso).
const TAMANHO_MAXIMO = 240;
const QUALIDADE_JPEG = 0.6;

export async function gerarThumbnail(file: File): Promise<string | null> {
  try {
    if (file.type.startsWith("image/")) {
      return await thumbnailDeImagem(file);
    }
    if (file.type.startsWith("video/")) {
      return await thumbnailDeVideo(file);
    }
    return null;
  } catch {
    return null;
  }
}

function desenharEExportar(origem: CanvasImageSource, largura: number, altura: number): string {
  const escala = Math.min(1, TAMANHO_MAXIMO / Math.max(largura, altura, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(largura * escala));
  canvas.height = Math.max(1, Math.round(altura * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível.");
  ctx.drawImage(origem, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", QUALIDADE_JPEG);
}

function thumbnailDeImagem(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        resolve(desenharEExportar(img, img.naturalWidth, img.naturalHeight));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Falha ao carregar imagem."));
    };
    img.src = url;
  });
}

function thumbnailDeVideo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = url;

    const limpar = () => URL.revokeObjectURL(url);

    video.onloadedmetadata = () => {
      // Pega um frame um pouquinho depois do início — o frame exato em 0
      // às vezes vem preto/em branco em alguns formatos/codecs.
      video.currentTime = Math.min(0.3, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      try {
        resolve(desenharEExportar(video, video.videoWidth, video.videoHeight));
      } catch (err) {
        reject(err);
      } finally {
        limpar();
      }
    };
    video.onerror = () => {
      limpar();
      reject(new Error("Falha ao carregar vídeo."));
    };
  });
}
