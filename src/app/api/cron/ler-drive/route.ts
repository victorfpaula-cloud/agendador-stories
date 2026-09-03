import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import { enviarMidiaBuffer } from "@/lib/storage";
import {
  NOMES_MES,
  baixarArquivoDrive,
  baixarThumbnailDrive,
  encontrarSubpasta,
  extrairIdDaPasta,
  listarArquivosDaPasta,
  obterAccessToken,
} from "@/lib/drive";
import { extrairTextoPdf } from "@/lib/drivePdf";
import type { DriveConfig } from "@/types/database";

// Cron diário do sub-módulo do Drive (passo 7) — roda 1x por dia (ver
// supabase/drive-cron.sql), lê a pasta do dia da Dona Baunilha no Google
// Drive, decide o tipo do post pela quantidade/tipo de arquivo encontrado
// (1 vídeo = Reels, 1 foto = post, 2+ = carrossel — mesma regra automática
// já usada no fluxo manual), extrai a legenda de um PDF (se houver), sobe a
// mídia pro Storage e CRIA o post agendado (com source='drive') — quem
// publica de verdade continua sendo o motor de sempre
// (/api/cron/publicar-feed), sem nenhuma mudança nele. Rota própria,
// isolada: se algo aqui falhar, não afeta o fluxo manual nem o motor de
// publicação — só fica sem post automático naquele dia, e o motivo fica
// registrado em `drive_execucoes` (visível na telinha /publicacoes/drive).
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Máximo permitido no plano Hobby da Vercel — dá folga pra baixar/subir vídeo.

type Resultado = "sem_config" | "sem_pasta" | "ja_existe" | "post_criado" | "erro";

