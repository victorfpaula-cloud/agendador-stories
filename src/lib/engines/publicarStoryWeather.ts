import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import { publicarStory, MetaApiError } from "@/lib/meta";
import { crossPostStoryFacebook } from "@/lib/crossPostStoryFacebook";
import { enviarEmail } from "@/lib/email";
import { carregarDiasFechados, chaveDiaFechado } from "@/lib/diasFechados";
import { indicaCalor, indicaChuva, indicaFrio, lerPrevisao, type Leitura } from "@/lib/weather";
import type { Account } from "@/types/database";

// Story Weather: publica um Story pronto quando o tempo combina.
//  - Chuva: só depois de DUAS leituras seguidas (≥10 min entre elas) indicando
//    chuva; no máximo N por dia e com ≥3h entre um e outro.
//  - Calor: uma vez por dia, quando a máxima prevista pra hoje bate o valor
//    configurado.
//  - Só UM tipo por dia: se chuva, calor ou frio já saiu hoje, os outros não saem.
//  - Frio: uma vez por dia, quando a temperatura de agora está no valor
//    configurado ou abaixo, confirmada em duas leituras seguidas.
// Só age dentro da janela de horário da conta, respeita conta pausada e dia
// fechado, e nunca apaga arquivo nenhum. Falha de previsão = não publica.
type Admin = ReturnType<typeof createAdminClient>;

type Config = {
  account_id: string;
  ativo: boolean;
  cidade: string | null;
  latitude: number | null;
  longitude: number | null;
  chuva_ativa: boolean;
  calor_ativo: boolean;
  calor_graus: number;
  janela_inicio: string;
  janela_fim: string;
  max_chuva_por_dia: number;
  frio_ativo: boolean;
  frio_graus: number;
  frio_confirmacoes: number;
  chuva_confirmacoes: number;
  ultima_checagem: string | null;
  accounts: Account;
};

type Item = { id: string; media_url: string; media_type: "IMAGE" | "VIDEO" };

const INTERVALO_CHECAGEM_MS = 10 * 60 * 1000;
const INTERVALO_ENTRE_CHUVAS_MS = 3 * 60 * 60 * 1000;
const MAX_ERROS_POR_DIA = 3;

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

async function arquivoExiste(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8_000) });
    return !(res.status >= 400 && res.status < 500);
  } catch {
    return true;
  }
}

// Arte que está há mais tempo sem uso (com arquivo existente).
async function escolherItem(admin: Admin, accountId: string, tipo: "chuva" | "calor" | "frio"): Promise<Item | null> {
  const { data } = await admin
    .from("story_weather_itens")
    .select("id, media_url, media_type")
    .eq("account_id", accountId)
    .eq("tipo", tipo)
    .order("usado_em", { ascending: true, nullsFirst: true })
    .limit(10);
  for (const item of (data ?? []) as Item[]) {
    if (await arquivoExiste(item.media_url)) return item;
  }
  return null;
}

// Regra do Victor: o Story Weather só sai se a conta JÁ publicou alguma coisa
// hoje em qualquer setor (Stories semanais, Story Engine, AutoStory, Agendamento
// Único, Feed/Reels). Sem nenhuma publicação no dia = provavelmente fechado.
// O próprio Story Weather não conta. Na dúvida (erro de leitura), não publica.
export async function contaPublicouHoje(admin: Admin, accountId: string, dia: string): Promise<boolean> {
  const inicio = new Date(`${dia}T00:00:00-03:00`).toISOString();
  const fim = new Date(`${dia}T23:59:59-03:00`).toISOString();
  const consultas = [
    admin.from("publicacoes_historico").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("dia", dia),
    admin.from("publish_log").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("scheduled_for", dia).eq("status", "success"),
    admin.from("story_ciclo_posts").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", "success").gte("published_at", inicio).lte("published_at", fim),
    admin.from("story_posts").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", "success").gte("published_at", inicio).lte("published_at", fim),
    admin.from("story_unico_posts").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", "success").gte("published_at", inicio).lte("published_at", fim),
    admin.from("feed_post_accounts").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", "success").gte("published_at", inicio).lte("published_at", fim),
  ];
  try {
    const resultados = await Promise.all(consultas);
    if (resultados.some((r) => r.error)) return false;
    return resultados.some((r) => (r.count ?? 0) > 0);
  } catch {
    return false;
  }
}

