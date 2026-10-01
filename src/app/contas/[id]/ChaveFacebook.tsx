"use client";

import { useState } from "react";

// Chavinha de ligar/desligar um cross-post pro Facebook por conta (mesmo
// padrão visual de switch do Story Engine). Serve pros dois: Feed/Reels
// (cross_post_facebook) e Stories (cross_post_facebook_stories). Best-effort:
// uma falha no Facebook nunca afeta a publicação no Instagram.
export default function ChaveFacebook({
  accountId,
  campo,
  titulo,
  descricao,
  valorInicial,
}: {
  accountId: string;
  campo: "cross_post_facebook" | "cross_post_facebook_stories";
  titulo: string;
  descricao: string;
  valorInicial: boolean;
}) {
  const [ativo, setAtivo] = useState(valorInicial);
  const [alternando, setAlternando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alternar() {
    const novoValor = !ativo;
    setAlternando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [campo]: novoValor }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.erro || "Erro ao atualizar.");
      setAtivo(novoValor);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao atualizar.");
    } finally {
      setAlternando(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl2 bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <button
        type="button"
        onClick={alternar}
        disabled={alternando}
        title={ativo ? "Ligado — clique pra desligar" : "Desligado — clique pra ligar"}
        className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-60 ${ativo ? "bg-brand-600" : "bg-slate-300"}`}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
          style={{ left: ativo ? "18px" : "2px" }}
        />
      </button>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{titulo}</p>
        <p className="text-xs text-slate-500">{descricao}</p>
        {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
      </div>
    </div>
  );
}
