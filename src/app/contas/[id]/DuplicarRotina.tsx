"use client";

import { useState } from "react";

type ContaSimples = { id: string; name: string };

type SlotOrigem = {
  id: string;
  day_of_week: number;
  time_of_day: string;
  media_path: string;
  media_type: "IMAGE" | "VIDEO";
  is_active: boolean;
};

type ItemPronto = {
  day_of_week: number;
  time_of_day: string;
  media_url: string;
  media_path: string;
  media_type: string;
  is_active: boolean;
};

// 1 tentativa inicial + 2 novas tentativas, com uma pequena espera entre
// elas — cobre engasgos passageiros (tipo "Bad Gateway") sem precisar você
// clicar de novo manualmente.
const TENTATIVAS_POR_ITEM = 3;
const ESPERA_ENTRE_TENTATIVAS_MS = 1500;

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null);
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
    setProgresso(null);

    try {
      // Etapa 1: pega a lista de horários da conta de origem (sem copiar
      // nenhum arquivo ainda), só pra saber quantos itens existem.
      const resOrigem = await fetch(`/api/accounts/${contaAtualId}/duplicar/origem?origem_id=${origemId}`);
      const jsonOrigem = await resOrigem.json().catch(() => null);
      if (!resOrigem.ok) {
        throw new Error(jsonOrigem?.erro || "Erro ao buscar a rotina de origem.");
      }
      const slots = jsonOrigem.slots as SlotOrigem[];
      setProgresso({ atual: 0, total: slots.length });

      // Etapa 2: copia os arquivos um de cada vez — devagar e com
      // confirmação a cada passo, tentando de novo sozinho se algum der
      // erro passageiro. Nada da rotina atual é tocado nessa etapa.
      const itensProntos: ItemPronto[] = [];

      for (const slot of slots) {
        let ultimoErro: string | null = null;
        let copiado = false;

        for (let tentativa = 1; tentativa <= TENTATIVAS_POR_ITEM && !copiado; tentativa++) {
          try {
            const res = await fetch(`/api/accounts/${contaAtualId}/duplicar/item`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mediaPath: slot.media_path }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
              throw new Error(json?.erro || "Erro ao copiar o arquivo.");
            }
            itensProntos.push({
              day_of_week: slot.day_of_week,
              time_of_day: slot.time_of_day,
              media_url: json.url,
              media_path: json.path,
              media_type: slot.media_type,
              is_active: slot.is_active,
            });
            copiado = true;
          } catch (err) {
            ultimoErro = err instanceof Error ? err.message : "Erro ao copiar o arquivo.";
            if (tentativa < TENTATIVAS_POR_ITEM) {
              await esperar(ESPERA_ENTRE_TENTATIVAS_MS);
            }
          }
        }

        if (!copiado) {
          const horario = slot.time_of_day.slice(0, 5);
          const tipo = slot.media_type === "VIDEO" ? "vídeo" : "foto";
          throw new Error(
            `Não foi possível copiar o horário das ${horario} (${tipo}) depois de ${TENTATIVAS_POR_ITEM} ` +
              `tentativas: ${ultimoErro}. Nada foi alterado ainda — pode tentar de novo.`
          );
        }

        setProgresso((atual) => (atual ? { ...atual, atual: atual.atual + 1 } : atual));
      }

      // Etapa 3: só agora, com tudo copiado, substitui a rotina de verdade.
      const resFinal = await fetch(`/api/accounts/${contaAtualId}/duplicar/finalizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: itensProntos }),
      });
      const jsonFinal = await resFinal.json().catch(() => null);
      if (!resFinal.ok) {
        throw new Error(jsonFinal?.erro || "Erro ao salvar a rotina duplicada.");
      }

      // Recarrega a página inteira pra garantir que a grade mostrada
      // reflita exatamente a rotina nova.
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

      {carregando && progresso && (
        <div className="w-56">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-brand-500 transition-all"
              style={{
                width: `${progresso.total > 0 ? Math.round((progresso.atual / progresso.total) * 100) : 0}%`,
              }}
            />
          </div>
          <p className="mt-1 text-right text-xs text-slate-500">
            Copiando {progresso.atual} de {progresso.total}…
          </p>
        </div>
      )}

      {erro && <p className="max-w-xs text-right text-xs text-red-600">{erro}</p>}
    </div>
  );
}
