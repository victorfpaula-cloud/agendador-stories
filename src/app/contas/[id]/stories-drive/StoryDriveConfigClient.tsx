"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoryDriveConfig, StoryDriveExecucao, StoryDriveExecucaoResultado, StoryPost, StoryPostStatus } from "@/types/database";

// Mensagem amigável por resultado — pra Victor entender o que aconteceu na
// última vez que o robô rodou sem precisar interpretar nada técnico.
const EXECUCAO_INFO: Record<StoryDriveExecucaoResultado, { texto: string; cor: string }> = {
  sem_config: { texto: "Configuração incompleta — falta a pasta do Drive.", cor: "text-amber-600" },
  sem_pasta: { texto: "Nenhuma pasta encontrada pra esse dia — sem Story hoje, normal.", cor: "text-slate-500" },
  ja_existe: { texto: "Os arquivos de hoje já tinham virado Story antes — nada duplicado.", cor: "text-slate-500" },
  stories_criados: { texto: "Story(s) criado(s) com sucesso a partir do Drive.", cor: "text-green-600" },
  erro: { texto: "Deu erro ao processar o Drive hoje.", cor: "text-red-600" },
};

const STATUS_INFO: Record<StoryPostStatus, { cor: string; texto: string }> = {
  pending: { cor: "bg-amber-50 text-amber-700", texto: "Agendado" },
  publishing: { cor: "bg-blue-50 text-blue-700", texto: "Publicando…" },
  success: { cor: "bg-green-50 text-green-700", texto: "Publicado" },
  error: { cor: "bg-red-50 text-red-700", texto: "Erro" },
};

