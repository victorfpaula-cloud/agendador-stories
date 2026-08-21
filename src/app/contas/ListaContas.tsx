"use client";

import Link from "next/link";
import { useState } from "react";
import type { Account } from "@/types/database";

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

export default function ListaContas({ initialContas }: { initialContas: Account[] }) {
  const [contas, setContas] = useState<Account[]>(initialContas);

  function aoAtualizar(conta: Account) {
    setContas((atual) => atual.map((c) => (c.id === conta.id ? conta : c)));
  }

  function aoRemover(id: string) {
    setContas((atual) => atual.filter((c) => c.id !== id));
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {contas.map((conta) => (
        <ContaCard key={conta.id} conta={conta} onAtualizar={aoAtualizar} onRemover={aoRemover} />
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
  onAtualizar,
  onRemover,
}: {
  conta: Account;
  onAtualizar: (conta: Account) => void;
  onRemover: (id: string) => void;
}) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-600">
            {conta.name.charAt(0).toUpperCase()}
          </div>
          {!conta.is_active && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              pausada
            </span>
          )}
        </div>
        <p className="font-medium text-slate-900 group-hover:text-brand-700">{conta.name}</p>
        <p className="text-sm text-slate-500">
          {conta.ig_username ? `@${conta.ig_username}` : "Instagram conectado"}
        </p>
      </Link>

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
