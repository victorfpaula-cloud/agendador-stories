// Previsão do tempo pro Story Weather. Fonte: MET Norway (api.met.no,
// Locationforecast 2.0) — gratuita, sem chave, uso comercial dentro da
// política de uso justo; exige um User-Agent que identifique o app.
// Aqui só LEMOS e DECIDIMOS; quem publica é o motor
// (src/lib/engines/publicarStoryWeather.ts).

const FUSO = "America/Sao_Paulo";
const UA = "AgendadorStories/1.0 github.com/victorfpaula-cloud/agendador-stories";

export type Leitura = {
  lido_em: string;
  hora_prevista: string; // hora da previsão usada (ISO)
  temperatura_agora: number | null;
  chuva_mm_proxima_hora: number | null;
  simbolo_proxima_hora: string | null;
  temperatura_max_hoje: number | null;
};

type Ponto = {
  time: string;
  data: {
    instant?: { details?: { air_temperature?: number } };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
  };
};

const diaEmSP = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: FUSO });

export async function lerPrevisao(latitude: number, longitude: number): Promise<Leitura> {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Serviço de previsão respondeu HTTP ${res.status}.`);
  const json = (await res.json()) as { properties?: { timeseries?: Ponto[] } };
  const serie = json.properties?.timeseries ?? [];
  if (serie.length === 0) throw new Error("O serviço de previsão não devolveu dados.");

  const agora = Date.now();
  // Ponto da hora atual: o último que já começou.
  let atual = serie[0];
  for (const p of serie) {
    if (new Date(p.time).getTime() <= agora) atual = p;
    else break;
  }

  const hoje = diaEmSP(new Date().toISOString());
  const temps = serie.filter((p) => diaEmSP(p.time) === hoje).map((p) => p.data.instant?.details?.air_temperature).filter((t): t is number => typeof t === "number");

  const chuva = atual.data.next_1_hours?.details?.precipitation_amount;
  return {
    lido_em: new Date().toISOString(),
    hora_prevista: atual.time,
    temperatura_agora: atual.data.instant?.details?.air_temperature ?? null,
    chuva_mm_proxima_hora: typeof chuva === "number" ? chuva : null,
    simbolo_proxima_hora: atual.data.next_1_hours?.summary?.symbol_code ?? null,
    temperatura_max_hoje: temps.length > 0 ? Math.max(...temps) : null,
  };
}

// Chuva de verdade: pelo menos 0,5 mm na próxima hora E o próprio serviço
// classifica como chuva/temporal (símbolo). Os dois juntos, nunca só um.
export const CHUVA_MIN_MM = 1.0;
// Chuva sustentada: a previsão precisa indicar chuva em leituras seguidas
// durante pelo menos 1 hora, em pelo menos 2 horas de previsão diferentes
// (duas leituras seguidas dentro da mesma hora repetem a mesma previsão e não
// confirmam nada). Uma leitura sem chuva zera a contagem.
export const CHUVA_MIN_LEITURAS = 4;
export const CHUVA_MIN_MINUTOS = 60;
export const CHUVA_MIN_HORAS_DIFERENTES = 2;
export function indicaChuva(l: Leitura): boolean {
  const simbolo = l.simbolo_proxima_hora ?? "";
  return (l.chuva_mm_proxima_hora ?? 0) >= CHUVA_MIN_MM && /(rain|thunder|sleet|shower)/.test(simbolo);
}

// Frio: a temperatura de AGORA está no limite configurado ou abaixo.
export function indicaFrio(l: Leitura, graus: number): boolean {
  return l.temperatura_agora !== null && l.temperatura_agora <= graus;
}

export function indicaCalor(l: Leitura, graus: number): boolean {
  return l.temperatura_max_hoje !== null && l.temperatura_max_hoje >= graus;
}

// Segunda fonte (OpenWeatherMap), independente da primeira: só confirma
// "está chovendo agora". Precisa da chave OPENWEATHER_API_KEY na Vercel; sem
// ela, a chuva só sai pela regra de chuva sustentada. Se a chave existe e a
// consulta falha ou discorda, NÃO publica (na dúvida, não posta).
export type SegundaFonte = { disponivel: boolean; chovendo?: boolean; detalhe?: string };

export async function lerSegundaFonte(latitude: number, longitude: number): Promise<SegundaFonte> {
  const chave = process.env.OPENWEATHER_API_KEY;
  if (!chave) return { disponivel: false };
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}&appid=${encodeURIComponent(chave)}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { disponivel: true, chovendo: false, detalhe: `HTTP ${res.status}` };
    const json = (await res.json()) as { weather?: { main?: string }[]; rain?: { "1h"?: number } };
    const grupo = json.weather?.[0]?.main ?? "";
    const mm = json.rain?.["1h"] ?? 0;
    return { disponivel: true, chovendo: /^(Rain|Drizzle|Thunderstorm)$/.test(grupo) || mm > 0, detalhe: `${grupo || "sem dado"}${mm ? `, ${mm} mm/h` : ""}` };
  } catch (err) {
    return { disponivel: true, chovendo: false, detalhe: err instanceof Error ? err.message : "erro" };
  }
}
