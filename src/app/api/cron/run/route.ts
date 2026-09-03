import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo, paraMinutos } from "@/lib/days";
import { publicarStory, MetaApiError } from "@/lib/meta";
import { gerarThumbnailServidor } from "@/lib/thumbnailServidor";
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

    // Evita duplicidade: já existe uma publicação de SUCESSO pra esse slot nessa
    // data? Se só existe erro, deixa tentar de novo — o cron roda a cada 5 min,
    // então uma falha passageira (ex: o Instagram ainda processando a imagem)
    // tem novas chances dentro da janela de tolerância, em vez de desistir de vez.
    const { data: jaPublicado } = await admin
      .from("publish_log")
      .select("id")
      .eq("slot_id", slot.id)
      .eq("scheduled_for", dataISO)
      .eq("status", "success")
      .maybeSingle();

    if (jaPublicado) continue;

    try {
      const igMediaId = await publicarStory({
        igUserId: conta.ig_user_id,
        pageAccessToken: conta.page_access_token,
        mediaUrl: slot.media_url,
        mediaType: slot.media_type,
      });

      // upsert, não insert: já existe uma linha de ERRO de uma tentativa
      // anterior de hoje (a tabela só permite uma linha por slot+dia). Com
      // insert, essa chamada falhava por violar essa trava, o sucesso nunca
      // ficava registrado, e o próximo ciclo do cron achava que ainda
      // precisava tentar de novo — publicando o mesmo Story várias vezes.
      await admin
        .from("publish_log")
        .upsert(
          {
            slot_id: slot.id,
            account_id: conta.id,
            scheduled_for: dataISO,
            status: "success",
            ig_media_id: igMediaId,
            error_message: null,
          },
          { onConflict: "slot_id,scheduled_for" }
        );

      resultados.push({ slotId: slot.id, conta: conta.name, status: "success" });

      // Aproveita o post ter acabado de publicar (o arquivo já foi baixado
      // pelo Instagram, então já sabemos que a URL é válida) pra preencher a
      // miniatura de horários antigos que ainda não têm uma — sem isso, a
      // grade da semana carrega o arquivo original inteiro só pra desenhar
      // um quadradinho de 36x36px (foi o que estourou o Cached Egress do
      // Supabase, ver comentário em WeekEditor.tsx). Só foto, best-effort:
      // se falhar por qualquer motivo, não afeta a publicação — já
      // aconteceu e já foi registrada acima. Vídeo continua de fora aqui
      // (ver thumbnailServidor.ts) até a mídia ser trocada pela tela.
      await gerarMiniaturaSeFaltar(admin, slot);
    } catch (err) {
      const msg = err instanceof MetaApiError || err instanceof Error ? err.message : "Erro desconhecido";

      await admin
        .from("publish_log")
        .upsert(
          {
            slot_id: slot.id,
            account_id: conta.id,
            scheduled_for: dataISO,
            status: "error",
            error_message: msg,
          },
          { onConflict: "slot_id,scheduled_for" }
        );

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

async function gerarMiniaturaSeFaltar(admin: ReturnType<typeof createAdminClient>, slot: ScheduleSlot) {
  if (slot.thumbnail_data_url || slot.media_type !== "IMAGE") return;

  try {
    const res = await fetch(slot.media_url, { cache: "no-store" });
    if (!res.ok) return;

    const buffer = Buffer.from(await res.arrayBuffer());
    const thumbnailDataUrl = await gerarThumbnailServidor(buffer);
    if (!thumbnailDataUrl) return;

    await admin.from("schedule_slots").update({ thumbnail_data_url: thumbnailDataUrl }).eq("id", slot.id);
  } catch {
    // Ignorado de propósito — ver comentário no ponto de chamada.
  }
}
