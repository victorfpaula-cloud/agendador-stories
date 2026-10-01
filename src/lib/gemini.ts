// Ponte com a API do Gemini (Nano Banana) — roda só no servidor, a chave
// (GEMINI_API_KEY) nunca vai pro navegador.
//
// Modelos configuráveis por variável de ambiente, porque o Google troca os
// nomes com frequência (os "preview" em especial):
//   GEMINI_MODELO_RAPIDO   (padrão gemini-2.5-flash-image)      — mais rápido/barato
//   GEMINI_MODELO_PREMIUM  (padrão gemini-3-pro-image-preview)  — melhor texto/lettering e fidelidade
//   GEMINI_MODELO_TEXTO    (padrão gemini-2.5-flash)            — só pra "turbinar o pedido"
//   GEMINI_TAMANHO_PREMIUM (padrão 1K; "2K" dá mais nitidez, mas demora mais)

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// A função serverless tem 60s no plano Hobby — aborta antes disso pra dar
// um erro claro em vez de a Vercel cortar a resposta no meio.
const TEMPO_LIMITE_MS = 52_000;

export type Qualidade = "rapido" | "premium";

export function modeloDe(qualidade: Qualidade): string {
  return qualidade === "premium"
    ? process.env.GEMINI_MODELO_PREMIUM || "gemini-3-pro-image-preview"
    : process.env.GEMINI_MODELO_RAPIDO || "gemini-2.5-flash-image";
}

export class GeminiErro extends Error {}

export type Referencia = { mimeType: string; data: Buffer };

type Parte = {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

type RespostaGemini = {
  candidates?: { content?: { parts?: Parte[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

function chave(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new GeminiErro("A chave do Gemini (GEMINI_API_KEY) não está configurada na Vercel.");
  return k;
}

async function chamar(modelo: string, corpo: unknown, timeoutMs = TEMPO_LIMITE_MS): Promise<RespostaGemini> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave() },
      body: JSON.stringify(corpo),
      signal: controle.signal,
    });
  } catch (err) {
    if (err instanceof GeminiErro) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new GeminiErro("O Gemini demorou demais pra responder. Tente de novo ou use a qualidade \"Rápido\".");
    }
    throw new GeminiErro("Não consegui falar com o Gemini. Tente de novo em instantes.");
  } finally {
    clearTimeout(timer);
  }

  const json = (await res.json().catch(() => null)) as RespostaGemini | null;
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    if (res.status === 429) throw new GeminiErro("Limite de uso do Gemini atingido. Espere um pouco e tente de novo.");
    if (res.status === 400 && /api key/i.test(msg)) throw new GeminiErro("A chave do Gemini é inválida.");
    if (res.status === 403) throw new GeminiErro("A chave do Gemini não tem permissão pra gerar imagens (verifique o faturamento do projeto no Google AI Studio).");
    if (res.status === 404) throw new GeminiErro(`O modelo "${modelo}" não existe mais. Ajuste a variável de ambiente do modelo na Vercel.`);
    throw new GeminiErro(`Erro do Gemini: ${msg}`);
  }
  if (!json) throw new GeminiErro("Resposta vazia do Gemini.");
  return json;
}

export async function gerarImagem(opts: {
  qualidade: Qualidade;
  prompt: string;
  referencias: Referencia[];
  aspecto: string; // "9:16", "4:5", "1:1", "16:9"
  timeoutMs?: number;
}): Promise<{ imagem: Buffer; mimeType: string; modelo: string; comentario: string }> {
  const modelo = modeloDe(opts.qualidade);

  const imageConfig: Record<string, string> = { aspectRatio: opts.aspecto };
  if (opts.qualidade === "premium") imageConfig.imageSize = process.env.GEMINI_TAMANHO_PREMIUM || "1K";

  const json = await chamar(modelo, {
    contents: [
      {
        parts: [
          { text: opts.prompt },
          ...opts.referencias.map((r) => ({
            inlineData: { mimeType: r.mimeType, data: r.data.toString("base64") },
          })),
        ],
      },
    ],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig },
  }, opts.timeoutMs);

  if (json.promptFeedback?.blockReason) {
    throw new GeminiErro("O Gemini recusou esse pedido por política de segurança. Reescreva o pedido de outro jeito.");
  }

  const partes = json.candidates?.[0]?.content?.parts ?? [];
  let imagem: { mimeType: string; data: string } | null = null;
  let comentario = "";
  for (const p of partes) {
    if (p.thought) continue; // imagens "de rascunho" do raciocínio do modelo premium
    const d = p.inlineData ?? null;
    const d2 = p.inline_data ?? null;
    const dados = d?.data ?? d2?.data;
    if (dados) imagem = { mimeType: d?.mimeType ?? d2?.mime_type ?? "image/png", data: dados };
    else if (p.text) comentario += p.text;
  }

  if (!imagem) {
    const motivo = json.candidates?.[0]?.finishReason;
    throw new GeminiErro(
      motivo && motivo !== "STOP"
        ? `O Gemini não devolveu imagem (${motivo}). Tente reescrever o pedido.`
        : `O Gemini respondeu só com texto, sem imagem${comentario ? `: "${comentario.slice(0, 160)}"` : ""}. Tente de novo.`
    );
  }

  return { imagem: Buffer.from(imagem.data, "base64"), mimeType: imagem.mimeType, modelo, comentario };
}

// Usa o modelo de texto pra transformar um pedido curto num briefing
// detalhado de direção de arte (o "turbinar meu pedido").
export async function escreverTexto(sistema: string, pedido: string): Promise<string> {
  const modelo = process.env.GEMINI_MODELO_TEXTO || "gemini-2.5-flash";
  const json = await chamar(modelo, {
    systemInstruction: { parts: [{ text: sistema }] },
    contents: [{ parts: [{ text: pedido }] }],
  });
  const texto = (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("")
    .trim();
  if (!texto) throw new GeminiErro("O Gemini não devolveu texto. Tente de novo.");
  return texto;
}
