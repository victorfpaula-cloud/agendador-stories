import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo, paraMinutos } from "@/lib/days";
import { publicarStory, MetaApiError } from "@/lib/meta";
import type { Account, ScheduleSlot } from "@/types/database";

export const dynamic = "force-dynamic";

// Tolerância: um slot é considerado "devido" se o horário marcado já passou
// nos últimos TOLERANCIA_MINUTOS. Isso cobre atrasos do próprio agendador
// (cron a cada 5 min, ou um GitHub Actions que às vezes atrasa) sem publicar
// o mesmo horário duas vezes nem pular o horário por 1-2 minutos de diferença.
const TOLERANCIA_MINUTOS = 15;

export async function GET(req: NextRequest) {
  return executar(req);
}

export async function POST(req: NextRequest) {
  return executar(req);
}

async function executar(req: NextRequest) {
  const segredoEsperado = process.env.CRON_SECRET;
  const segredoRecebido = req.headers.get("x-cron-secret");

  if (!segredoEsperado || segredoRecebido !== segredoEsperado) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { diaSemanaIso, horaMinuto, dataISO } = agoraEmSaoPaulo();
  const minutosAgora = paraMinutos(horaMinuto);

  const { data: slotsDoDia, error } = await admin
    .from("schedule_slots")
    .select("*, accounts!inner(*)")
    .eq("day_of_week", diaSemanaIso)
    .eq("is_active", true)
    .eq("accounts.is_active", true);

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const candidatos = (slotsDoDia ?? []) as (ScheduleSlot & { accounts: Account })[];

  const devidos = candidatos.filter((s) => {
    const minutosSlot = paraMinutos(s.time_of_day);
    return minutosSlot <= minutosAgora && minutosAgora - minutosSlot <= TOLERANCIA_MINUTOS;
  });

  const resultados: Array<{ slotId: string; conta: string; status: string; detalhe?: string }> = [];

  for (const slot of devidos) {
    const conta = slot.accounts;

    // Evita duplicidade: já existe um log de sucesso ou erro pra esse slot nessa data?
    const { data: jaExecutado } = await admin
      .from("publish_log")
      .select("id")
      .eq("slot_id", slot.id)
      .eq("scheduled_for", dataISO)
      .maybeSingle();

    if (jaExecutado) continue;

    try {
      const igMediaId = await publicarStory({
        igUserId: conta.ig_user_id,
        pageAccessToken: conta.page_access_token,
        mediaUrl: slot.media_url,
        mediaType: slot.media_type,
      });

      await admin.from("publish_log").insert({
        slot_id: slot.id,
        account_id: conta.id,
        scheduled_for: dataISO,
        status: "success",
        ig_media_id: igMediaId,
      });

      resultados.push({ slotId: slot.id, conta: conta.name, status: "success" });
    } catch (err) {
      const msg = err instanceof MetaApiError || err instanceof Error ? err.message : "Erro desconhecido";

      await admin.from("publish_log").insert({
        slot_id: slot.id,
        account_id: conta.id,
        scheduled_for: dataISO,
        status: "error",
        error_message: msg,
      });

      resultados.push({ slotId: slot.id, conta: conta.name, status: "error", detalhe: msg });
    }
  }

  return NextResponse.json({
    executadoEm: `${dataISO} ${horaMinuto} (America/Sao_Paulo)`,
    candidatos: candidatos.length,
    publicados: resultados.filter((r) => r.status === "success").length,
    falhas: resultados.filter((r) => r.status === "error").length,
    detalhes: resultados,
  });
}
