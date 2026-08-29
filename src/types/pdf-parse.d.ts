// Declaração de tipos mínima pro pacote "pdf-parse" (ele não vem com tipos
// TypeScript prontos, e não existe um pacote oficial "@types/pdf-parse"
// confiável) — só o suficiente pro que src/lib/drivePdf.ts usa.
declare module "pdf-parse" {
  interface ResultadoPdfParse {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<ResultadoPdfParse>;

  export default pdfParse;
}
