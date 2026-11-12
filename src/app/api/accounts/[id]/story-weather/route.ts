import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// Configuração do Story Weather da conta + artes + últimas publicações.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const [{ data: config }, { data: itens }, { data: posts }] = await Promise.all([
    admin.from("story_weather_config").select("*").eq("account_id", params.id).maybeSingle(),
    admin
      .from("story_weather_itens")
      .select("id, tipo, media_url, media_type, thumbnail_data_url, usado_em, created_at")
      .eq("account_id", params.id)
      .order("created_at", { ascending: true }),
    admin
      .from("story_weather_posts")
      .select("id, tipo, dia, status, error_message, leitura, created_at, published_at")
      .eq("account_id", params.id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  return NextResponse.json({ config: config ?? null, itens: itens ?? [], posts: posts ?? [] });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });

  const admin = createAdminClient();
  const { data: atual } = await admin.from("story_weather_config").select("*").eq("account_id", params.id).maybeSingle();

  const campos: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.chuva_ativa === "boolean") campos.chuva_ativa = body.chuva_ativa;
  if (typeof body.calor_ativo === "boolean") campos.calor_ativo = body.calor_ativo;
  if (body.calor_graus !== undefined) {
    const g = Number(body.calor_graus);
    if (!Number.isInteger(g) || g < 25 || g > 45) return NextResponse.json({ erro: "A temperatura deve ser entre 25 e 45 °C." }, { status: 400 });
    campos.calor_graus = g;
  }
  if (body.max_chuva_por_dia !== undefined) {
    const m = Number(body.max_chuva_por_dia);
    if (!Number.isInteger(m) || m < 1 || m > 3) return NextResponse.json({ erro: "O máximo de Stories de chuva por dia é de 1 a 3." }, { status: 400 });
    campos.max_chuva_por_dia = m;
  }
  for (const k of ["janela_inicio", "janela_fim"] as const) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== "string" || !HORA.test(body[k])) return NextResponse.json({ erro: "Horário inválido." }, { status: 400 });
      campos[k] = body[k];
    }
  }
  if (body.cidade !== undefined) {
    const lat = Number(body.latitude);
    const lon = Number(body.longitude);
    if (typeof body.cidade !== "string" || !body.cidade.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ erro: "Cidade inválida." }, { status: 400 });
    }
    campos.cidade = body.cidade.trim();
    campos.latitude = Number(lat.toFixed(4));
    campos.longitude = Number(lon.toFixed(4));
    campos.chuva_confirmacoes = 0;
    campos.ultima_checagem = null;
    campos.ultima_leitura = null;
  }
  if (typeof body.ativo === "boolean") {
    const temCidade = (campos.cidade ?? atual?.cidade) && (campos.latitude ?? atual?.latitude) != null;
    if (body.ativo && !temCidade) return NextResponse.json({ erro: "Escolha a cidade antes de ligar." }, { status: 400 });
    campos.ativo = body.ativo;
    if (!body.ativo) campos.chuva_confirmacoes = 0;
  }
  const inicio = String(campos.janela_inicio ?? atual?.janela_inicio ?? "09:00").slice(0, 5);
  const fim = String(campos.janela_fim ?? atual?.janela_fim ?? "22:00").slice(0, 5);
  if (inicio >= fim) return NextResponse.json({ erro: "O horário final deve ser depois do inicial." }, { status: 400 });

  const { data, error } = await admin
    .from("story_weather_config")
    .upsert({ account_id: params.id, ...(atual ?? {}), ...campos }, { onConflict: "account_id" })
    .select("*")
    .single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
