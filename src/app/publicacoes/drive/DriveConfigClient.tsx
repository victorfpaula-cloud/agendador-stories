"use client";

import { useState } from "react";
import type { DriveConfig } from "@/types/database";

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

type Conta = { id: string; name: string; ig_username: string | null };

export default function DriveConfigClient({
  accounts,
  initialConfig,
}: {
  accounts: Conta[];
  initialConfig: DriveConfig | null;
}) {
  const [pastaDriveId, setPastaDriveId] = useState(initialConfig?.pasta_drive_id ?? "");
  const [horario, setHorario] = useState(
    initialConfig ? paraCampoHorario(initialConfig.horario_publicacao) : "12:00"
  );
  const [accountIds, setAccountIds] = useState<string[]>(initialConfig?.account_ids ?? []);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);

  function alternarConta(id: string) {
    setAccountIds((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function salvar() {
    setErro(null);
    setSalvoEm(null);

    if (!/^\d{2}:\d{2}$/.test(horario)) {
      setErro("Escolha um horário de publicação válido.");
      return;
    }

    setSalvando(true);
    try {
      await chamarApi("/api/drive-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pastaDriveId,
          horarioPublicacao: horario,
          accountIds,
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

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">
            Contas-alvo ({accountIds.length === 0 ? "nenhuma selecionada" : `${accountIds.length} selecionada(s)`})
          </span>
          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-slate-300 p-1.5">
            {accounts.length === 0 && (
              <p className="px-1.5 py-1 text-xs text-slate-400">Nenhuma conta ativa disponível.</p>
            )}
            {accounts.map((conta) => (
              <label
                key={conta.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={accountIds.includes(conta.id)}
                  onChange={() => alternarConta(conta.id)}
                  disabled={salvando}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-slate-700">
                  {conta.name}
                  {conta.ig_username ? ` (@${conta.ig_username})` : ""}
                </span>
              </label>
            ))}
          </div>
          <span className="mt-1 block text-xs text-slate-400">
            Pra quais contas o post automático do dia vai — na prática, só as da Dona Baunilha.
          </span>
        </div>

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

        <p className="border-t border-slate-100 pt-3 text-xs text-slate-400">
          Isso só guarda a configuração. O robô que lê o Drive todo dia sozinho ainda não está
          ligado — chega no próximo passo. Até lá, essa telinha não afeta nada do que já funciona.
        </p>
      </div>
    </div>
  );
}