async function registrarExecucao(
  admin: ReturnType<typeof createAdminClient>,
  resultado: Resultado,
  detalhe: string | null,
  feedPostId: string | null
) {
  await admin.from("drive_execucoes").insert({ resultado, detalhe, feed_post_id: feedPostId });
}

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

  try {
    const { data: config } = await admin.from("drive_config").select("*").eq("id", 1).maybeSingle();
    const cfg = config as DriveConfig | null;

    if (!cfg?.pasta_drive_id || !cfg.account_ids || cfg.account_ids.length === 0) {
      await registrarExecucao(admin, "sem_config", "Falta configurar a pasta do Drive e/ou as contas-alvo.", null);
      return NextResponse.json({ resultado: "sem_config" });
    }

    // Data de "hoje" sempre em São Paulo — mesmo helper já usado pelo motor
    // de Stories, pra nunca correr risco de calcular o dia errado.
    const { dataISO } = agoraEmSaoPaulo();
    const [, mesStr, diaStr] = dataISO.split("-");
    const mes = Number(mesStr);

    // Já existe post automático criado hoje? (idempotência — evita
    // duplicar se esse cron rodar mais de uma vez no mesmo dia por algum
    // motivo). Brasil não tem mais horário de verão desde 2019, então
    // São Paulo é sempre UTC-3 — dá pra calcular o início/fim do dia sem
    // depender de biblioteca de fuso horário.
    const inicioDiaUTC = new Date(`${dataISO}T00:00:00-03:00`).toISOString();
    const fimDiaUTC = new Date(`${dataISO}T23:59:59-03:00`).toISOString();
    const { data: jaExiste } = await admin
      .from("feed_posts")
      .select("id")
      .eq("source", "drive")
      .gte("scheduled_at", inicioDiaUTC)
      .lte("scheduled_at", fimDiaUTC)
      .maybeSingle();

    if (jaExiste) {
      await registrarExecucao(admin, "ja_existe", "Já existe um post automático do Drive criado hoje.", jaExiste.id);
      return NextResponse.json({ resultado: "ja_existe" });
    }

    const pastaMaeId = extrairIdDaPasta(cfg.pasta_drive_id);
    const accessToken = await obterAccessToken();

    // Formato confirmado por Victor: pasta do mês "NN - Nome" (ex: "08 -
    // Agosto"), pasta do dia só o número com zero à esquerda (ex: "01").
    const nomePastaMes = `${mesStr} - ${NOMES_MES[mes - 1]}`;
    const pastaMesId = await encontrarSubpasta(accessToken, pastaMaeId, nomePastaMes);

    if (!pastaMesId) {
      await registrarExecucao(admin, "sem_pasta", `Pasta do mês "${nomePastaMes}" não encontrada — dia sem post.`, null);
      return NextResponse.json({ resultado: "sem_pasta" });
    }

    const pastaDiaId = await encontrarSubpasta(accessToken, pastaMesId, diaStr);

    if (!pastaDiaId) {
      // Normal e esperado — dia sem pasta é dia sem post, não é erro.
      await registrarExecucao(admin, "sem_pasta", `Pasta do dia "${diaStr}" não encontrada — dia sem post.`, null);
      return NextResponse.json({ resultado: "sem_pasta" });
    }

    const arquivos = await listarArquivosDaPasta(accessToken, pastaDiaId);
    const arquivosMidia = arquivos.filter((a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/"));
    const arquivosPdf = arquivos.filter((a) => a.mimeType === "application/pdf");

    if (arquivosMidia.length === 0) {
      await registrarExecucao(
        admin,
        "erro",
        `Pasta do dia ${diaStr}/${mesStr} encontrada, mas sem nenhuma foto/vídeo dentro.`,
        null
      );
      return NextResponse.json({ resultado: "erro" });
    }

    // Nunca deve acontecer no uso real do Victor (confirmado: sempre 1
    // arquivo, ocasionalmente 3-4), mas por segurança respeita o teto de
    // 10 da própria Meta em vez de tentar publicar um carrossel inválido.
    const midiasParaUsar = arquivosMidia.slice(0, 10);

    const mediaType: "REELS" | "IMAGE" | "CAROUSEL" =
      midiasParaUsar.length > 1
        ? "CAROUSEL"
        : midiasParaUsar[0].mimeType.startsWith("video/")
        ? "REELS"
        : "IMAGE";

    // Legenda: texto do primeiro PDF encontrado na pasta do dia. Sem PDF =
    // legenda vazia, não é erro (o post sai sem legenda).
    let caption = "";
    if (arquivosPdf.length > 0) {
      try {
        const bufferPdf = await baixarArquivoDrive(accessToken, arquivosPdf[0].id);
        caption = await extrairTextoPdf(bufferPdf);
      } catch (err) {
        // Falha ao ler o PDF não deve impedir o post de sair — melhor
        // publicar sem legenda do que não publicar nada.
        caption = "";
      }
    }

    // Baixa cada mídia do Drive e sobe pro Storage do Supabase, na mesma
    // ordem (vira a ordem do carrossel quando houver mais de uma). Também
    // baixa a miniatura pequena que o próprio Drive já gera pra cada
    // arquivo — sem isso, a tela de Publicações não tinha nenhuma miniatura
    // pra mostrar e caía num modo reserva que carregava o arquivo original
    // inteiro só pra desenhar um preview de 48x48px (o que estourou o
    // Cached Egress do Supabase — ver comentário em PublicacoesClient.tsx).
    const midiasEnviadas: {
      url: string;
      path: string;
      mediaType: "IMAGE" | "VIDEO";
      thumbnailDataUrl: string | null;
    }[] = [];
    for (const arquivo of midiasParaUsar) {
      const buffer = await baixarArquivoDrive(accessToken, arquivo.id);
      const tipo: "IMAGE" | "VIDEO" = arquivo.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE";
      const enviado = await enviarMidiaBuffer(admin, "feed-media", "drive", buffer, arquivo.mimeType, arquivo.name);
      const thumbnailDataUrl = arquivo.thumbnailLink
        ? await baixarThumbnailDrive(accessToken, arquivo.thumbnailLink)
        : null;
      midiasEnviadas.push({ url: enviado.url, path: enviado.path, mediaType: tipo, thumbnailDataUrl });
    }

    const scheduledAt = new Date(`${dataISO}T${cfg.horario_publicacao}-03:00`).toISOString();

    const { data: post, error: erroPost } = await admin
      .from("feed_posts")
      .insert({
        caption,
        scheduled_at: scheduledAt,
        media_type: mediaType,
        share_to_feed: mediaType === "REELS",
        source: "drive",
      })
      .select("*")
      .single();

    if (erroPost || !post) throw new Error(erroPost?.message || "Erro ao criar o post automático.");

    const { error: erroMedia } = await admin.from("feed_post_media").insert(
      midiasEnviadas.map((m, index) => ({
        feed_post_id: post.id,
        position: index,
        media_url: m.url,
        media_path: m.path,
        media_type: m.mediaType,
        thumbnail_data_url: m.thumbnailDataUrl,
      }))
    );

    if (erroMedia) {
      await admin.from("feed_posts").delete().eq("id", post.id);
      throw new Error(erroMedia.message);
    }

    // Confere quais contas-alvo configuradas ainda existem de verdade
    // (defensivo — a config pode ter sido salva há um tempo e alguma conta
    // pode ter sido removida desde então).
    const { data: contasEncontradas } = await admin.from("accounts").select("id").in("id", cfg.account_ids);
    const accountIdsValidos = (contasEncontradas ?? []).map((c: { id: string }) => c.id);

    if (accountIdsValidos.length === 0) {
      await admin.from("feed_posts").delete().eq("id", post.id);
      await registrarExecucao(admin, "erro", "Nenhuma das contas-alvo configuradas existe mais.", null);
      return NextResponse.json({ resultado: "erro" });
    }

    const { error: erroContas } = await admin
      .from("feed_post_accounts")
      .insert(accountIdsValidos.map((accountId) => ({ feed_post_id: post.id, account_id: accountId })));

    if (erroContas) {
      await admin.from("feed_posts").delete().eq("id", post.id);
      throw new Error(erroContas.message);
    }

    await registrarExecucao(admin, "post_criado", `Post criado a partir do Drive (${mediaType}).`, post.id);
    return NextResponse.json({ resultado: "post_criado", postId: post.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido.";
    await registrarExecucao(admin, "erro", msg, null);
    return NextResponse.json({ resultado: "erro", detalhe: msg });
  }
}