export async function executarStoryWeather(admin: Admin) {
  const { dataISO, horaMinuto } = agoraEmSaoPaulo();
  const agoraMin = minutos(horaMinuto);

  const { data: configs, error } = await admin
    .from("story_weather_config")
    .select("*, accounts(*)")
    .eq("ativo", true)
    .not("latitude", "is", null)
    .not("longitude", "is", null);
  if (error) return { erro: error.message };

  const lista = ((configs ?? []) as Config[]).filter((c) => c.accounts?.is_active);
  const fechados = await carregarDiasFechados(admin, [dataISO]);
  const resultados: Record<string, string> = {};

  for (const cfg of lista) {
    const conta = cfg.accounts;
    const chave = conta.name;
    try {
      if (agoraMin < minutos(cfg.janela_inicio) || agoraMin > minutos(cfg.janela_fim)) {
        resultados[chave] = "fora_da_janela";
        if (cfg.chuva_confirmacoes !== 0 || cfg.frio_confirmacoes !== 0) await admin.from("story_weather_config").update({ chuva_confirmacoes: 0, frio_confirmacoes: 0 }).eq("account_id", cfg.account_id);
        continue;
      }
      if (fechados.has(chaveDiaFechado(conta.id, dataISO))) {
        resultados[chave] = "dia_fechado";
        continue;
      }
      if (cfg.ultima_checagem && Date.now() - new Date(cfg.ultima_checagem).getTime() < INTERVALO_CHECAGEM_MS) {
        resultados[chave] = "checou_ha_pouco";
        continue;
      }

      let leitura: Leitura;
      try {
        leitura = await lerPrevisao(Number(cfg.latitude), Number(cfg.longitude));
      } catch (err) {
        // Sem previsão confiável = não publica nada e zera a confirmação.
        const msg = err instanceof Error ? err.message : "Erro ao ler a previsão.";
        await admin
          .from("story_weather_config")
          .update({ chuva_confirmacoes: 0, frio_confirmacoes: 0, ultima_checagem: new Date().toISOString(), ultima_leitura: { erro: msg } })
          .eq("account_id", cfg.account_id);
        resultados[chave] = "sem_previsao";
        continue;
      }

      const chovendo = cfg.chuva_ativa && indicaChuva(leitura);
      const confirmacoes = chovendo ? cfg.chuva_confirmacoes + 1 : 0;
      const fazFrio = cfg.frio_ativo && indicaFrio(leitura, cfg.frio_graus);
      const confirmacoesFrio = fazFrio ? cfg.frio_confirmacoes + 1 : 0;
      await admin
        .from("story_weather_config")
        .update({ chuva_confirmacoes: confirmacoes, frio_confirmacoes: confirmacoesFrio, ultima_checagem: new Date().toISOString(), ultima_leitura: leitura })
        .eq("account_id", cfg.account_id);

      if (cfg.chuva_ativa && confirmacoes >= 2) {
        resultados[chave] = `chuva:${await tentarPublicar(admin, conta, cfg, "chuva", dataISO, leitura)}`;
      } else if (cfg.calor_ativo && indicaCalor(leitura, cfg.calor_graus)) {
        resultados[chave] = `calor:${await tentarPublicar(admin, conta, cfg, "calor", dataISO, leitura)}`;
      } else if (cfg.frio_ativo && confirmacoesFrio >= 2) {
        resultados[chave] = `frio:${await tentarPublicar(admin, conta, cfg, "frio", dataISO, leitura)}`;
      } else {
        resultados[chave] = chovendo || fazFrio ? "aguardando_confirmacao" : "sem_gatilho";
      }
    } catch (err) {
      resultados[chave] = `erro:${err instanceof Error ? err.message : "desconhecido"}`;
    }
  }

  return { dataISO, resultados };
}

