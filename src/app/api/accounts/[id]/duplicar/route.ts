import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { duplicarMidia, removerMidia } from "@/lib/storage";
import type { ScheduleSlot } from "@/types/database";

// Substitui TODA a rotina semanal da conta [id] (destino) por uma cópia da
// rotina de outra conta (origem). Ordem pensada pra ser segura: primeiro
// duplica tudo (mídia + horários) num rascunho à parte, sem tocar em nada da
// conta de destino. Só depois que a cópia inteira deu certo é que a rotina
// antiga é apagada e a nova entra no lugar — assim, se algo falhar no meio
// do caminho, a conta de destino continua exatamente como estava antes.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const destinoId = params.id;

  const body = await req.json().catch(() => null);
  const origemId = body?.origem_id as string | undefined;

  if (!origemId) {
    return NextResponse.json({ erro: "Escolha a conta de origem." }, { status: 400 });
  }
  if (origemId === destinoId) {
    return NextResponse.json({ erro: "A conta de origem precisa ser diferente da conta atual." }, { status: 400 });
  }

  const { data: destino } = await admin.from("accounts").select("id").eq("id", destinoId).maybeSingle();
  if (!destino) {
    return NextResponse.json({ erro: "Conta de destino não encontrada." }, { status: 404 });
  }

  const { data: origem } = await admin.from("accounts").select("id, name").eq("id", origemId).maybeSingle();
  if (!origem) {
    return NextResponse.json({ erro: "Conta de origem não encontrada." }, { status: 404 });
  }

  const { data: slotsOrigem, error: erroSlots } = await admin
    .from("schedule_slots")
    .select("*")
    .eq("account_id", origemId);

  if (erroSlots) {
    return NextResponse.json({ erro: erroSlots.message }, { status: 500 });
  }

  const slots = (slotsOrigem ?? []) as ScheduleSlot[];

  if (slots.length === 0) {
    return NextResponse.json(
      { erro: `A conta "${origem.name}" ainda não tem nenhum horário configurado.` },
      { status: 400 }
    );
  }

  // Passo 1: duplica tudo num rascunho. Nada da conta de destino é tocado
  // ainda nessa etapa.
  const novasLinhas: Array<{
    account_id: string;
    day_of_week: number;
    time_of_day: string;
    media_url: string;
    media_path: string;
    media_type: string;
    is_active: boolean;
  }> = [];
  const arquivosCriadosNessaTentativa: string[] = [];

  try {
    for (const slot of slots) {
      const copia = await duplicarMidia(admin, destinoId, slot.media_path);
      arquivosCriadosNessaTentativa.push(copia.path);
      novasLinhas.push({
        account_id: destinoId,
        day_of_week: slot.day_of_week,
        time_of_day: slot.time_of_day,
        media_url: copia.url,
        media_path: copia.path,
        media_type: slot.media_type,
        is_active: slot.is_active,
      });
    }
  } catch (err) {
    // Algo falhou no meio da cópia — desfaz os arquivos já criados nessa
    // tentativa (pra não deixar lixo órfão no armazenamento) e devolve erro
    // sem ter apagado nada da conta de destino.
    for (const path of arquivosCriadosNessaTentativa) {
      await removerMidia(admin, path);
    }
    const msg = err instanceof Error ? err.message : "Erro ao copiar a mídia.";
    return NextResponse.json({ erro: `Não foi possível duplicar a rotina: ${msg}` }, { status: 500 });
  }

  // Passo 2: cópia pronta e confirmada — agora sim substitui a rotina antiga
  // da conta de destino pela nova.
  const { data: slotsAntigos, error: erroSlotsAntigos } = await admin
    .from("schedule_slots")
    .select("media_path")
    .eq("account_id", destinoId);

  if (erroSlotsAntigos) {
    for (const path of arquivosCriadosNessaTentativa) {
      await removerMidia(admin, path);
    }
    return NextResponse.json({ erro: erroSlotsAntigos.message }, { status: 500 });
  }

  const { error: erroDelete } = await admin.from("schedule_slots").delete().eq("account_id", destinoId);
  if (erroDelete) {
    for (const path of arquivosCriadosNessaTentativa) {
      await removerMidia(admin, path);
    }
    return NextResponse.json({ erro: erroDelete.message }, { status: 500 });
  }

  for (const antigo of (slotsAntigos ?? []) as { media_path: string }[]) {
    await removerMidia(admin, antigo.media_path);
  }

  const { error: erroInsert } = await admin.from("schedule_slots").insert(novasLinhas);
  if (erroInsert) {
    return NextResponse.json({ erro: erroInsert.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, quantidade: novasLinhas.length });
}
