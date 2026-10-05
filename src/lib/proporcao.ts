"use client";

// Aviso de proporção (Victor pediu em 05/10/2026): ao subir uma imagem/vídeo
// pra Story ou Feed, avisa quando ela não está na proporção ideal e pergunta
// se quer seguir mesmo assim. Nunca trava: se não conseguir ler o tamanho do
// arquivo, assume que está tudo certo.

type Tamanho = { w: number; h: number };

export async function lerTamanho(file: File): Promise<Tamanho | null> {
  try {
    if (file.type.startsWith("image/")) {
      const bmp = await createImageBitmap(file);
      const t = { w: bmp.width, h: bmp.height };
      bmp.close();
      return t;
    }
    if (file.type.startsWith("video/")) {
      return await new Promise<Tamanho | null>((resolve) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement("video");
        const fim = (t: Tamanho | null) => {
          URL.revokeObjectURL(url);
          resolve(t);
        };
        v.preload = "metadata";
        v.onloadedmetadata = () => fim(v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null);
        v.onerror = () => fim(null);
        setTimeout(() => fim(null), 5_000);
        v.src = url;
      });
    }
  } catch {
    /* ignora */
  }
  return null;
}

const CONHECIDAS: [string, number][] = [
  ["9:16", 9 / 16],
  ["4:5", 4 / 5],
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["3:2", 3 / 2],
];

export function descreverProporcao(t: Tamanho): string {
  const r = t.w / t.h;
  const mais = CONHECIDAS.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a));
  return Math.abs(mais[1] - r) / mais[1] < 0.03 ? `${mais[0]}` : `${t.w}×${t.h}`;
}

// Story ideal: 9:16 (com uma folga de ~4%).
const STORY_MIN = 0.54;
const STORY_MAX = 0.585;
// Feed: o Instagram só aceita de 4:5 até 1,91:1.
const FEED_MIN = 0.8;
const FEED_MAX = 1.91;

async function foraDaProporcao(files: File[], min: number, max: number, soImagens: boolean) {
  const fora: { nome: string; t: Tamanho }[] = [];
  for (const f of files) {
    if (soImagens && !f.type.startsWith("image/")) continue;
    const t = await lerTamanho(f);
    if (!t) continue;
    const r = t.w / t.h;
    if (r < min || r > max) fora.push({ nome: f.name, t });
  }
  return fora;
}

// Devolve true se pode seguir (tudo na proporção, ou o Victor confirmou).
export async function confirmarProporcaoStory(files: File[]): Promise<boolean> {
  const fora = await foraDaProporcao(files, STORY_MIN, STORY_MAX, false);
  if (fora.length === 0) return true;
  const lista = fora.map((f) => `• ${f.nome} (${descreverProporcao(f.t)})`).join("\n");
  return window.confirm(
    `Atenção: ${fora.length === 1 ? "essa mídia não está" : "essas mídias não estão"} na proporção de Story (9:16):\n\n${lista}\n\n` +
      "Vai publicar normalmente, mas NÃO ocupa a tela toda — o Instagram mostra com faixas (fundo) em volta.\n\n" +
      "Quer seguir mesmo assim?"
  );
}

export async function confirmarProporcaoFeed(files: File[]): Promise<boolean> {
  const fora = await foraDaProporcao(files, FEED_MIN, FEED_MAX, true);
  if (fora.length === 0) return true;
  const lista = fora.map((f) => `• ${f.nome} (${descreverProporcao(f.t)})`).join("\n");
  return window.confirm(
    `Atenção: ${fora.length === 1 ? "essa imagem está" : "essas imagens estão"} fora da proporção aceita no Feed (de 4:5 a 1,91:1):\n\n${lista}\n\n` +
      "O Instagram pode recusar a publicação ou cortar a imagem.\n\n" +
      "Quer seguir mesmo assim?"
  );
}
