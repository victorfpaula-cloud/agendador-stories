import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo, paraMinutos } from "@/lib/days";
import { publicarStory, MetaApiError } from "@/lib/meta";
import { enviarEmail } from "@/lib/email";
import type { Account, ScheduleSlot } from "@/types/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  let diaSemanaIso: number, horaMinuto: string, dataISO: string;
  try {
    ({ diaSemanaIso, horaMinuto, dataISO } = agoraEmSaoPaulo());
  } catch (err) {
    // Se não der pra determinar com segurança que dia/hora é agora, é mais
    // seguro não publicar nada nesse ciclo do que arriscar publicar no dia
    // errado. O próximo ciclo do cron tenta de novo em 5 minutos.
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ erro: `Abortado por segurança: ${msg}` }, { status: 500 });
  }

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

    // Reivindica esse horário antes de publicar (função no banco, ver
    // migração reivindicar_publicacao_function): só uma execução consegue
    // "ganhar" o slot+dia por vez. Isso é essencial porque o Supabase
    // (pg_net) às vezes desiste de esperar resposta dessa rota por timeout e
    // manda a chamada de novo, enquanto a primeira ainda está publicando por
    // trás — sem essa trava, as duas publicavam no Instagram (Story
    // duplicado). O antigo "SELECT antes de publicar" não protegia contra
    // isso: as duas chamadas viam "ainda não publiquei" ao mesmo tempo.
    const { data: reivindicacao, error: erroReivindicar } = await admin
      .rpc("reivindicar_publicacao", {
        p_slot_id: slot.id,
        p_account_id: conta.id,
        p_scheduled_for: dataISO,
      })
      .single<{ reivindicado: boolean; primeira_tentativa: boolean }>();

    if (erroReivindicar || !reivindicacao?.reivindicado) continue;

    const primeiraTentativa = reivindicacao.primeira_tentativa;

    try {
      const igMediaId = await publicarStory({
        igUserId: conta.ig_user_id,
        pageAccessToken: conta.page_access_token,
        mediaUrl: slot.media_url,
        mediaType: slot.media_type,
      });

      await admin
        .from("publish_log")
        .update({ status: "success", ig_media_id: igMediaId, error_message: null })
        .eq("slot_id", slot.id)
        .eq("scheduled_for", dataISO);

      resultados.push({ slotId: slot.id, conta: conta.name, status: "success" });
    } catch (err) {
      const msg = err instanceof MetaApiError || err instanceof Error ? err.message : "Erro desconhecido";

      await admin
        .from("publish_log")
        .update({ status: "error", error_message: msg })
        .eq("slot_id", slot.id)
        .eq("scheduled_for", dataISO);

      resultados.push({ slotId: slot.id, conta: conta.name, status: "error", detalhe: msg });

      // Só na primeira tentativa do dia pra esse horário — sem isso, uma
      // falha persistente mandaria um e-mail a cada nova retentativa dentro
      // da janela de tolerância, em vez de só uma vez.
      if (primeiraTentativa) {
        await enviarEmail({
          assunto: `Erro ao publicar Story — ${conta.name}`,
          corpo:
            `A conta "${conta.name}" teve um erro ao tentar publicar o Story agendado pra hoje ` +
            `(${dataISO}), horário ${slot.time_of_day.slice(0, 5)}.\n\n` +
            `Erro: ${msg}\n\n` +
            `O cron continua tentando de novo por até ${TOLERANCIA_MINUTOS} minutos — se não conseguir, ` +
            `publica esse Story manualmente.`,
        });
      }
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
