import { NextRequest, NextResponse } from "next/server";

// Busca de cidade (OpenStreetMap/Nominatim) só pra configurar o Story Weather
// — uso raro, bem abaixo do limite de 1 consulta por segundo.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 3) return NextResponse.json({ resultados: [] });
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&countrycodes=br&addressdetails=1&accept-language=pt-BR`;
    const res = await fetch(url, {
      headers: { "User-Agent": "AgendadorStories/1.0 github.com/victorfpaula-cloud/agendador-stories" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const lista = (await res.json()) as { lat: string; lon: string; display_name: string; address?: Record<string, string> }[];
    const resultados = lista.map((r) => {
      const a = r.address ?? {};
      const nome = a.city || a.town || a.village || a.municipality || r.display_name.split(",")[0];
      return { nome: [nome, a.state].filter(Boolean).join(" — "), latitude: Number(r.lat), longitude: Number(r.lon) };
    });
    return NextResponse.json({ resultados });
  } catch {
    return NextResponse.json({ erro: "Não consegui buscar a cidade agora. Tente de novo." }, { status: 502 });
  }
}
