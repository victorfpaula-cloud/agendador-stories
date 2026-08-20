import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarMidia } from "@/lib/storage";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accountId = params.id;

  const { data: conta } = await admin.from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (!conta) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const formData = await req.formData();
  const diaSemana = Number(formData.get("day_of_week"));
  const horario = String(formData.get("time_of_day") || "");
  const file = formData.get("file") as File | null;

  if (!diaSemana || diaSemana < 1 || diaSemana > 7) {
    return NextResponse.json({ erro: "Dia da semana inválido." }, { status: 400 });
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(horario)) {
    return NextResponse.json({ erro: "Horário inválido." }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ erro: "Escolha uma imagem ou vídeo." }, { status: 400 });
  }

  try {
    const midia = await enviarMidia(admin, accountId, file);

    const { data: slot, error } = await admin
      .from("schedule_slots")
      .insert({
        account_id: accountId,
        day_of_week: diaSemana,
        time_of_day: horario.length === 5 ? `${horario}:00` : horario,
        media_url: midia.url,
        media_path: midia.path,
        media_type: midia.mediaType,
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
