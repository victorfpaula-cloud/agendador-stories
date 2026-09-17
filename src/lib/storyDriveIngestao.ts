import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import { enviarMidiaBuffer } from "@/lib/storage";
import {
  baixarArquivoDrive,
  baixarThumbnailDrive,
  encontrarSubpasta,
  extrairIdDaPasta,
  listarArquivosDaPasta,
  obterAccessToken,
} from "@/lib/drive";
import type { StoryDriveConfig } from "@/types/database";

// Lê a pasta do dia no Google Drive e cria os Stories automáticos de uma
// conta — irmão de src/lib/driveIngestao.ts (Drive do Feed), mas pra
// Stories. Diferenças importantes (Instagram não tem "carrossel" de Story):
//   * até 5 arquivos por dia, cada um com seu PRÓPRIO horário
//     (config.horario_1..horario_5) — o arquivo N (ordem alfabética, mesmo
//     critério do Feed) só vira Story se horario_N estiver preenchido; em
//     branco, esse arquivo é ignorado mesmo que exista.
//   * pasta do dia é direto "DD-MM-AAAA" dentro da pasta-mãe, sem pasta de
//     mês no meio.
//   * sem legenda, sem filtrar arquivo por nome (Victor confirmou que
//     podem vir outros arquivos misturados na mesma pasta).
// Compartilhada entre o cron diário (/api/cron/ler-stories-drive, roda
// sozinho às 9h) e o botão "Tentar de novo agora"
// (/api/accounts/[id]/story-drive-config/tentar-de-novo).
export type ResultadoStoryDrive = "sem_config" | "sem_pasta" | "sem_horario" | "ja_existe" | "stories_criados" | "erro";

async function registrarExecucao(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string,
  resultado: ResultadoStoryDrive,
  detalhe: string | null
) {
  await admin.from("story_drive_execucoes").insert({ account_id: accountId, resultado, detalhe });
}

