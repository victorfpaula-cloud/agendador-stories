"use client";

import { useState } from "react";
import { DIAS_SEMANA } from "@/lib/days";
import type { ScheduleSlot } from "@/types/database";

const LINHAS_MINIMAS = 5;

export default function WeekEditor({
  accountId,
  initialSlots,
}: {
  accountId: string;
  initialSlots: ScheduleSlot[];
}) {
  const [slots, setSlots] = useState<ScheduleSlot[]>(initialSlots);
  const [linhasExtras, setLinhasExtras] = useState<Record<number, number>>({});

  function adicionarLinha(dia: number) {
    setLinhasExtras((atual) => ({ ...atual, [dia]: (atual[dia] ?? 0) + 1 }));
  }

  function aoSalvarNovo(slot: ScheduleSlot) {
    setSlots((atual) => [...atual, slot]);
  }

  function aoAtualizar(slot: ScheduleSlot) {
    setSlots((atual) => atual.map((s) => (s.id === slot.id ? slot : s)));
  }

  function aoRemover(slotId: string) {
    setSlots((atual) => atual.filter((s) => s.id !== slotId));
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
      {DIAS_SEMANA.map((dia) => {
        const doDia = slots
          .filter((s) => s.day_of_week === dia.value)
          .sort((a, b) => a.time_of_day.localeCompare(b.time_of_day));

        const totalLinhas = Math.max(LINHAS_MINIMAS, doDia.length) + (linhasExtras[dia.value] ?? 0);
        const linhasVaziasQtd = Math.max(0, totalLinhas - doDia.length);

        return (
          <section key={dia.value} className="rounded-xl2 bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 font-semibold text-slate-900">{dia.label}</h2>

            <div className="space-y-2">
              {doDia.map((slot) => (
                <LinhaSalva key={slot.id} slot={slot} onAtualizar={aoAtualizar} onRemover={aoRemover} />
              ))}

              {Array.from({ length: linhasVaziasQtd }).map((_, i) => (
                <LinhaNova
                  key={`${dia.value}-nova-${i}`}
                  accountId={accountId}
                  diaSemana={dia.value}
                  onSalvo={aoSalvarNovo}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => adicionarLinha(dia.value)}
              className="mt-3 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              + Adicionar horário
            </button>
          </section>
        );
      })}
    </div>
  );
}

function LinhaSalva({
  slot,
  onAtualizar,
  onRemover,
}: {
  slot: ScheduleSlot;
  onAtualizar: (slot: ScheduleSlot) => void;
  onRemover: (id: string) => void;
}) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function trocarHorario(novoHorario: string) {
    setCarregando(true);
    setErro(null);
    const fd = new FormData();
    fd.set("time_of_day", novoHorario);
    const res = await fetch(`/api/slots/${slot.id}`, { method: "PATCH", body: fd });
    const json = await res.json();
    setCarregando(false);
    if (!res.ok) {
      setErro(json.erro || "Erro ao salvar horário.");
      return;
    }
    onAtualizar(json.slot);
  }

  async function trocarMidia(file: File) {
    setCarregando(true);
    setErro(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch(`/api/slots/${slot.id}`, { method: "PATCH", body: fd });
    const json = await res.json();
    setCarregando(false);
    if (!res.ok) {
      setErro(json.erro || "Erro ao trocar mídia.");
      return;
    }
    onAtualizar(json.slot);
  }

  async function remover() {
    if (!confirm("Remover este horário da rotina?")) return;
    setCarregando(true);
    const res = await fetch(`/api/slots/${slot.id}`, { method: "DELETE" });
    setCarregando(false);
    if (res.ok) onRemover(slot.id);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="flex items-center gap-2">
        <MiniaturaMidia url={slot.media_url} tipo={slot.media_type} />

        <input
          type="time"
          defaultValue={slot.time_of_day.slice(0, 5)}
          onChange={(e) => trocarHorario(e.target.value)}
          disabled={carregando}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />

        <label className="cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700">
          Trocar mídia
          <input
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && trocarMidia(e.target.files[0])}
          />
        </label>

        <button
          type="button"
          onClick={remover}
          disabled={carregando}
          className="ml-auto text-xs text-red-500 hover:text-red-700"
        >
          Remover
        </button>
      </div>
      {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
    </div>
  );
}

function LinhaNova({
  accountId,
  diaSemana,
  onSalvo,
}: {
  accountId: string;
  diaSemana: number;
  onSalvo: (slot: ScheduleSlot) => void;
}) {
  const [horario, setHorario] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!horario || !file) {
      setErro("Escolha o horário e a mídia antes de salvar.");
      return;
    }
    setCarregando(true);
    setErro(null);

    const fd = new FormData();
    fd.set("day_of_week", String(diaSemana));
    fd.set("time_of_day", horario);
    fd.set("file", file);

    const res = await fetch(`/api/accounts/${accountId}/slots`, { method: "POST", body: fd });
    const json = await res.json();
    setCarregando(false);

    if (!res.ok) {
      setErro(json.erro || "Erro ao salvar.");
      return;
    }

    onSalvo(json.slot);
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-2.5">
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={horario}
          onChange={(e) => setHorario(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700"
        />

        <label className="flex-1 cursor-pointer truncate text-xs text-slate-500 hover:text-slate-700">
          {file ? file.name : "Escolher imagem/vídeo…"}
          <input
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <button
          type="button"
          onClick={salvar}
          disabled={carregando}
          className="rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {carregando ? "Salvando…" : "Salvar"}
        </button>
      </div>
      {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
    </div>
  );
}

function MiniaturaMidia({ url, tipo }: { url: string; tipo: string }) {
  if (tipo === "VIDEO") {
    return <video src={url} className="h-9 w-9 rounded-md object-cover" muted />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-9 w-9 rounded-md object-cover" />;
}
