"use client";

// Roda no navegador (nunca no servidor): se a imagem escolhida for maior do
// que o necessário pro Stories, redimensiona e comprime levemente antes de
// enviar. Isso evita o limite de tamanho de upload do servidor pra fotos
// puras de câmera, e deixa o envio mais rápido — sem perda perceptível de
// qualidade, na mesma linha de sites como TinyPNG/iLoveIMG: o Instagram
// Stories exibe no máximo por volta de 1080×1920, então uma foto muito
// maior do que isso não ganha nitidez nenhuma, só pesa mais.

const DIMENSAO_MAXIMA = 1600; // pixels no lado maior — bem acima do que o Stories chega a exibir
const QUALIDADE_JPEG = 0.92; // compressão bem leve, praticamente sem perda visível
const TAMANHO_MINIMO_PARA_PROCESSAR = 1_500_000; // ~1.5MB — abaixo disso, nem mexe na foto

export async function prepararImagem(file: File): Promise<File> {
  // Só mexe em foto (nunca em vídeo), e pula formatos que não fazem sentido
  // redesenhar num canvas (SVG é vetorial; GIF pode ser animado e perderia
  // os quadros extras se fosse achatado numa imagem só).
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;

  if (file.size < TAMANHO_MINIMO_PARA_PROCESSAR) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const maiorLado = Math.max(width, height);

    if (maiorLado <= DIMENSAO_MAXIMA) {
      bitmap.close();
      return file;
    }

    const escala = DIMENSAO_MAXIMA / maiorLado;
    const novaLargura = Math.round(width * escala);
    const novaAltura = Math.round(height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = novaLargura;
    canvas.height = novaAltura;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, novaLargura, novaAltura);
    bitmap.close();

    const tipoSaida = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, tipoSaida, tipoSaida === "image/jpeg" ? QUALIDADE_JPEG : undefined)
    );

    // Se por algum motivo o resultado processado não ficou menor que o
    // original, não vale a pena — fica com a foto original.
    if (!blob || blob.size >= file.size) return file;

    const novoNome = file.name.replace(/\.\w+$/, tipoSaida === "image/png" ? ".png" : ".jpg");
    return new File([blob], novoNome, { type: tipoSaida });
  } catch {
    // Qualquer erro no processamento (formato não suportado pelo navegador,
    // etc.) — melhor enviar a foto original do que travar o agendamento.
    return file;
  }
}
