"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { nomeDia } from "@/lib/days";
import type { Account } from "@/types/database";

export type ResumoDoDia = { total: number; postados: number; erros: number };

// Intervalo do "recheck" automático do resumo do dia. Não é tempo real de
// verdade (o servidor não avisa o navegador na hora que publica) — é um
// polling simples: a cada 45s, se a aba estiver visível, busca os números
// atualizados. É pouquíssimo processamento (uma consulta leve) e cobre bem
// o caso de uso: deixar a tela de contas aberta e ver os números subindo
// sozinhos ao longo do dia, sem precisar dar refresh manual.
const INTERVALO_RESUMO_MS = 45_000;

// Mesmo padrão de tratamento de erro usado no editor de horários: evita
// travar silenciosamente se a sessão expirou ou o servidor respondeu
// algo inesperado.
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

export default function ListaContas({
  initialContas,
  diaHoje,
  resumoHoje,
}: {
  initialContas: Account[];
  diaHoje: number;
  resumoHoje: Record<string, ResumoDoDia>;
}) {
  const [contas, setContas] = useState<Account[]>(initialContas);
  const [diaAtual, setDiaAtual] = useState(diaHoje);
  const [resumoAtual, setResumoAtual] = useState<Record<string, ResumoDoDia>>(resumoHoje);
  const [avatares, setAvatares] = useState<Record<string, string | null>>({});

  function aoAtualizar(conta: Account) {
    setContas((atual) => atual.map((c) => (c.id === conta.id ? conta : c)));
  }

  function aoRemover(id: string) {
    setContas((atual) => atual.filter((c) => c.id !== id));
  }

  // Recheck automático do resumo do dia, só enquanto a aba está visível
  // (evita gastar chamada à toa com a aba em segundo plano) — e já busca de
  // novo assim que a aba volta a ficar visível, pra não ficar com número
  // atrasado depois de um tempo fora dela.
  useEffect(() => {
    let cancelado = false;

    async function buscarResumo() {
      if (document.visibilityState !== "visible") return;
      try {
        const json = await chamarApi("/api/contas/resumo-do-dia");
        if (cancelado) return;
        setResumoAtual(json.resumo);
        setDiaAtual(json.diaHoje);
      } catch {
        // Falha silenciosa: é só um recheck em segundo plano, tenta de
        // novo no próximo ciclo. Se for sessão expirada de verdade, o
        // usuário vai perceber ao tentar pausar/excluir uma conta.
      }
    }

    const intervalo = setInterval(buscarResumo, INTERVALO_RESUMO_MS);
    document.addEventListener("visibilitychange", buscarResumo);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", buscarResumo);
    };
  }, []);

  // Busca as fotos de perfil só depois que a tela já apareceu (cada uma
  // exige uma chamada à Graph API do Meta, que é lenta demais pra travar o
  // primeiro carregamento — principalmente no celular). Até chegar a
  // resposta, cada card mostra o círculo com a inicial do nome.
  useEffect(() => {
    let cancelado = false;

    chamarApi("/api/contas/avatares")
      .then((json) => {
        if (!cancelado) setAvatares(json.avatares);
      })
      .catch(() => {
        // Sem foto de perfil por enquanto não é um erro que precise avisar
        // o usuário: os cards continuam funcionando com a inicial do nome.
      });

    return () => {
      cancelado = true;
    };
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Link
        href="/publicacoes"
        className="group flex items-center gap-3 rounded-xl2 bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-300 sm:col-span-2"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 group-hover:bg-brand-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <circle cx="8.5" cy="9.5" r="1.5" />
            <path d="M21 15l-5.5-5.5a1.5 1.5 0 0 0-2.1 0L3 20" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900 group-hover:text-brand-700">Publicações</p>
          <p className="text-sm text-slate-500">Feed, Reels e carrossel — agendamento avulso</p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-400">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Link>

      {contas.map((conta) => (
        <ContaCard
          key={conta.id}
          conta={conta}
          avatarUrl={avatares[conta.id] ?? null}
          resumo={resumoAtual[conta.id] ?? { total: 0, postados: 0, erros: 0 }}
          diaHoje={diaAtual}
          onAtualizar={aoAtualizar}
          onRemover={aoRemover}
        />
      ))}

      <a
        href="/api/accounts/connect"
        className="flex flex-col items-center justify-center rounded-xl2 border-2 border-dashed border-slate-300 p-5 text-slate-500 transition hover:border-brand-400 hover:text-brand-600"
      >
        <span className="mb-1 text-2xl leading-none">+</span>
        <span className="text-sm font-medium">Adicionar conta</span>
      </a>
    </div>
  );
}

