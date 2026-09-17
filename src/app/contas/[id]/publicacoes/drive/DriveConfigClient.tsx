"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DriveConfig, DriveExecucao, DriveExecucaoResultado } from "@/types/database";

// Mensagem amigável por resultado — pra Victor entender o que aconteceu na
// última vez que o robô rodou sem precisar interpretar nada técnico.
// 'sem_pasta' e 'ja_existe' não são erro (dia sem post, ou post do dia já
// tinha sido criado antes) — só 'erro' de fato é destacado em vermelho.
const EXECUCAO_INFO: Record<DriveExecucaoResultado, { texto: string; cor: string }> = {
  sem_config: { texto: "Configuração incompleta — falta a pasta do Drive.", cor: "text-amber-600" },
  sem_pasta: { texto: "Nenhuma pasta encontrada pra esse dia — sem post hoje, normal.", cor: "text-slate-500" },
  ja_existe: { texto: "O post de hoje já tinha sido criado antes — nada duplicado.", cor: "text-slate-500" },
  post_criado: { texto: "Post criado com sucesso a partir do Drive.", cor: "text-green-600" },
  erro: { texto: "Deu erro ao processar o Drive hoje.", cor: "text-red-600" },
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

// Mesmo padrão de tratamento de erro usado no resto do app.
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

// "HH:MM:SS" (formato do banco) -> "HH:MM" (formato do <input type="time">).
function paraCampoHorario(horario: string): string {
  return horario.slice(0, 5);
}

export default function DriveConfigClient({
  accountId,
  initialConfig,
  ultimaExecucao,
}: {
  accountId: string;
  initialConfig: DriveConfig | null;
  ultimaExecucao: DriveExecucao | null;
}) {
  const [pastaDriveId, setPastaDriveId] = useState(initialConfig?.pasta_drive_id ?? "");
  const [horario, setHorario] = useState(
    initialConfig ? paraCampoHorario(initialConfig.horario_publicacao) : "12:00"
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [tentandoDeNovo, setTentandoDeNovo] = useState(false);
  const [erroTentativa, setErroTentativa] = useState<string | null>(null);
  const router = useRouter();

  async function salvar() {
    setErro(null);
    setSalvoEm(null);

    if (!/^\d{2}:\d{2}$/.test(horario)) {
      setErro("Escolha um horário de publicação válido.");
      return;
    }

    setSalvando(true);
    try {
      await chamarApi(`/api/accounts/${accountId}/drive-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pastaDriveId,
          horarioPublicacao: horario,
        }),
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
      await chamarApi(`/api/accounts/${accountId}/drive-config/tentar-de-novo`, { method: "POST" });
      // A resposta já vem com o resultado, mas o mais simples e confiável é
      // atualizar a página inteira: ela já sabe buscar e mostrar a última
      // execução (e o post novo, se um tiver sido criado) direto do banco.
      router.refresh();
    } catch (err) {
      setErroTentativa(err instanceof Error ? err.message : "Erro ao tentar de novo.");
    } finally {
      setTentandoDeNovo(false);
    }
  }

  return (
    <div className="rounded-xl2 bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Pasta-mãe do Drive</span>
          <input
            type="text"
            value={pastaDriveId}
            onChange={(e) => setPastaDriveId(e.target.value)}
            disabled={salvando}
            placeholder="Cole aqui o link ou o ID da pasta do Google Drive"
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-400">
            A pasta que tem, dentro dela, as pastas de cada mês (ex: "08 - Agosto") e, dentro de
            cada mês, as pastas de cada dia (ex: "01", "02"...).
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Horário de publicação</span>
          <input
            type="time"
            value={horario}
            onChange={(e) => setHorario(e.target.value)}
            disabled={salvando}
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm sm:w-1/2"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Horário em que o post do dia (achado no Drive) é publicado.
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
                Ainda não rodou nenhuma vez. O robô confere o Drive automaticamente todo dia às 11h.
              </p>
            )}
            {erroTentativa && <p className="mt-1 text-xs text-red-600">{erroTentativa}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
