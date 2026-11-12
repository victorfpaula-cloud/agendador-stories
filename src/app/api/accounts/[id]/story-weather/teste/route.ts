import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import { contaPublicouHoje } from "@/lib/engines/publicarStoryWeather";
import { CHUVA_MIN_MM, indicaCalor, indicaChuva, lerPrevisao } from "@/lib/weather";

// "Testar agora": lê a previsão da cidade configurada e mostra o que o robô
// decidiria, SEM publicar nada.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: cfg } = await admin.from("story_weather_config").select("*").eq("account_id", params.id).maybeSingle();
  if (!cfg?.latitude || !cfg?.longitude) return NextResponse.json({ erro: "Escolha a cidade primeiro." }, { status: 400 });
  try {
    const leitura = await lerPrevisao(Number(cfg.latitude), Number(cfg.longitude));
    return NextResponse.json({
      cidade: cfg.cidade,
      ja_publicou_hoje: await contaPublicouHoje(admin, params.id, agoraEmSaoPaulo().dataISO),
      leitura,
      chuva: { indica: indicaChuva(leitura), minimo_mm: CHUVA_MIN_MM },
      calor: { indica: indicaCalor(leitura, cfg.calor_graus), graus: cfg.calor_graus },
    });
  } catch (err) {
    return NextResponse.json({ erro: err instanceof Error ? err.message : "Erro ao ler a previsão." }, { status: 502 });
  }
}
