"use client";

import { useState } from "react";

type ContaSimples = { id: string; name: string };

export default function DuplicarRotina({
  contaAtualId,
  contaAtualNome,
  outrasContas,
}: {
  contaAtualId: string;
  contaAtualNome: string;
  outrasContas: ContaSimples[];
}) {
  const [origemId, setOrigemId] = useState(outrasContas[0]?.id ?? "");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function duplicar() {
    if (!origemId) return;
    const origem = outrasContas.find((c) => c.id === origemId);
    if (!origem) return;

    const confirmado = confirm(
      `Isso vai APAGAR a rotina atual de "${contaAtualNome}" e substituir por uma cópia da rotina de ` +
        `"${origem.name}". As artes/vídeos são copiados de verdade (não ficam compartilhados entre as ` +
        `duas contas). Essa ação não pode ser desfeita. Confirma?`
    );
    if (!confirmado) return;

    setCarregando(true);
    setErro(null);

    try {
      let res: Response;
      try {
        res = await fetch(`/api/accounts/${contaAtualId}/duplicar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origem_id: origemId }),
        });
      } catch {
        throw new Error("Sem conexão com o servidor. Verifique sua internet e tente de novo.");
      }

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        throw new Error("O servidor respondeu de um jeito inesperado. Tente de novo.");
      }

      if (!res.ok) {
        throw new Error(json?.erro || "Erro ao duplicar a rotina.");
      }

      // Recarrega a página inteira (não só os dados) pra garantir que a
      // grade mostrada na tela reflita exatamente a rotina nova, sem
      // depender do estado que o navegador já tinha guardado em memória.
      window.location.reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao duplicar a rotina.");
      setCarregando(false);
    }
  }

  if (outrasContas.length === 0) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select
          value={origemId}
          onChange={(e) => setOrigemId(e.target.value)}
          disabled={carregando}
          className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-700"
        >
          {outrasContas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={duplicar}
          disabled={carregando}
          className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-brand-400 hover:text-brand-600 disabled:opacity-60"
        >
          {carregando ? "Duplicando…" : "Duplicar rotina de…"}
        </button>
      </div>
      {erro && <p className="max-w-xs text-right text-xs text-red-600">{erro}</p>}
    </div>
  );
}
