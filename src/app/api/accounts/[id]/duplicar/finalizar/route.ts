import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { removerMidia } from "@/lib/storage";

type ItemDuplicado = {
  day_of_week: number;
  time_of_day: string;
  media_url: string;
  media_path: string;
  media_type: string;
  is_active: boolean;
};

// Terceira e última etapa do "Duplicar rotina": só é chamada depois que
// TODOS os arquivos já foram copiados com sucesso (etapa anterior). Insere
// a rotina nova ANTES de apagar a antiga — se algo falhar aqui, a conta de
// destino nunca fica sem nenhuma rotina no meio do caminho, e os horários
// antigos são removidos pelos IDs exatos que já tínhamos guardado (os
// horários novos ganham IDs novos, então nunca há risco de confundir um
// com o outro).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const destinoId = params.id;

  const { data: destino } = await admin.from("accounts").select("id").eq("id", destinoId).maybeSingle();
  if (!destino) {
    return NextResponse.json({ erro: "Conta de destino não encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const itens = body?.itens as ItemDuplicado[] | undefined;

  if (!Array.isArray(itens) || itens.length === 0) {
    return NextResponse.json({ erro: "Nenhum item duplicado pra salvar." }, { status: 400 });
  }

  for (const item of itens) {
    if (
      typeof item.day_of_week !== "number" ||
      item.day_of_week < 1 ||
      item.day_of_week > 7 ||
      typeof item.time_of_day !== "string" ||
      !/^\d{2}:\d{2}(:\d{2})?$/.test(item.time_of_day) ||
      typeof item.media_url !== "string" ||
      typeof item.media_path !== "string" ||
      (item.media_type !== "IMAGE" && item.media_type !== "VIDEO")
    ) {
      return NextResponse.json({ erro: "Um dos itens duplicados veio com dados inválidos." }, { status: 400 });
    }
  }

  // Guarda os horários antigos da conta de destino (id + caminho da mídia)
  // ANTES de mexer em qualquer coisa.
  const { data: slotsAntigos, error: erroSlotsAntigos } = await admin
    .from("schedule_slots")
    .select("id, media_path")
    .eq("account_id", destinoId);

  if (erroSlotsAntigos) {
    return NextResponse.json({ erro: erroSlotsAntigos.message }, { status: 500 });
  }

  const novasLinhas = itens.map((item) => ({
    account_id: destinoId,
    day_of_week: item.day_of_week,
    time_of_day: item.time_of_day,
    media_url: item.media_url,
    media_path: item.media_path,
    media_type: item.media_type,
    is_active: item.is_active,
  }));

  // Insere a rotina nova PRIMEIRO. Se isso falhar, a rotina antiga (se
  // houver) continua lá intacta — nunca existe um momento em que a conta
  // fica sem nenhum horário.
  const { error: erroInsert } = await admin.from("schedule_slots").insert(novasLinhas);
  if (erroInsert) {
    return NextResponse.json({ erro: erroInsert.message }, { status: 500 });
  }

  // Só agora remove a rotina antiga.
  const idsAntigos = (slotsAntigos ?? []) as { id: string; media_path: string }[];
  if (idsAntigos.length > 0) {
    const { error: erroDelete } = await admin
      .from("schedule_slots")
      .delete()
      .in(
        "id",
        idsAntigos.map((s) => s.id)
      );
    if (erroDelete) {
      return NextResponse.json({ erro: erroDelete.message }, { status: 500 });
    }
    for (const antigo of idsAntigos) {
      await removerMidia(admin, antigo.media_path);
    }
  }

  return NextResponse.json({ ok: true, quantidade: novasLinhas.length });
}
