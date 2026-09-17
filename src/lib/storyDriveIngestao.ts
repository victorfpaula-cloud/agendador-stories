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
//   * TODOS os arquivos de foto/vídeo da pasta do dia contam (até um limite
//     de segurança, ver LIMITE_ARQUIVOS_POR_DIA) — sem filtrar por nome,
//     Victor confirmou que podem vir outros arquivos misturados.
//   * cada arquivo carrega o seu PRÓPRIO horário, embutido no nome pelo
//     Google Apps Script a partir do assunto do e-mail (ex:
//     "..._1530_17-09-2026_01.jpg" = 15h30) — ver extrairHorarioDoNomeDoArquivo.
//     Sem esse padrão no nome, o Story é criado mesmo assim, mas com
//     status "error" e sem scheduled_at, pra Victor completar o horário à
//     mão na lista de "Stories de hoje" (mudança de 17/09/2026, antes disso
//     os horários vinham de 5 campos fixos na configuração da conta).
//   * pasta do dia é direto "DD-MM-AAAA" dentro da pasta-mãe, sem pasta de
//     mês no meio.
//   * dedup por drive_file_id (não mais por horário/posição) — cada arquivo
//     do Drive só vira um story_posts, não importa quantas vezes o robô ou
//     o "Tentar de novo agora" rodem no mesmo dia (ver índice único
//     story_posts_account_drive_file_unique).
// Compartilhada entre o cron (/api/cron/ler-stories-drive, roda sozinho a
// cada 30 min — ver comentário na rota pro porquê de não ser 1x/dia) e o
// botão "Tentar de novo agora"
// (/api/accounts/[id]/story-drive-config/tentar-de-novo).
export type ResultadoStoryDrive = "sem_config" | "sem_pasta" | "ja_existe" | "stories_criados" | "erro";

// Teto de segurança pra uma pasta do dia não gerar uma avalanche de Stories
// de uma vez só (ex: alguém arrastou o mês inteiro pra pasta errada) —
// bem acima do uso real (raramente passa de 5 arquivos por dia).
const LIMITE_ARQUIVOS_POR_DIA = 15;

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

// Procura um trecho "_HHMM_" no nome do arquivo (o Google Apps Script grava
// isso a partir do horário que veio no assunto do e-mail, ex:
// "UNICO_STORY_1530_17-09-2026_01.jpg" -> "15:30:00"). Sem esse trecho (e-mail
// sem horário, ou arquivo solto na pasta sem seguir o padrão), devolve null —
// quem chama trata isso criando o Story com status "error" pra Victor
// completar o horário manualmente.
function extrairHorarioDoNomeDoArquivo(nomeArquivo: string): string | null {
  const match = nomeArquivo.match(/_([01]\d|2[0-3])([0-5]\d)_\d{2}-\d{2}-\d{4}_/);
  if (!match) return null;
  return `${match[1]}:${match[2]}:00`;
}