function ContaCard({
  conta,
  avatarUrl,
  resumo,
  diaHoje,
  onAtualizar,
  onRemover,
}: {
  conta: Account;
  avatarUrl: string | null;
  resumo: ResumoDoDia;
  diaHoje: number;
  onAtualizar: (conta: Account) => void;
  onRemover: (id: string) => void;
}) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [fotoFalhou, setFotoFalhou] = useState(false);

  async function alternarPausa() {
    setCarregando(true);
    setErro(null);
    try {
      const json = await chamarApi(`/api/accounts/${conta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !conta.is_active }),
      });
      onAtualizar(json.conta);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao atualizar a conta.");
    } finally {
      setCarregando(false);
    }
  }

  async function excluir() {
    if (
      !confirm(
        `Excluir a conta "${conta.name}"? Isso remove toda a rotina semanal e as mídias dela, sem volta.`
      )
    ) {
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      await chamarApi(`/api/accounts/${conta.id}`, { method: "DELETE" });
      onRemover(conta.id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao excluir a conta.");
      setCarregando(false);
    }
  }

  return (
    <div
      className={`rounded-xl2 bg-white p-5 shadow-sm ring-1 ring-slate-200 transition ${
        conta.is_active ? "" : "opacity-60"
      }`}
    >
      <Link href={`/contas/${conta.id}`} className="group block">
        <div className="mb-3 flex items-center justify-between">
          {avatarUrl && !fotoFalhou ? (
            <img
              src={avatarUrl}
              alt={conta.name}
              className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
              referrerPolicy="no-referrer"
              onError={() => setFotoFalhou(true)}
            />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-600">
              {conta.name.charAt(0).toUpperCase()}
            </div>
          )}
          {!conta.is_active && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              pausada
            </span>
          )}
        </div>
        <p className="flex items-center gap-1.5 font-medium text-slate-900 group-hover:text-brand-700">
          {conta.is_active && (
            <span
              title="Ativa"
              aria-label="Ativa"
              className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-500"
            />
          )}
          {conta.name}
        </p>
        <p className="text-sm text-slate-500">
          {conta.ig_username ? `@${conta.ig_username}` : "Instagram conectado"}
        </p>
      </Link>

      <ResumoDoDiaPainel resumo={resumo} diaHoje={diaHoje} />

      <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={alternarPausa}
          disabled={carregando}
          className="text-xs font-medium text-slate-500 hover:text-brand-600 disabled:opacity-60"
        >
          {conta.is_active ? "Pausar" : "Retomar"}
        </button>
        <button
          type="button"
          onClick={excluir}
          disabled={carregando}
          className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-60"
        >
          {carregando ? "…" : "Excluir"}
        </button>
      </div>
      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
    </div>
  );
}

// Miniquadro com o resumo de hoje: quantos horários tem no dia, quantos já
// foram publicados e quantos deram erro, com uma barrinha que vai
// enchendo conforme o dia avança. Como sempre calcula em cima do dia atual
// (via agoraEmSaoPaulo no servidor), zera sozinho na virada da meia-noite —
// não precisa de nenhuma lógica extra de "reset".
function ResumoDoDiaPainel({ resumo, diaHoje }: { resumo: ResumoDoDia; diaHoje: number }) {
  const { total, postados, erros } = resumo;

  if (total === 0) {
    return (
      <div className="mt-3 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-400">
        {nomeDia(diaHoje)} · nenhum horário agendado hoje
      </div>
    );
  }

  const pctPostado = Math.min(100, Math.round((postados / total) * 100));
  const pctErro = Math.min(100 - pctPostado, Math.round((erros / total) * 100));

  return (
    <div className="mt-3 rounded-lg bg-slate-50 px-2.5 py-2 text-xs">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-medium text-slate-600">{nomeDia(diaHoje)}</span>
        <span className="text-slate-500">
          {postados} de {total} postados
          {erros > 0 && <span className="text-red-500"> · {erros} com erro</span>}
        </span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-green-500 transition-all" style={{ width: `${pctPostado}%` }} />
        <div className="h-full bg-red-500 transition-all" style={{ width: `${pctErro}%` }} />
      </div>
    </div>
  );
}
