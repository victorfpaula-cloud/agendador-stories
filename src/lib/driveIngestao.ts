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

// Lê a pasta do dia no Google Drive e cria o post automático de uma conta —
// lógica compartilhada entre o cron diário (/api/cron/ler-drive, roda
// sozinho às 11h, uma vez por conta configurada) e o botão "Tentar de novo
// agora" da aba Publicações > Drive de cada conta
// (/api/accounts/[id]/drive-config/tentar-de-novo, chamado pelo Victor
// quando o robô falha). Ver histórico completo do porquê em ambas as rotas.
export type ResultadoDrive = "sem_config" | "sem_pasta" | "ja_existe" | "post_criado" | "erro";

async function registrarExecucao(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string,
  resultado: ResultadoDrive,
  detalhe: string | null,
  feedPostId: string | null
) {
  await admin.from("drive_execucoes").insert({ account_id: accountId, resultado, detalhe, feed_post_id: feedPostId });
}

export async function executarLeituraDrive(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string
): Promise<{ resultado: ResultadoDrive; detalhe?: string; postId?: string }> {
  const { dataISO } = agoraEmSaoPaulo();

  // Reivindica o dia (por conta) antes de tocar em qualquer coisa (função no
  // banco, ver migração drive_lock_reivindicacao / drive_config_por_conta).
  // Achado em 13/09/2026: o Supabase (pg_net) desiste de esperar resposta
  // dessa rota em só 5s e, quando isso acontece, manda a MESMA chamada de
  // novo — confirmado, 4 tentativas quase simultâneas pra um único disparo
  // do cron. Sem essa trava, duas execuções concorrentes podiam criar dois
  // posts duplicados a partir do Drive no mesmo dia (mesmo bug que já
  // causou Story duplicado — ver reivindicar_publicacao). Também cobre o
  // botão manual: clicar "tentar de novo" duas vezes seguidas não cria dois
  // posts. A trava é por (conta, dia): a automação de uma conta não bloqueia
  // a de outra no mesmo dia.
  const { data: reivindicacao } = await admin
    .rpc("reivindicar_ingestao_drive", { p_account_id: accountId, p_dia: dataISO })
    .single<{ reivindicado: boolean }>();

  if (!reivindicacao?.reivindicado) {
    return {
      resultado: "ja_existe",
      detalhe: "Outra execução já processou (ou está processando agora) o dia de hoje.",
    };
  }

  // Libera o dia pra tentar de novo em caso de qualquer coisa que não seja
  // "post criado com sucesso" — inclui sem_config/sem_pasta/erro de propósito:
  // se a pasta ainda não existia e o Victor sobe ela depois, ou se corrige a
  // configuração, o botão "tentar de novo" (ou o cron de amanhã) precisa
  // conseguir reivindicar o dia de novo.
  async function finalizar(resultado: ResultadoDrive, detalhe: string | null, feedPostId: string | null) {
    await registrarExecucao(admin, accountId, resultado, detalhe, feedPostId);
    await admin
      .from("drive_lock")
      .update({ status: resultado === "post_criado" ? "sucesso" : "erro" })
      .eq("account_id", accountId)
      .eq("dia", dataISO);
  }

  try {
    const { data: config } = await admin.from("drive_config").select("*").eq("account_id", accountId).maybeSingle();
    const cfg = config as DriveConfig | null;

    if (!cfg?.pasta_drive_id) {
      await finalizar("sem_config", "Falta configurar a pasta do Drive dessa conta.", null);
      return { resultado: "sem_config" };
    }

    const [, mesStr, diaStr] = dataISO.split("-");
    const mes = Number(mesStr);

    // Já existe post automático criado hoje pra essa conta? Rede de
    // segurança além da reivindicação acima (ex: um post foi criado com
    // sucesso mas por algum motivo o drive_lock não ficou marcado como
    // 'sucesso').
    const inicioDiaUTC = new Date(`${dataISO}T00:00:00-03:00`).toISOString();
    const fimDiaUTC = new Date(`${dataISO}T23:59:59-03:00`).toISOString();
    const { data: jaExiste } = await admin
      .from("feed_posts")
      .select("id, feed_post_accounts!inner(account_id)")
      .eq("source", "drive")
      .eq("feed_post_accounts.account_id", accountId)
      .gte("scheduled_at", inicioDiaUTC)
      .lte("scheduled_at", fimDiaUTC)
      .maybeSingle();

    if (jaExiste) {
      await admin.from("drive_lock").update({ status: "sucesso" }).eq("account_id", accountId).eq("dia", dataISO);
      await registrarExecucao(admin, accountId, "ja_existe", "Já existe um post automático do Drive criado hoje.", jaExiste.id);
      return { resultado: "ja_existe", postId: jaExiste.id };
    }

    const pastaMaeId = extrairIdDaPasta(cfg.pasta_drive_id);
    const accessToken = await obterAccessToken();

    // Formato confirmado por Victor: pasta do mês "NN - Nome" (ex: "08 -
    // Agosto"), pasta do dia só o número com zero à esquerda (ex: "01").
    const nomePastaMes = `${mesStr} - ${NOMES_MES[mes - 1]}`;
    const pastaMesId = await encontrarSubpasta(accessToken, pastaMaeId, nomePastaMes);

    if (!pastaMesId) {
      await finalizar("sem_pasta", `Pasta do mês "${nomePastaMes}" não encontrada — dia sem post.`, null);
      return { resultado: "sem_pasta" };
    }

    const pastaDiaId = await encontrarSubpasta(accessToken, pastaMesId, diaStr);

    if (!pastaDiaId) {
      // Normal e esperado — dia sem pasta é dia sem post, não é erro.
      await finalizar("sem_pasta", `Pasta do dia "${diaStr}" não encontrada — dia sem post.`, null);
      return { resultado: "sem_pasta" };
    }

    const arquivos = await listarArquivosDaPasta(accessToken, pastaDiaId);
    const arquivosMidia = arquivos.filter((a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/"));
    const arquivosPdf = arquivos.filter((a) => a.mimeType === "application/pdf");

    if (arquivosMidia.length === 0) {
      const detalhe = `Pasta do dia ${diaStr}/${mesStr} encontrada, mas sem nenhuma foto/vídeo dentro.`;
      await finalizar("erro", detalhe, null);
      return { resultado: "erro", detalhe };
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
      } catch {
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

    // Confere se a conta configurada ainda existe de verdade (defensivo — a
    // config pode ter sido salva há um tempo e a conta pode ter sido
    // removida desde então).
    const { data: contaEncontrada } = await admin.from("accounts").select("id").eq("id", accountId).maybeSingle();

    if (!contaEncontrada) {
      await admin.from("feed_posts").delete().eq("id", post.id);
      const detalhe = "A conta configurada pro Drive não existe mais.";
      await finalizar("erro", detalhe, null);
      return { resultado: "erro", detalhe };
    }

    const { error: erroContas } = await admin
      .from("feed_post_accounts")
      .insert({ feed_post_id: post.id, account_id: accountId });

    if (erroContas) {
      await admin.from("feed_posts").delete().eq("id", post.id);
      throw new Error(erroContas.message);
    }

    await finalizar("post_criado", `Post criado a partir do Drive (${mediaType}).`, post.id);
    return { resultado: "post_criado", postId: post.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido.";
    await finalizar("erro", msg, null);
    return { resultado: "erro", detalhe: msg };
  }
}