function formatarDataHora(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatarHora(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

async function chamarApi(input: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new Error("Sem conexão com o servidor. Verifique sua internet e tente de novo.");
  }

  if (res.status === 401 || res.redirected || res.url.includes("/login")) {
    throw new Error("Sua sessão expirou. Atualize a página e faça login de novo.");
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new Error("O servidor respondeu de um jeito inesperado. Atualize a página e tente de novo.");
  }

  if (!res.ok) {
    throw new Error(json?.erro || "Ocorreu um erro. Tente novamente.");
  }

  return json;
}

export default function StoryDriveConfigClient({
  accountId,
  initialConfig,
  ultimaExecucao,
  initialStoriesHoje,
}: {
  accountId: string;
  initialConfig: StoryDriveConfig | null;
  ultimaExecucao: StoryDriveExecucao | null;
  initialStoriesHoje: StoryPost[];
}) {
  const [pastaDriveId, setPastaDriveId] = useState(initialConfig?.pasta_drive_id ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [tentandoDeNovo, setTentandoDeNovo] = useState(false);
  const [erroTentativa, setErroTentativa] = useState<string | null>(null);
  const [storiesHoje, setStoriesHoje] = useState<StoryPost[]>(initialStoriesHoje);
  const router = useRouter();

  async function salvar() {
    setErro(null);
    setSalvoEm(null);
    setSalvando(true);
    try {
      await chamarApi(`/api/accounts/${accountId}/story-drive-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pastaDriveId }),
      });
      setSalvoEm(
        new Intl.DateTimeFormat("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date())
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao salvar a configuração.");
    } finally {
      setSalvando(false);
    }
  }

  async function tentarDeNovo() {
    setErroTentativa(null);
    setTentandoDeNovo(true);
    try {
      await chamarApi(`/api/accounts/${accountId}/story-drive-config/tentar-de-novo`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setErroTentativa(err instanceof Error ? err.message : "Erro ao tentar de novo.");
    } finally {
      setTentandoDeNovo(false);
    }
  }

  async function cancelar(id: string) {
    if (!confirm("Cancelar esse Story agendado?")) return;
    try {
      await chamarApi(`/api/story-posts/${id}`, { method: "DELETE" });
      setStoriesHoje((atual) => atual.filter((s) => s.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao cancelar o Story.");
    }
  }

  function aoSalvarHorario(story: StoryPost) {
    setStoriesHoje((atual) => atual.map((s) => (s.id === story.id ? story : s)));
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl2 bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Pasta-mãe do Drive (Stories)</span>
            <input
              type="text"
              value={pastaDriveId}
              onChange={(e) => setPastaDriveId(e.target.value)}
              disabled={salvando}
              placeholder="Cole aqui o link ou o ID da pasta do Google Drive"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            />
            <span className="mt-1 block text-xs text-slate-400">
              A pasta que tem, dentro dela, uma pasta por dia (ex: "17-09-2026") — separada da pasta usada nas
              Publicações. Todos os arquivos de foto/vídeo daquele dia contam. O horário de cada um vem do nome do
              arquivo (que o Google Apps Script grava a partir do assunto do e-mail) — sem horário reconhecido, o
              Story aparece com erro na lista abaixo pra você completar à mão.
            </span>
          </label>

          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {salvando ? "Salvando…" : "Salvar configuração"}
          </button>

          {erro && <p className="text-xs text-red-600">{erro}</p>}
          {salvoEm && !erro && <p className="text-xs text-green-600">Configuração salva ({salvoEm}).</p>}

          <div className="border-t border-slate-100 pt-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="block text-xs font-medium text-slate-500">Última verificação do Drive</span>
              <button
                type="button"
                onClick={tentarDeNovo}
                disabled={tentandoDeNovo}
                className="w-full shrink-0 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:border-brand-300 hover:text-brand-600 disabled:opacity-60 sm:w-auto sm:py-1"
              >
                {tentandoDeNovo ? "Tentando…" : "↻ Tentar de novo agora"}
              </button>
            </div>
            <div className="mt-1">
              {ultimaExecucao ? (
                <p className={`text-xs ${EXECUCAO_INFO[ultimaExecucao.resultado].cor}`}>
                  {formatarDataHora(ultimaExecucao.executado_em)} — {EXECUCAO_INFO[ultimaExecucao.resultado].texto}
                  {ultimaExecucao.resultado === "erro" && ultimaExecucao.detalhe && (
                    <span className="mt-0.5 block text-slate-500">{ultimaExecucao.detalhe}</span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  Ainda não rodou nenhuma vez. O robô confere o Drive automaticamente a cada 30 minutos.
                </p>
              )}
              {erroTentativa && <p className="mt-1 text-xs text-red-600">{erroTentativa}</p>}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Stories de hoje</h2>
        {storiesHoje.length === 0 ? (
          <div className="rounded-xl2 border-2 border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Nenhum Story automático agendado hoje.
          </div>
        ) : (
          <div className="space-y-2">
            {storiesHoje.map((story) => (
              <StoryHojeItem key={story.id} story={story} onCancelar={cancelar} onSalvarHorario={aoSalvarHorario} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// "2026-09-17T18:30:00.000Z" (em America/Sao_Paulo) -> "15:30", pro valor
// inicial do <input type="time">.
function paraCampoHorario(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function StoryHojeItem({
  story,
  onCancelar,
  onSalvarHorario,
}: {
  story: StoryPost;
  onCancelar: (id: string) => void;
  onSalvarHorario: (story: StoryPost) => void;
}) {
  const editavel = story.status === "pending" || story.status === "error";
  const [horario, setHorario] = useState(paraCampoHorario(story.scheduled_at));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvarHorario() {
    setErro(null);
    setSalvando(true);
    try {
      const json = await chamarApi(`/api/story-posts/${story.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horario }),
      });
      onSalvarHorario(json.story as StoryPost);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao salvar o horário.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl2 bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <MiniaturaMidia thumbnailDataUrl={story.thumbnail_data_url} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {editavel ? (
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
                disabled={salvando}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={salvarHorario}
                disabled={salvando || !horario}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:border-brand-300 hover:text-brand-600 disabled:opacity-60"
              >
                {salvando ? "…" : "Salvar"}
              </button>
            </div>
          ) : (
            <span className="text-sm font-medium text-slate-700">
              {story.scheduled_at ? formatarHora(story.scheduled_at) : "—"}
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_INFO[story.status].cor}`}>
            {STATUS_INFO[story.status].texto}
          </span>
        </div>
        {story.status === "error" && story.error_message && (
          <p className="mt-1 text-xs text-red-600">{story.error_message}</p>
        )}
        {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
      </div>
      {editavel && (
        <button
          type="button"
          onClick={() => onCancelar(story.id)}
          className="shrink-0 text-xs font-medium text-red-500 hover:text-red-700"
        >
          Cancelar
        </button>
      )}
    </div>
  );
}

// Mesma regra do resto do app: nunca cai pro arquivo original como preview
// (ver comentário completo em PublicacoesClient.tsx).
function MiniaturaMidia({ thumbnailDataUrl }: { thumbnailDataUrl: string | null }) {
  if (thumbnailDataUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbnailDataUrl} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />;
  }
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="M21 15l-5.5-5.5a1.5 1.5 0 0 0-2.1 0L3 20" />
      </svg>
    </div>
  );
}