async function tentarPublicar(
  admin: Admin,
  conta: Account,
  cfg: Config,
  tipo: "chuva" | "calor" | "frio",
  dia: string,
  leitura: Leitura
): Promise<string> {
  if (!(await contaPublicouHoje(admin, conta.id, dia))) return "sem_publicacao_hoje";

  const { data: doDia } = await admin
    .from("story_weather_posts")
    .select("tipo, seq, status, created_at")
    .eq("account_id", conta.id)
    .eq("dia", dia);
  const todos = (doDia ?? []) as { tipo: string; seq: number; status: string; created_at: string }[];

  // Regra do Victor: chuva, calor e frio nunca saem no mesmo dia. Se outro
  // tipo já publicou (ou está publicando) hoje, este não sai.
  if (todos.some((r) => r.tipo !== tipo && r.status !== "error")) return "outro_tipo_ja_publicou";

  const registros = todos.filter((r) => r.tipo === tipo);

  const ocupados = registros.filter((r) => r.status !== "error");
  const erros = registros.filter((r) => r.status === "error").length;
  const limite = tipo === "chuva" ? cfg.max_chuva_por_dia : 1;
  if (ocupados.length >= limite) return "limite_do_dia";
  if (erros >= MAX_ERROS_POR_DIA) return "muitos_erros";
  if (tipo === "chuva" && ocupados.some((r) => Date.now() - new Date(r.created_at).getTime() < INTERVALO_ENTRE_CHUVAS_MS)) {
    return "aguardando_intervalo";
  }

  const item = await escolherItem(admin, conta.id, tipo);
  if (!item) return "sem_arte";

  // Trava: só uma execução consegue (conta, tipo, dia, seq).
  const seq = Math.max(0, ...registros.map((r) => r.seq)) + 1;
  const { data: reivindicado, error: erroTrava } = await admin
    .from("story_weather_posts")
    .insert({ account_id: conta.id, tipo, dia, seq, status: "publishing", item_id: item.id, leitura })
    .select("id")
    .single();
  if (erroTrava || !reivindicado) return "ja_reivindicado";

  try {
    const igMediaId = await publicarStory({
      igUserId: conta.ig_user_id,
      pageAccessToken: conta.page_access_token,
      mediaUrl: item.media_url,
      mediaType: item.media_type,
    });
    await admin
      .from("story_weather_posts")
      .update({ status: "success", ig_media_id: igMediaId, published_at: new Date().toISOString() })
      .eq("id", reivindicado.id);
    await admin.from("story_weather_itens").update({ usado_em: new Date().toISOString() }).eq("id", item.id);
    await crossPostStoryFacebook(admin, {
      conta,
      origem: "story_engine",
      refId: reivindicado.id,
      dia,
      mediaUrl: item.media_url,
      mediaType: item.media_type,
    });
    return "publicado";
  } catch (err) {
    const msg = err instanceof MetaApiError || err instanceof Error ? err.message : "Erro desconhecido";
    await admin.from("story_weather_posts").update({ status: "error", error_message: msg }).eq("id", reivindicado.id);
    if (erros + 1 >= MAX_ERROS_POR_DIA) {
      await enviarEmail({
        assunto: `Erro ao publicar Story Weather — ${conta.name}`,
        corpo: `A conta "${conta.name}" falhou ${MAX_ERROS_POR_DIA} vezes hoje ao publicar o Story Weather (${tipo}).\n\nÚltimo erro: ${msg}\n\nO Story Weather não vai tentar mais hoje nessa conta.`,
      });
    }
    return "erro";
  }
}
