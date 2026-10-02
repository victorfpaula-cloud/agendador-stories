// Estimativa de custo por imagem gerada (em dólar, preço público aproximado
// de cada API — os valores reais variam e podem ser ajustados aqui). Serve
// pro contador de gasto e pro limite diário do Gerador de imagens. Código
// puro (sem dependências de servidor) pra a tela também poder usar.

export const PRECO_USD = {
  nano_rapido: 0.04, // gemini-2.5-flash-image
  nano_premium: 0.14, // gemini-3-pro-image-preview (1K/2K)
  gpt_rapido: 0.06, // gpt-image, qualidade média
  gpt_premium: 0.25, // gpt-image, qualidade alta
} as const;

export function custoUSD(motor: "nano" | "gpt", qualidade: "rapido" | "premium"): number {
  return PRECO_USD[`${motor}_${qualidade}` as keyof typeof PRECO_USD];
}

// Linhas antigas (anteriores ao contador) não têm custo gravado — estima pelo modelo.
export function custoDaLinhaUSD(l: { custo_usd?: number | string | null; modelo: string }): number {
  const gravado = Number(l.custo_usd ?? 0);
  if (gravado > 0) return gravado;
  const m = l.modelo.toLowerCase();
  if (m.includes("gpt")) return PRECO_USD.gpt_rapido;
  if (m.includes("pro") || m.includes("gemini-3")) return PRECO_USD.nano_premium;
  return PRECO_USD.nano_rapido;
}

export const formatarReais = (usd: number, usdBrl: number): string =>
  `R$ ${(usd * usdBrl).toFixed(2).replace(".", ",")}`;
