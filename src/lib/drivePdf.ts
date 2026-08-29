// Extrai o texto de um PDF — usado pelo sub-módulo do Drive (passo 7) pra
// pegar a legenda do post automático do dia. Victor confirmou que os PDFs
// da pasta do dia são digitais (tipo texto do Word, não foto/scan de
// papel), então um leitor de PDF padrão já entrega o texto certinho
// (incluindo acentuação), sem precisar de OCR.
export async function extrairTextoPdf(buffer: Buffer): Promise<string> {
  // Import dinâmico: só carrega a biblioteca quando essa função roda de
  // verdade (dentro do cron), nunca no momento em que o Next.js empacota o
  // projeto pra build.
  const pdfParse = (await import("pdf-parse")).default;
  const resultado = await pdfParse(buffer);
  return (resultado.text || "").trim();
}
