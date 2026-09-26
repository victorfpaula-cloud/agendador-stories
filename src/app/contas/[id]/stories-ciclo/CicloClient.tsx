"use client";

import { useState } from "react";
import { DIAS_SEMANA } from "@/lib/days";
import { prepararImagem } from "@/lib/imagemCliente";
import { enviarMidiaDireto } from "@/lib/uploadDireto";
import { gerarThumbnail } from "@/lib/thumbnail";
import type { StoryCicloCategoria, StoryCicloHorario, StoryCicloItem } from "@/types/database";

export type CategoriaComHorarios = StoryCicloCategoria & { story_ciclo_horario: StoryCicloHorario[] };
export type Contagem = { total: number; usadas: number };

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

function formatarHora(horario: string): string {
  return horario.slice(0, 5);
}

export default function CicloClient({
  accountId,
  initialCategorias,
  initialContagens,
}: {
  accountId: string;
  initialCategorias: CategoriaComHorarios[];
  initialContagens: Record<string, Contagem>;
}) {
  const [categorias, setCategorias] = useState<CategoriaComHorarios[]>(initialCategorias);
  const [contagens, setContagens] = useState<Record<string, Contagem>>(initialContagens);
  const [criando, setCriando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [erroNovo, setErroNovo] = useState<string | null>(null);

  async function criarCategoria() {
    const nome = nomeNovo.trim();
    if (!nome) {
      setErroNovo("Dá um nome pra categoria.");
      return;
    }
    setErroNovo(null);
    setSalvandoNovo(true);
    try {
      const json = await chamarApi(`/api/accounts/${accountId}/ciclo-categorias`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      setCategorias((atual) => [...atual, json.categoria as CategoriaComHorarios]);
      setContagens((atual) => ({ ...atual, [json.categoria.id]: { total: 0, usadas: 0 } }));
      setNomeNovo("");
      setCriando(false);
    } catch (err) {
      setErroNovo(err instanceof Error ? err.message : "Erro ao criar categoria.");
    } finally {
      setSalvandoNovo(false);
    }
  }

  function aoAtualizarCategoria(categoria: CategoriaComHorarios) {
    setCategorias((atual) => atual.map((c) => (c.id === categoria.id ? categoria : c)));
  }

  function aoApagarCategoria(id: string) {
    setCategorias((atual) => atual.filter((c) => c.id !== id));
    setContagens((atual) => {
      const { [id]: _removido, ...resto } = atual;
      return resto;
    });
  }

  return (
    <div className="space-y-4">
      {categorias.length === 0 && !criando && (
        <div className="rounded-xl2 border-2 border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Nenhuma categoria ainda. Cria uma pra começar a subir as imagens.
        </div>
      )}

      {categorias.map((categoria) => (
        <CategoriaCard
          key={categoria.id}
          categoria={categoria}
          contagem={contagens[categoria.id] ?? { total: 0, usadas: 0 }}
          onAtualizar={aoAtualizarCategoria}
          onApagar={aoApagarCategoria}
          onContagemMudou={(delta) =>
            setContagens((atual) => {
              const atual2 = atual[categoria.id] ?? { total: 0, usadas: 0 };
              return { ...atual, [categoria.id]: { total: atual2.total + delta.total, usadas: atual2.usadas + delta.usadas } };
            })
          }
        />
      ))}

      {criando ? (
        <div className="rounded-xl2 bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Nome da categoria</span>
            <input
              type="text"
              value={nomeNovo}
              onChange={(e) => setNomeNovo(e.target.value)}
              disabled={salvandoNovo}
              placeholder="Ex: Almoço"
              autoFocus
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </label>
          {erroNovo && <p className="mt-1.5 text-xs text-red-600">{erroNovo}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={criarCategoria}
              disabled={salvandoNovo}
              className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {salvandoNovo ? "Criando…" : "Criar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCriando(false);
                setErroNovo(null);
                setNomeNovo("");
              }}
              disabled={salvandoNovo}
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCriando(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl2 border-2 border-dashed border-slate-300 p-4 text-sm font-medium text-slate-500 transition hover:border-brand-400 hover:text-brand-600"
        >
          <span className="text-lg leading-none">+</span> Nova categoria
        </button>
      )}
    </div>
  );
}

function CategoriaCard({
  categoria,
  contagem,
  onAtualizar,
  onApagar,
  onContagemMudou,
}: {
  categoria: CategoriaComHorarios;
  contagem: Contagem;
  onAtualizar: (categoria: CategoriaComHorarios) => void;
  onApagar: (id: string) => void;
  onContagemMudou: (delta: Contagem) => void;
}) {
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeEdicao, setNomeEdicao] = useState(categoria.nome);
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [salvandoDias, setSalvandoDias] = useState(false);
  const [alternandoAtiva, setAlternandoAtiva] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [apagando, setApagando] = useState(false);

  const [novoHorario, setNovoHorario] = useState("");
  const [adicionandoHorario, setAdicionandoHorario] = useState(false);

  const [galeriaAberta, setGaleriaAberta] = useState(false);
  const [itens, setItens] = useState<StoryCicloItem[] | null>(null);
  const [carregandoGaleria, setCarregandoGaleria] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);

  async function salvarNome() {
    const nome = nomeEdicao.trim();
    if (!nome) {
      setErro("O nome não pode ficar em branco.");
      return;
    }
    setErro(null);
    setSalvandoNome(true);
    try {
      const json = await chamarApi(`/api/ciclo-categorias/${categoria.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      onAtualizar(json.categoria as CategoriaComHorarios);
      setEditandoNome(false);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao salvar o nome.");
    } finally {
      setSalvandoNome(false);
    }
  }

  async function alternarAtiva() {
    setAlternandoAtiva(true);
    setErro(null);
    try {
      const json = await chamarApi(`/api/ciclo-categorias/${categoria.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativa: !categoria.ativa }),
      });
      onAtualizar(json.categoria as CategoriaComHorarios);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao ligar/desligar a categoria.");
    } finally {
      setAlternandoAtiva(false);
    }
  }

  async function alternarDia(dia: number) {
    const atual = categoria.dias_semana;
    const novosDias = atual.includes(dia) ? atual.filter((d) => d !== dia) : [...atual, dia];
    if (novosDias.length === 0) return; // precisa sobrar pelo menos 1 dia marcado

    setSalvandoDias(true);
    setErro(null);
    try {
      const json = await chamarApi(`/api/ciclo-categorias/${categoria.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diasSemana: novosDias }),
      });
      onAtualizar(json.categoria as CategoriaComHorarios);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao salvar os dias da semana.");
    } finally {
      setSalvandoDias(false);
    }
  }

  async function apagarCategoria() {
    if (!confirm(`Apagar a categoria "${categoria.nome}"? Isso apaga também todas as imagens e horários dela, sem volta.`)) return;
    setApagando(true);
    setErro(null);
    try {
      await chamarApi(`/api/ciclo-categorias/${categoria.id}`, { method: "DELETE" });
      onApagar(categoria.id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao apagar a categoria.");
      setApagando(false);
    }
  }

  async function adicionarHorario() {
    if (!novoHorario) return;
    setAdicionandoHorario(true);
    setErro(null);
    try {
      const json = await chamarApi(`/api/ciclo-categorias/${categoria.id}/horarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horario: novoHorario }),
      });
      onAtualizar({ ...categoria, story_ciclo_horario: [...categoria.story_ciclo_horario, json.horario as StoryCicloHorario] });
      setNovoHorario("");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao adicionar o horário.");
    } finally {
      setAdicionandoHorario(false);
    }
  }

  async function alternarHorarioAtivo(horario: StoryCicloHorario) {
    try {
      const json = await chamarApi(`/api/ciclo-horarios/${horario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !horario.is_active }),
      });
      onAtualizar({
        ...categoria,
        story_ciclo_horario: categoria.story_ciclo_horario.map((h) => (h.id === horario.id ? (json.horario as StoryCicloHorario) : h)),
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar o horário.");
    }
  }

  async function apagarHorario(id: string) {
    if (!confirm("Apagar esse horário?")) return;
    try {
      await chamarApi(`/api/ciclo-horarios/${id}`, { method: "DELETE" });
      onAtualizar({ ...categoria, story_ciclo_horario: categoria.story_ciclo_horario.filter((h) => h.id !== id) });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao apagar o horário.");
    }
  }

  async function abrirGaleria() {
    setGaleriaAberta((atual) => !atual);
    if (itens !== null || galeriaAberta) return;
    setCarregandoGaleria(true);
    try {
      const json = await chamarApi(`/api/ciclo-categorias/${categoria.id}/itens`);
      setItens(json.itens as StoryCicloItem[]);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar a galeria.");
    } finally {
      setCarregandoGaleria(false);
    }
  }

  async function enviarArquivos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setEnviando(true);
    setErro(null);
    try {
      const enviados: { url: string; path: string; mediaType: string; thumbnailDataUrl: string | null }[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgresso(`Enviando ${i + 1} de ${files.length}…`);
        const arquivoFinal = await prepararImagem(files[i]);
        const thumbnailDataUrl = await gerarThumbnail(arquivoFinal);
        const resultado = await enviarMidiaDireto(arquivoFinal, { bucket: "story-media", pasta: `ciclo/${categoria.id}` });
        enviados.push({ ...resultado, thumbnailDataUrl });
      }
      const json = await chamarApi(`/api/ciclo-categorias/${categoria.id}/itens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: enviados }),
      });
      const novos = json.itens as StoryCicloItem[];
      setItens((atual) => [...(atual ?? []), ...novos]);
      onContagemMudou({ total: novos.length, usadas: 0 });
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao enviar os arquivos.");
    } finally {
      setEnviando(false);
      setProgresso(null);
    }
  }

  async function apagarItem(item: StoryCicloItem) {
    if (!confirm("Remover essa imagem da categoria?")) return;
    try {
      await chamarApi(`/api/ciclo-itens/${item.id}`, { method: "DELETE" });
      setItens((atual) => (atual ?? []).filter((i) => i.id !== item.id));
      onContagemMudou({ total: -1, usadas: item.usado_em ? -1 : 0 });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao remover a imagem.");
    }
  }

  return (
    <div className={`rounded-xl2 bg-white p-4 shadow-sm ring-1 ring-slate-200 transition ${categoria.ativa ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        {editandoNome ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              type="text"
              value={nomeEdicao}
              onChange={(e) => setNomeEdicao(e.target.value)}
              disabled={salvandoNome}
              autoFocus
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm font-medium"
            />
            <button type="button" onClick={salvarNome} disabled={salvandoNome} className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700">
              Salvar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setNomeEdicao(categoria.nome);
              setEditandoNome(true);
            }}
            className="text-left font-medium text-slate-900 hover:text-brand-600"
          >
            {categoria.nome}
          </button>
        )}
        <div className="flex shrink-0 items-center gap-3">
          <InterruptorAtiva ativa={categoria.ativa} alternando={alternandoAtiva} onClick={alternarAtiva} />
          <button
            type="button"
            onClick={apagarCategoria}
            disabled={apagando}
            className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-60"
          >
            {apagando ? "…" : "Apagar"}
          </button>
        </div>
      </div>

      <p className="mt-1 text-xs text-slate-400">
        {categoria.ativa ? "" : "Pausada — o robô não publica nada dela agora. "}
        {contagem.total === 0
          ? "Nenhuma imagem ainda"
          : `${contagem.total} imagem(ns) · ${contagem.total - contagem.usadas} nunca usada(s)`}
      </p>

      <div className="mt-3">
        <span className="mb-1 block text-xs font-medium text-slate-500">Dias da semana</span>
        <div className="flex flex-wrap gap-1.5">
          {DIAS_SEMANA.map((dia) => {
            const ativo = categoria.dias_semana.includes(dia.value);
            return (
              <button
                key={dia.value}
                type="button"
                onClick={() => alternarDia(dia.value)}
                disabled={salvandoDias}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
                  ativo ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"
                }`}
              >
                {dia.curto}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <span className="mb-1 block text-xs font-medium text-slate-500">Horários</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {categoria.story_ciclo_horario
            .slice()
            .sort((a, b) => a.horario.localeCompare(b.horario))
            .map((horario) => (
              <span
                key={horario.id}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  horario.is_active ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-400 line-through"
                }`}
              >
                <button type="button" onClick={() => alternarHorarioAtivo(horario)} title={horario.is_active ? "Pausar" : "Reativar"}>
                  {formatarHora(horario.horario)}
                </button>
                <button type="button" onClick={() => apagarHorario(horario.id)} className="text-slate-400 hover:text-red-500" title="Apagar">
                  ×
                </button>
              </span>
            ))}
          <input
            type="time"
            value={novoHorario}
            onChange={(e) => setNovoHorario(e.target.value)}
            disabled={adicionandoHorario}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={adicionarHorario}
            disabled={adicionandoHorario || !novoHorario}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:border-brand-300 hover:text-brand-600 disabled:opacity-60"
          >
            + horário
          </button>
        </div>
      </div>

      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}

      <button type="button" onClick={abrirGaleria} className="mt-3 text-xs font-medium text-brand-600 hover:text-brand-700">
        {galeriaAberta ? "Esconder galeria ▲" : "Ver / gerenciar imagens ▼"}
      </button>

      {galeriaAberta && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Adicionar imagens/vídeos</span>
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              disabled={enviando}
              onChange={(e) => enviarArquivos(e.target.files)}
              className="block w-full text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-700"
            />
            {enviando && <p className="mt-1 text-xs text-slate-400">{progresso}</p>}
          </label>

          {carregandoGaleria ? (
            <p className="text-xs text-slate-400">Carregando…</p>
          ) : itens && itens.length > 0 ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {itens.map((item) => (
                <div key={item.id} className="group relative">
                  <MiniaturaMidia thumbnailDataUrl={item.thumbnail_data_url} />
                  {!item.usado_em && (
                    <span className="absolute left-0.5 top-0.5 rounded bg-green-600/90 px-1 text-[9px] font-medium text-white">nova</span>
                  )}
                  <button
                    type="button"
                    onClick={() => apagarItem(item)}
                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                    title="Remover"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Nenhuma imagem ainda.</p>
          )}
        </div>
      )}
    </div>
  );
}

// Chavinha de ligar/desligar a categoria — mesmo padrão visual de um
// switch (bolinha desliza), sem depender de nenhuma lib nova.
function InterruptorAtiva({ ativa, alternando, onClick }: { ativa: boolean; alternando: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={alternando}
      title={ativa ? "Categoria ligada — clique pra pausar" : "Categoria pausada — clique pra religar"}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-60 ${ativa ? "bg-brand-600" : "bg-slate-300"}`}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
        style={{ left: ativa ? "18px" : "2px" }}
      />
    </button>
  );
}

function MiniaturaMidia({ thumbnailDataUrl }: { thumbnailDataUrl: string | null }) {
  if (thumbnailDataUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbnailDataUrl} alt="" className="aspect-square w-full rounded-md object-cover" />;
  }
  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-md bg-slate-100 text-slate-400">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="M21 15l-5.5-5.5a1.5 1.5 0 0 0-2.1 0L3 20" />
      </svg>
    </div>
  );
}
