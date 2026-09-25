import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo, paraMinutos } from "@/lib/days";
import { publicarStory, MetaApiError } from "@/lib/meta";
import { enviarEmail } from "@/lib/email";
import type { Account, ScheduleSlot } from "@/types/database";

// Motor do Stories semanal (rotina recorrente, schedule_slots/publish_log).
// Extraído de /api/cron/run pra poder ser chamado tanto pela rota
// individual (debug manual) quanto pelo cron combinado /api/cron/publicar-tudo
// (ver comentário lá pro porquê de combinar).

// Tolerância: um slot é considerado "devido" se o horário marcado já passou
// nos últimos TOLERANCIA_MINUTOS. Isso cobre atrasos do próprio agendador
// (cron a cada 5 min, ou um GitHub Actions que às vezes atrasa) sem publicar
// o mesmo horário duas vezes nem pular o horário por 1-2 minutos de diferença.
const TOLERANCIA_MINUTOS = 15;

// Só manda e-mail de erro depois de esgotar as tentativas — uma falha
// passageira (instabilidade da Graph API, por exemplo) tem grande chance de
// se resolver sozinha no próximo ciclo do cron, 5 minutos depois. Avisar
// Victor a cada tentativa isolada seria alarme falso na maioria das vezes.
const LIMITE_TENTATIVAS = 3;

export async function executarPublicarStoriesSemanal(admin: ReturnType<typeof createAdminClient>) {
  let diaSemanaIso: number, horaMinuto: string, dataISO: string;
  try {
    ({ diaSemanaIso, horaMinuto, dataISO } = agoraEmSaoPaulo());
  } catch (err) {
    // Se não der pra determinar com segurança que dia/hora é agora, é mais
    // seguro não publicar nada nesse ciclo do que arriscar publicar no dia
    // errado. O próximo ciclo do cron tenta de novo em 5 minutos.
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return { erro: `Abortado por segurança: ${msg}` };
  }

  const minutosAgora = paraMinutos(horaMinuto);

  const { data: slotsDoDia, error } = await admin
    .from("schedule_slots")
    .select("*, accounts!inner(*)")
    .eq("day_of_week", diaSemanaIso)
    .eq("is_active", true)
    .eq("accounts.is_active", true);

  if (error) {
    return { erro: error.message };
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
      .single<{ reivindicado: boolean; tentativas: number }>();

    if (erroReivindicar || !reivindicacao?.reivindicado) continue;

    const tentativas = reivindicacao.tentativas;

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

      // Só avisa por e-mail depois de esgotar as tentativas — antes disso,
      // o próprio cron tenta de novo sozinho no próximo ciclo (5 em 5 min,
      // dentro da janela de tolerância de ${TOLERANCIA_MINUTOS} min).
      if (tentativas >= LIMITE_TENTATIVAS) {
        await enviarEmail({
          assunto: `Erro ao publicar Story — ${conta.name}`,
          corpo:
            `A conta "${conta.name}" teve um erro ao tentar publicar o Story agendado pra hoje ` +
            `(${dataISO}), horário ${slot.time_of_day.slice(0, 5)}, depois de ${tentativas} tentativas.\n\n` +
            `Erro: ${msg}\n\n` +
            `Publica esse Story manualmente.`,
        });
      }
    }
  }

  return {
    executadoEm: `${dataISO} ${horaMinuto} (America/Sao_Paulo)`,
    candidatos: candidatos.length,
    publicados: resultados.filter((r) => r.status === "success").length,
    falhas: resultados.filter((r) => r.status === "error").length,
    detalhes: resultados,
  };
}
