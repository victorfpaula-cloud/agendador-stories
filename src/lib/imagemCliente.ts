"use client";

// Roda no navegador (nunca no servidor): redimensiona (se for maior do que
// o necessário pro Stories) e SEMPRE redesenha a imagem num <canvas> antes
// de enviar. O redimensionamento é só otimização de tamanho — o Instagram
// Stories exibe no máximo por volta de 1080×1920, uma foto muito maior do
// que isso não ganha nitidez nenhuma, só pesa mais. Mas o redesenho em si
// (mesmo em fotos pequenas, que não precisam de resize nenhum) é
// obrigatório por outro motivo: é o que garante que nenhum metadado do
// arquivo original sobrevive — EXIF, XMP, e principalmente o "carimbo" de
// Content Credentials/C2PA que apps de edição com IA (removedor de fundo,
// upscaler, filtro...) deixam gravado na foto. Sem isso, uma foto de
// verdade que só passou por uma dessas ferramentas chegava no Instagram
// com esse carimbo intacto e saía marcada como "conteúdo de IA" mesmo não
// sendo — canvas.toBlob() gera um arquivo novo, só com os pixels, sem
// nenhum desses metadados (pedido do Victor em 26/09/2026). Esse upload
// vai direto do navegador pro Storage (sem passar pelo servidor, ver
// storage.ts), então essa é a única chance de fazer essa limpeza.
const DIMENSAO_MAXIMA = 1600; // pixels no lado maior — bem acima do que o Stories chega a exibir
const QUALIDADE_JPEG = 0.92; // compressão bem leve, praticamente sem perda visível

export async function prepararImagem(file: File): Promise<File> {
  // Só mexe em foto (nunca em vídeo), e pula formatos que não fazem sentido
  // redesenhar num canvas (SVG é vetorial; GIF pode ser animado e perderia
  // os quadros extras se fosse achatado numa imagem só) — esses dois
  // seguem sem a limpeza de metadado.
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const maiorLado = Math.max(width, height);

    const escala = maiorLado > DIMENSAO_MAXIMA ? DIMENSAO_MAXIMA / maiorLado : 1;
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

    if (!blob) return file;

    const novoNome = file.name.replace(/\.\w+$/, tipoSaida === "image/png" ? ".png" : ".jpg");
    return new File([blob], novoNome, { type: tipoSaida });
  } catch {
    // Qualquer erro no processamento (formato não suportado pelo navegador,
    // etc.) — melhor enviar a foto original (com metadado e tudo) do que
    // travar o agendamento.
    return file;
  }
}