export async function executarLeituraStoryDrive(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string
): Promise<{ resultado: ResultadoStoryDrive; detalhe?: string; criados?: number }> {
  const { dataISO } = agoraEmSaoPaulo();

  // Reivindica antes de tocar em qualquer coisa — evita duas execuções
  // concorrentes (pg_net retentando uma chamada que só pareceu ter travado
  // por timeout, mas ainda está processando por trás; ou o cron das 9h e um
  // clique manual em "Tentar de novo" quase ao mesmo tempo). O dia nunca
  // fica "fechado" depois de um sucesso — Victor costuma adicionar arquivo
  // novo na pasta do dia ao longo do dia, então "Tentar de novo agora"
  // precisa continuar funcionando mesmo depois de já ter criado algo hoje.
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

    // Quais arquivos do Drive já viraram Story hoje — pra não duplicar
    // quando "Tentar de novo agora" roda de novo mais tarde no mesmo dia.
    const { data: existentes } = await admin
      .from("story_posts")
      .select("drive_file_id")
      .eq("account_id", accountId)
      .eq("dia", dataISO)
      .eq("source", "drive");

    const idsJaCriados = new Set(
      ((existentes ?? []) as { drive_file_id: string | null }[])
        .map((e) => e.drive_file_id)
        .filter((id): id is string => !!id)
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
    const arquivosMidiaTotal = arquivos.filter(
      (a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/")
    );
    const arquivosMidia = arquivosMidiaTotal.slice(0, LIMITE_ARQUIVOS_POR_DIA);
    const truncado = arquivosMidiaTotal.length > arquivosMidia.length;

    if (arquivosMidia.length === 0) {
      const detalhe = `Pasta do dia "${nomePastaDia}" encontrada, mas sem nenhuma foto/vídeo dentro.`;
      await finalizar("erro", detalhe);
      return { resultado: "erro", detalhe };
    }

    const novos = arquivosMidia.filter((a) => !idsJaCriados.has(a.id));

    if (novos.length === 0) {
      const detalhe = "Todos os arquivos de hoje já tinham virado Story antes — nada novo pra fazer.";
      await finalizar("ja_existe", detalhe);
      return { resultado: "ja_existe", detalhe };
    }

    // Baixa cada mídia do Drive e sobe pro Storage do Supabase — mesmo
    // bucket usado pelos Stories manuais (schedule_slots), já que na
    // prática é o mesmo tipo de conteúdo (um Story avulso).
    const criados: string[] = [];
    for (const arquivo of novos) {
      const buffer = await baixarArquivoDrive(accessToken, arquivo.id);
      const tipo: "IMAGE" | "VIDEO" = arquivo.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE";
      const enviado = await enviarMidiaBuffer(admin, "story-media", "drive", buffer, arquivo.mimeType, arquivo.name);
      const thumbnailDataUrl = arquivo.thumbnailLink
        ? await baixarThumbnailDrive(accessToken, arquivo.thumbnailLink)
        : null;

      const horario = extrairHorarioDoNomeDoArquivo(arquivo.name);
      const scheduledAt = horario ? new Date(`${dataISO}T${horario}-03:00`).toISOString() : null;

      const { data: storyPost, error: erroStoryPost } = await admin
        .from("story_posts")
        .insert({
          account_id: accountId,
          dia: dataISO,
          drive_file_id: arquivo.id,
          scheduled_at: scheduledAt,
          media_url: enviado.url,
          media_path: enviado.path,
          media_type: tipo,
          thumbnail_data_url: thumbnailDataUrl,
          source: "drive",
          status: horario ? "pending" : "error",
          error_message: horario
            ? null
            : "Sem horário reconhecido no nome do arquivo — defina o horário manualmente na lista abaixo.",
        })
        .select("id")
        .single();

      if (erroStoryPost) {
        // Corrida rara com outra execução concorrente pro mesmo arquivo —
        // o índice único (account_id, drive_file_id) barrou a duplicata,
        // não é um erro de verdade, só segue pro próximo arquivo.
        if (erroStoryPost.code === "23505") continue;
        throw new Error(erroStoryPost.message || "Erro ao criar o Story automático.");
      }
      if (!storyPost) throw new Error("Erro ao criar o Story automático.");
      criados.push(storyPost.id);
    }

    if (criados.length === 0) {
      const detalhe = "Todos os arquivos de hoje já tinham virado Story antes — nada novo pra fazer.";
      await finalizar("ja_existe", detalhe);
      return { resultado: "ja_existe", detalhe };
    }

    const detalhe = `${criados.length} Story(s) criado(s) a partir do Drive.${
      truncado ? ` (limite diário de ${LIMITE_ARQUIVOS_POR_DIA} arquivos atingido — o restante foi ignorado.)` : ""
    }`;
    await finalizar("stories_criados", detalhe);
    return { resultado: "stories_criados", criados: criados.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido.";
    await finalizar("erro", msg);
    return { resultado: "erro", detalhe: msg };
  }
}
