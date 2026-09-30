"use client";

import { useState } from "react";

export default function EnviarRelatorioPorEmail({
  accountId,
  mes,
  incluirFeed,
}: {
  accountId: string;
  mes: string;
  incluirFeed: boolean;
}) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  async function enviar() {
    setEnviando(true);
    setResultado(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/relatorio/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, incluirFeed }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.erro || "Não consegui enviar o e-mail.");
      setResultado({ ok: true, texto: "Enviado pro seu e-mail." });
    } catch (err) {
      setResultado({ ok: false, texto: err instanceof Error ? err.message : "Erro ao enviar." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {resultado && (
        <span className={`text-xs ${resultado.ok ? "text-green-600" : "text-red-600"}`}>{resultado.texto}</span>
      )}
      <a
        href={`/api/accounts/${accountId}/relatorio/pdf?mes=${mes}&feed=${incluirFeed ? 1 : 0}`}
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Baixar PDF
      </a>
      <button
        type="button"
        onClick={enviar}
        disabled={enviando}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-brand-400 hover:text-brand-600 disabled:opacity-60"
      >
        {enviando ? "Enviando…" : "Enviar por e-mail"}
      </button>
    </div>
  );
}