// "2026-09-17" -> "17-09-2026" (formato da pasta do dia nesse sub-módulo,
// diferente do Drive do Feed).
function paraNomePastaDia(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}-${mes}-${ano}`;
}

export async function executarLeituraStoryDrive(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string
): Promise<{ resultado: ResultadoStoryDrive; detalhe?: string; criados?: number }> {
  const { dataISO } = agoraEmSaoPaulo();

  // Reivindica antes de tocar em qualquer coisa — evita duas execuções
  // concorrentes (pg_net retentando uma chamada que só pareceu ter travado
  // por timeout, mas ainda está processando por trás; ou o cron das 9h e um
  // clique manual em "Tentar de novo" quase ao mesmo tempo). Diferente do
  // Drive do Feed, aqui o dia NUNCA fica "fechado" depois de um sucesso —
  // Victor confirmou que costuma adicionar arquivo 2, 3 na pasta do dia ao
  // longo do dia, então "Tentar de novo agora" precisa continuar
  // funcionando mesmo depois de já ter criado algo hoje. A reivindicação só
  // bloqueia enquanto outra execução está mesmo rodando agora (ou travada há
  // pouco tempo) — sucesso e erro liberam pra reivindicar de novo na hora.
  const { data: reivindicacao } = await admin
    .rpc("reivindicar_ingestao_story_drive", { p_account_id: accountId, p_dia: dataISO })
    .single<{ reivindicado: boolean }>();

  if (!reivindicacao?.reivindicado) {
    return {
      resultado: "ja_existe",
      detalhe: "Outra execução já está processando o dia de hoje agora — tenta de novo em instantes.",
    };
  }

  async function finalizar(resultado: ResultadoStoryDrive, detalhe: string | null) {
    await registrarExecucao(admin, accountId, resultado, detalhe);
    await admin
      .from("story_drive_lock")
      .update({ status: resultado === "erro" ? "erro" : "sucesso" })
      .eq("account_id", accountId)
      .eq("dia", dataISO);
  }

  try {
    const { data: config } = await admin
      .from("story_drive_config")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle();
    const cfg = config as StoryDriveConfig | null;

    if (!cfg?.pasta_drive_id) {
      await finalizar("sem_config", "Falta configurar a pasta do Drive dessa conta.");
      return { resultado: "sem_config" };
    }

    const horarios = [cfg.horario_1, cfg.horario_2, cfg.horario_3, cfg.horario_4, cfg.horario_5];
    if (horarios.every((h) => !h)) {
      await finalizar("sem_horario", "Nenhum horário configurado (Arquivo 1 a 5) — nada pra publicar.");
      return { resultado: "sem_horario" };
    }

    // Quais horários (posições) já têm um Story criado hoje — pra não
    // duplicar quando "Tentar de novo agora" roda de novo mais tarde no
    // mesmo dia (ex: Victor adicionou o arquivo 2 na pasta depois que o
    // arquivo 1 já tinha virado Story de manhã). Compara por scheduled_at
    // exato: cada posição tem um horário diferente, então dá pra saber
    // exatamente qual posição já foi processada sem precisar guardar o
    // número da posição na tabela.
    const inicioDiaUTC = new Date(`${dataISO}T00:00:00-03:00`).toISOString();
    const fimDiaUTC = new Date(`${dataISO}T23:59:59-03:00`).toISOString();
    const { data: existentes } = await admin
      .from("story_posts")
      .select("scheduled_at")
      .eq("account_id", accountId)
      .eq("source", "drive")
      .gte("scheduled_at", inicioDiaUTC)
      .lte("scheduled_at", fimDiaUTC);

    const horariosJaCriados = new Set(
      ((existentes ?? []) as { scheduled_at: string }[]).map((e) => new Date(e.scheduled_at).toISOString())
    );

    const pastaMaeId = extrairIdDaPasta(cfg.pasta_drive_id);
    const accessToken = await obterAccessToken();

    const nomePastaDia = paraNomePastaDia(dataISO);
    const pastaDiaId = await encontrarSubpasta(accessToken, pastaMaeId, nomePastaDia);

    if (!pastaDiaId) {
      // Normal e esperado — dia sem pasta é dia sem Story, não é erro.
      await finalizar("sem_pasta", `Pasta do dia "${nomePastaDia}" não encontrada — dia sem Story.`);
      return { resultado: "sem_pasta" };
    }

    // Sem filtro por nome de propósito (Victor confirmou que podem vir
    // outros arquivos misturados na mesma pasta, ex: conteúdo de Delivery)
    // — só o tipo (imagem/vídeo) importa, mesmo critério do Drive do Feed.
    const arquivos = await listarArquivosDaPasta(accessToken, pastaDiaId);
    const arquivosMidia = arquivos.filter((a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/"));

    if (arquivosMidia.length === 0) {
      const detalhe = `Pasta do dia "${nomePastaDia}" encontrada, mas sem nenhuma foto/vídeo dentro.`;
      await finalizar("erro", detalhe);
      return { resultado: "erro", detalhe };
    }

    // Casamento posicional e estrito: arquivo N (ordem alfabética) só vira
    // Story se horario_N estiver preenchido — em branco, esse arquivo é
    // ignorado mesmo que exista (regra explícita do Victor). Também ignora
    // arquivos além da posição 5 (não tem horário configurável pra eles), e
    // pula posições que já viraram Story numa execução anterior hoje (ver
    // horariosJaCriados acima) — assim rodar de novo só processa o que é
    // novo, sem duplicar o que já foi feito.
    const casamentos: { posicao: number; horario: string; scheduledAt: string; arquivo: (typeof arquivosMidia)[number] }[] = [];
    let algumaPosicaoJaCriada = false;
    for (let i = 0; i < 5; i++) {
      const horario = horarios[i];
      const arquivo = arquivosMidia[i];
      if (!horario || !arquivo) continue;

      const scheduledAt = new Date(`${dataISO}T${horario}-03:00`).toISOString();
      if (horariosJaCriados.has(scheduledAt)) {
        algumaPosicaoJaCriada = true;
        continue;
      }
      casamentos.push({ posicao: i + 1, horario, scheduledAt, arquivo });
    }

    if (casamentos.length === 0) {
      if (algumaPosicaoJaCriada) {
        const detalhe = "Os Stories configurados pra hoje já tinham sido criados antes — nada novo pra fazer.";
        await finalizar("ja_existe", detalhe);
        return { resultado: "ja_existe", detalhe };
      }
      const detalhe = `Havia ${arquivosMidia.length} arquivo(s) na pasta, mas nenhum tem horário configurado pra essa posição.`;
      await finalizar("sem_horario", detalhe);
      return { resultado: "sem_horario", detalhe };
    }

    // Baixa cada mídia do Drive e sobe pro Storage do Supabase — mesmo
    // bucket usado pelos Stories manuais (schedule_slots), já que na
    // prática é o mesmo tipo de conteúdo (um Story avulso).
    const criados: string[] = [];
    for (const { scheduledAt, arquivo } of casamentos) {
      const buffer = await baixarArquivoDrive(accessToken, arquivo.id);
      const tipo: "IMAGE" | "VIDEO" = arquivo.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE";
      const enviado = await enviarMidiaBuffer(admin, "story-media", "drive", buffer, arquivo.mimeType, arquivo.name);
      const thumbnailDataUrl = arquivo.thumbnailLink
        ? await baixarThumbnailDrive(accessToken, arquivo.thumbnailLink)
        : null;

      const { data: storyPost, error: erroStoryPost } = await admin
        .from("story_posts")
        .insert({
          account_id: accountId,
          scheduled_at: scheduledAt,
          media_url: enviado.url,
          media_path: enviado.path,
          media_type: tipo,
          thumbnail_data_url: thumbnailDataUrl,
          source: "drive",
        })
        .select("id")
        .single();

      if (erroStoryPost || !storyPost) throw new Error(erroStoryPost?.message || "Erro ao criar o Story automático.");
      criados.push(storyPost.id);
    }

    await finalizar("stories_criados", `${criados.length} Story(s) criado(s) a partir do Drive.`);
    return { resultado: "stories_criados", criados: criados.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido.";
    await finalizar("erro", msg);
    return { resultado: "erro", detalhe: msg };
  }
}
