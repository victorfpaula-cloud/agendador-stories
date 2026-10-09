import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Agendamento Único: uma mídia, uma data/horário inicial e 1–7 dias seguidos.
// Cria uma linha por dia (mesmo grupo), publicadas por executarPublicarStoriesUnico.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const data = String(body?.data ?? "");
  const hora = String(body?.hora ?? "");
  const dias = Number(body?.dias);
  const m = body?.media as { url?: string; path?: string; mediaType?: string; thumbnailDataUrl?: string | null } | undefined;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) {
    return NextResponse.json({ erro: "Escolha a data e o horário." }, { status: 400 });
  }
  if (!Number.isInteger(dias) || dias < 1 || dias > 7) {
    return NextResponse.json({ erro: "Escolha de 1 a 7 dias." }, { status: 400 });
  }
  if (!m?.url || !m.path || (m.mediaType !== "IMAGE" && m.mediaType !== "VIDEO")) {
    return NextResponse.json({ erro: "Envie a mídia do Story." }, { status: 400 });
  }

  // Horário de São Paulo (UTC-3, sem horário de verão).
  const inicio = new Date(`${data}T${hora}:00-03:00`);
  if (Number.isNaN(inicio.getTime()) || inicio.getTime() <= Date.now()) {
    return NextResponse.json({ erro: "A data/horário do primeiro Story precisa ser no futuro." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: conta } = await admin.from("accounts").select("id").eq("id", params.id).maybeSingle();
  if (!conta) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  const grupoId = randomUUID();
  const linhas = Array.from({ length: dias }, (_, i) => {
    const d = new Date(`${data}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const dia = d.toISOString().slice(0, 10);
    return {
      grupo_id: grupoId,
      account_id: params.id,
      dia,
      scheduled_at: new Date(`${dia}T${hora}:00-03:00`).toISOString(),
      media_url: m.url,
      media_path: m.path,
      media_type: m.mediaType,
      thumbnail_data_url: m.thumbnailDataUrl ?? null,
    };
  });

  const { data: criadas, error } = await admin.from("story_unico_posts").insert(linhas).select("*");
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ linhas: criadas });
}
