import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MediaType } from "@/types/database";

// A mídia já chega pronta no Storage (upload direto do navegador via
// /api/uploads/signed-url — ver src/lib/uploadDireto.ts) — essa rota só
// recebe a referência (url/path/tipo), nunca o arquivo em si. Isso evita o
// limite de ~4,5MB de corpo de requisição da Vercel, que inviabilizava
// agendar vídeos um pouco maiores.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accountId = params.id;

  const { data: conta } = await admin.from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const diaSemana = Number(body?.day_of_week);
  const horario = String(body?.time_of_day || "");
  const media = body?.media as { url?: string; path?: string; mediaType?: string } | undefined;

  if (!diaSemana || diaSemana < 1 || diaSemana > 7) {
    return NextResponse.json({ erro: "Dia da semana inválido." }, { status: 400 });
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(horario)) {
    return NextResponse.json({ erro: "Horário inválido." }, { status: 400 });
  }
  if (!media?.url || !media.path || (media.mediaType !== "IMAGE" && media.mediaType !== "VIDEO")) {
    return NextResponse.json({ erro: "Escolha uma imagem ou vídeo." }, { status: 400 });
  }

  try {
    const { data: slot, error } = await admin
      .from("schedule_slots")
      .insert({
        account_id: accountId,
        day_of_week: diaSemana,
        time_of_day: horario.length === 5 ? `${horario}:00` : horario,
        media_url: media.url,
        media_path: media.path,
        media_type: media.mediaType as MediaType,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ slot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao salvar o horário.";
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
