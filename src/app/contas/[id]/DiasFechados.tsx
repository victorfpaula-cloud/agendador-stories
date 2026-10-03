"use client";

import { useEffect, useState } from "react";

type Dia = { dia: string; motivo: string | null };

function formatar(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const semana = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" }).format(d).replace(".", "");
  const dm = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" }).format(d);
  return `${dm} (${semana})`;
}

// Dias em que a conta fica FECHADA: nesses dias não publica nada — nem
// Stories (semanal, Story Engine, AutoStory) nem Feed. No dia seguinte volta
// ao normal sozinha. Aparece embaixo das abas, em todas as telas da conta.
export default function DiasFechados({ accountId }: { accountId: string }) {
  const api = `/api/accounts/${accountId}/dias-fechados`;
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [hoje, setHoje] = useState("");
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      const j = await (await fetch(api)).json();
      setDias(j.dias ?? []);
      setHoje(j.hoje ?? "");
    } catch {
      setDias([]);
    }
  }
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function marcar() {
    if (!novo) {
      setErro("Escolha o dia.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dia: novo, motivo }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.erro || "Erro ao marcar o dia.");
      setNovo("");
      setMotivo("");
      setAberto(false);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao marcar o dia.");
    } finally {
      setSalvando(false);
    }
  }

  async function reabrir(dia: string) {
    setDias((l) => (l ?? []).filter((d) => d.dia !== dia));
    await fetch(`${api}?dia=${dia}`, { method: "DELETE" }).catch(() => null);
  }

  const fechadoHoje = (dias ?? []).some((d) => d.dia === hoje);

  return (
    <div className="mb-6 rounded-xl2 bg-white px-4 py-3 text-sm shadow-card ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-700">🔒 Dias fechados</span>
        {fechadoHoje && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">fechado hoje — nada publica</span>}
        {(dias ?? []).map((d) => (
          <span key={d.dia} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
            {formatar(d.dia)}
            {d.motivo ? ` · ${d.motivo}` : ""}
            <button onClick={() => reabrir(d.dia)} className="ml-0.5 text-slate-400 hover:text-red-600" aria-label="Reabrir esse dia" title="Reabrir esse dia">
              ✕
            </button>
          </span>
        ))}
        {dias !== null && dias.length === 0 && <span className="text-xs text-slate-400">nenhum marcado</span>}
        <button onClick={() => setAberto((v) => !v)} className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">
          {aberto ? "Fechar" : "+ Marcar dia fechado"}
        </button>
      </div>

      {aberto && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">
            Nesse dia a conta <strong>não publica nada</strong>: nem Stories (semanal, Story Engine, AutoStory) nem Feed. No dia seguinte volta ao normal.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              min={hoje || undefined}
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              type="text"
              value={motivo}
              maxLength={120}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (opcional) — ex: feriado"
              className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button onClick={marcar} disabled={salvando} className="rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
              {salvando ? "Salvando…" : "Marcar"}
            </button>
          </div>
          {erro && <p className="text-xs text-red-600">{erro}</p>}
        </div>
      )}
    </div>
  );
}
