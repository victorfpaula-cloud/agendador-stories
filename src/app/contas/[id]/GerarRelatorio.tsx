"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Botão + janelinha "Gerar relatório" (pedido do Victor em 30/09/2026): pergunta
// o mês e se inclui Feed/Reels ou só Stories, e abre o mesmo relatório que
// chega por e-mail no último dia do mês (ver /contas/[id]/relatorio).
function ultimosMeses(qtd: number): { valor: string; rotulo: string }[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" });
  const [ano, mes] = fmt.format(new Date()).split("-").map(Number);
  const nomeMes = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });
  const lista: { valor: string; rotulo: string }[] = [];
  for (let i = 0; i < qtd; i++) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    const valor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    lista.push({ valor, rotulo: `${nomeMes.format(d)} de ${d.getUTCFullYear()}${i === 0 ? " (mês atual)" : ""}` });
  }
  return lista;
}

export default function GerarRelatorio({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const meses = ultimosMeses(6);
  const [mes, setMes] = useState(meses[0].valor);
  const [incluirFeed, setIncluirFeed] = useState(true);

  function gerar() {
    router.push(`/contas/${accountId}/relatorio?mes=${mes}&feed=${incluirFeed ? 1 : 0}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-brand-400 hover:text-brand-600"
      >
        Gerar relatório
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={() => setAberto(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Gerar relatório"
            className="w-full max-w-sm rounded-xl2 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900">Gerar relatório</h2>
            <p className="mt-1 text-sm text-slate-500">Quantas publicações foram ao ar, dia a dia.</p>

            <label htmlFor="relatorio-mes" className="mt-4 block text-sm font-medium text-slate-700">
              Mês
            </label>
            <select
              id="relatorio-mes"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
            >
              {meses.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.rotulo}
                </option>
              ))}
            </select>

            <fieldset className="mt-4 space-y-2">
              <legend className="text-sm font-medium text-slate-700">O que incluir</legend>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                <input type="radio" name="incluir" checked={incluirFeed} onChange={() => setIncluirFeed(true)} className="mt-0.5" />
                <span>
                  <span className="font-medium text-slate-900">Stories + Feed e Reels</span>
                  <span className="block text-xs text-slate-500">A tabela de Feed/Reels só aparece se houver publicações.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                <input type="radio" name="incluir" checked={!incluirFeed} onChange={() => setIncluirFeed(false)} className="mt-0.5" />
                <span>
                  <span className="font-medium text-slate-900">Somente Stories</span>
                  <span className="block text-xs text-slate-500">Agendador, Story Engine e AutoStory.</span>
                </span>
              </label>
            </fieldset>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={gerar}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Gerar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
