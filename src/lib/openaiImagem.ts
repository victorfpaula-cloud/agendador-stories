// Ponte com a API de imagens da OpenAI (GPT Image) — só no servidor; a chave
// (OPENAI_API_KEY) nunca vai pro navegador. Mesma "forma" de resposta do
// gemini.ts pra rota escolher o motor sem mudar o resto.
//
// Modelo configurável por variável de ambiente (os nomes mudam com
// frequência):
//   OPENAI_MODELO_IMAGEM      (padrão gpt-image-2)
//   OPENAI_QUALIDADE_RAPIDO   (padrão medium)
//   OPENAI_QUALIDADE_PREMIUM  (padrão high)

import { GeminiErro, type Qualidade, type Referencia } from "./gemini";

const BASE = "https://api.openai.com/v1/images";
const TEMPO_LIMITE_MS = 52_000;

// Tamanhos livres (proporção exata) e, se a API recusar, os fixos clássicos.
const TAMANHOS: Record<string, { livre: string; fixo: string }> = {
  "9:16": { livre: "1152x2048", fixo: "1024x1536" },
  "4:5": { livre: "1088x1360", fixo: "1024x1536" },
  "1:1": { livre: "1024x1024", fixo: "1024x1024" },
  "16:9": { livre: "2048x1152", fixo: "1536x1024" },
};

export function modeloOpenAI(): string {
  return process.env.OPENAI_MODELO_IMAGEM || "gpt-image-2";
}

function qualidadeOpenAI(q: Qualidade): string {
  return q === "premium"
    ? process.env.OPENAI_QUALIDADE_PREMIUM || "high"
    : process.env.OPENAI_QUALIDADE_RAPIDO || "medium";
}

type RespostaOpenAI = {
  data?: { b64_json?: string }[];
  error?: { message?: string; code?: string; type?: string };
};

async function chamar(
  caminho: "generations" | "edits",
  corpo: FormData | string,
  json: boolean,
  timeoutMs: number
): Promise<{ status: number; corpo: RespostaOpenAI | null }> {
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) throw new GeminiErro("A chave da OpenAI (OPENAI_API_KEY) não está configurada na Vercel.");

  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${caminho}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, ...(json ? { "Content-Type": "application/json" } : {}) },
      body: corpo,
      signal: controle.signal,
    });
    return { status: res.status, corpo: (await res.json().catch(() => null)) as RespostaOpenAI | null };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GeminiErro("O GPT demorou demais pra responder. Tente de novo ou use a qualidade \"Rápido\".");
    }
    throw new GeminiErro("Não consegui falar com a OpenAI. Tente de novo em instantes.");
  } finally {
    clearTimeout(timer);
  }
}

function erroAmigavel(status: number, r: RespostaOpenAI | null, modelo: string): GeminiErro {
  const msg = r?.error?.message || `HTTP ${status}`;
  const codigo = r?.error?.code || "";
  if (status === 401) return new GeminiErro("A chave da OpenAI é inválida.");
  if (status === 403 && /verif/i.test(msg))
    return new GeminiErro("A OpenAI exige verificar a organização pra usar esse modelo de imagem (platform.openai.com → Settings → Organization → Verify).");
  if (status === 429) return new GeminiErro("Limite/saldo da OpenAI atingido. Confira o faturamento e tente de novo em instantes.");
  if (status === 404 || /model.*(not found|does not exist)/i.test(msg))
    return new GeminiErro(`O modelo "${modelo}" não está disponível na sua conta. Ajuste OPENAI_MODELO_IMAGEM na Vercel.`);
  if (codigo === "moderation_blocked" || /safety|moderation/i.test(msg))
    return new GeminiErro("A OpenAI recusou esse pedido por política de segurança. Reescreva o pedido de outro jeito.");
  return new GeminiErro(`Erro da OpenAI: ${msg}`);
}

export async function gerarImagemOpenAI(opts: {
  qualidade: Qualidade;
  prompt: string;
  referencias: Referencia[];
  aspecto: string;
  timeoutMs?: number;
}): Promise<{ imagem: Buffer; mimeType: string; modelo: string; comentario: string }> {
  const modelo = modeloOpenAI();
  const quality = qualidadeOpenAI(opts.qualidade);
  const t = TAMANHOS[opts.aspecto] ?? TAMANHOS["1:1"];
  const timeoutMs = opts.timeoutMs ?? TEMPO_LIMITE_MS;
  const inicio = Date.now();

  const tentar = (size: string, restante: number) => {
    if (opts.referencias.length > 0) {
      const form = new FormData();
      form.set("model", modelo);
      form.set("prompt", opts.prompt);
      form.set("size", size);
      form.set("quality", quality);
      form.set("n", "1");
      opts.referencias.forEach((r, i) => {
        const ext = r.mimeType === "image/png" ? "png" : r.mimeType === "image/webp" ? "webp" : "jpg";
        form.append("image[]", new Blob([new Uint8Array(r.data)], { type: r.mimeType }), `ref${i}.${ext}`);
      });
      return chamar("edits", form, false, restante);
    }
    return chamar("generations", JSON.stringify({ model: modelo, prompt: opts.prompt, size, quality, n: 1 }), true, restante);
  };

  let r = await tentar(t.livre, timeoutMs);
  // Se a API não aceitar tamanho livre nesse modelo, cai no tamanho fixo.
  if (r.status === 400 && /size/i.test(r.corpo?.error?.message ?? "") && t.fixo !== t.livre) {
    const restante = timeoutMs - (Date.now() - inicio);
    if (restante > 8_000) r = await tentar(t.fixo, restante);
  }

  if (r.status < 200 || r.status >= 300) throw erroAmigavel(r.status, r.corpo, modelo);
  const b64 = r.corpo?.data?.[0]?.b64_json;
  if (!b64) throw new GeminiErro("A OpenAI respondeu sem imagem. Tente de novo.");
  return { imagem: Buffer.from(b64, "base64"), mimeType: "image/png", modelo, comentario: "" };
}
