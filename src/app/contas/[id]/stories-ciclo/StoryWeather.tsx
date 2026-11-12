"use client";

import { useEffect, useState } from "react";
import { prepararImagem } from "@/lib/imagemCliente";
import { enviarMidiaDireto } from "@/lib/uploadDireto";
import { gerarThumbnail } from "@/lib/thumbnail";
import { confirmarProporcaoStory } from "@/lib/proporcao";

type Config = {
  ativo: boolean;
  cidade: string | null;
  chuva_ativa: boolean;
  calor_ativo: boolean;
  calor_graus: number;
  janela_inicio: string;
  janela_fim: string;
  max_chuva_por_dia: number;
  ultima_checagem: string | null;
  ultima_leitura: { erro?: string } | null;
};
type Item = { id: string; tipo: "chuva" | "calor"; media_url: string; media_type: string; thumbnail_data_url: string | null; usado_em: string | null };
type Post = { id: string; tipo: string; dia: string; status: string; error_message: string | null; created_at: string };
type Teste = {
  cidade: string;
  leitura: { temperatura_agora: number | null; chuva_mm_proxima_hora: number | null; simbolo_proxima_hora: string | null; temperatura_max_hoje: number | null };
  chuva: { indica: boolean; minimo_mm: number };
  calor: { indica: boolean; graus: number };
};

const PADRAO: Config = {
  ativo: false, cidade: null, chuva_ativa: true, calor_ativo: false, calor_graus: 34,
  janela_inicio: "09:00", janela_fim: "20:00", max_chuva_por_dia: 1, ultima_checagem: null, ultima_leitura: null,
};

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.erro || "Erro inesperado. Tente de novo.");
  return json;
}
const put = (url: string, body: unknown) => api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function Chave({ ligado, onClick, desabilitado }: { ligado: boolean; onClick: () => void; desabilitado?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={desabilitado} className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-60 ${ligado ? "bg-sky-600" : "bg-slate-300"}`}>
      <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: ligado ? "18px" : "2px" }} />
    </button>
  );
}

export default function StoryWeather({ accountId }: { accountId: string }) {
  const base = `/api/accounts/${accountId}/story-weather`;
  const [aberto, setAberto] = useState(false);
  const [config, setConfig] = useState<Config>(PADRAO);
  const [itens, setItens] = useState<Item[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<{ nome: string; latitude: number; longitude: number }[]>([]);
  const [teste, setTeste] = useState<Teste | null>(null);
  const [progresso, setProgresso] = useState<string | null>(null);

  useEffect(() => {
    api(base)
      .then((j) => {
        if (j.config) setConfig(j.config);
        setItens(j.itens);
        setPosts(j.posts);
      })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregado(true));
  }, [base]);

  async function salvar(parcial: Record<string, unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      const j = await put(base, parcial);
      setConfig(j.config);
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function buscarCidade() {
    setErro(null);
    try {
      const j = await api(`/api/geocode?q=${encodeURIComponent(busca)}`);
      setAchados(j.resultados);
      if (j.resultados.length === 0) setErro("Não achei essa cidade. Confira o nome.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro na busca.");
    }
  }

  async function testar() {
    setErro(null);
    setTeste(null);
    setOcupado(true);
    try {
      setTeste(await api(`${base}/teste`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao testar.");
    } finally {
      setOcupado(false);
    }
  }

  async function enviar(tipo: "chuva" | "calor", files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!(await confirmarProporcaoStory(Array.from(files)))) return;
    setOcupado(true);
    setErro(null);
    try {
      const enviados = [];
      for (let i = 0; i < files.length; i++) {
        setProgresso(`Enviando ${i + 1} de ${files.length}…`);
        const arq = await prepararImagem(files[i]);
        const thumbnailDataUrl = await gerarThumbnail(arq);
        const r = await enviarMidiaDireto(arq, { bucket: "story-media", pasta: `weather/${accountId}/${tipo}` });
        enviados.push({ ...r, thumbnailDataUrl });
      }
      const j = await api(`${base}/itens`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo, itens: enviados }) });
      setItens((atual) => [...atual, ...j.itens]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao enviar.");
    } finally {
      setOcupado(false);
      setProgresso(null);
    }
  }

  async function apagar(id: string) {
    if (!window.confirm("Apagar essa arte do Story Weather?")) return;
    try {
      await api(`/api/story-weather-itens/${id}`, { method: "DELETE" });
      setItens((atual) => atual.filter((i) => i.id !== id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao apagar.");
    }
  }

  const galeria = (tipo: "chuva" | "calor", titulo: string) => {
    const lista = itens.filter((i) => i.tipo === tipo);
    return (
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">{titulo} · {lista.length} arte(s)</span>
          <label className={`cursor-pointer rounded-md border border-sky-200 bg-white px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 ${ocupado ? "pointer-events-none opacity-60" : ""}`}>
            + subir arte
            <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { enviar(tipo, e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {lista.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {lista.map((i) => (
              <div key={i.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={i.thumbnail_data_url || i.media_url} alt="" className="h-20 w-12 rounded-md object-cover ring-1 ring-slate-200" />
                <button type="button" onClick={() => apagar(i.id)} className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-white text-xs text-slate-500 shadow ring-1 ring-slate-200 hover:text-red-500" title="Apagar">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const podeLigar = !!config.cidade && (config.chuva_ativa || config.calor_ativo);

  return (
    <section className="mb-6 rounded-xl2 bg-sky-50 p-4 ring-1 ring-sky-200">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setAberto((a) => !a)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="text-lg">⛅</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-sky-900">Story Weather</span>
            <span className="block truncate text-xs text-sky-700">
              {config.ativo ? `Ligado · ${config.cidade}` : config.cidade ? `Desligado · ${config.cidade}` : "Posta Story automático quando chove ou faz muito calor"}
            </span>
          </span>
          <span className="ml-auto text-xs text-sky-600">{aberto ? "▲" : "▼"}</span>
        </button>
        <Chave
          ligado={config.ativo}
          desabilitado={ocupado || !carregado || (!config.ativo && !podeLigar)}
          onClick={() => salvar({ ativo: !config.ativo })}
        />
      </div>

      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}

      {aberto && carregado && (
        <div className="mt-4 space-y-4 border-t border-sky-200 pt-4">
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">Cidade {config.cidade ? `· atual: ${config.cidade}` : ""}</span>
            <div className="flex gap-2">
              <input value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscarCidade()} placeholder="Ex.: Bebedouro" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              <button type="button" onClick={buscarCidade} disabled={busca.trim().length < 3} className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">Buscar</button>
            </div>
            {achados.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100 rounded-md bg-white ring-1 ring-slate-200">
                {achados.map((c) => (
                  <li key={`${c.latitude},${c.longitude}`}>
                    <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-sky-50" onClick={async () => { if (await salvar({ cidade: c.nome, latitude: c.latitude, longitude: c.longitude })) { setAchados([]); setBusca(""); setTeste(null); } }}>
                      {c.nome}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
            <div className="flex items-start gap-3">
              <Chave ligado={config.chuva_ativa} onClick={() => salvar({ chuva_ativa: !config.chuva_ativa })} desabilitado={ocupado} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">🌧️ Chuva</p>
                <p className="text-xs text-slate-500">Posta quando a previsão indicar chuva de verdade, confirmada em duas leituras seguidas.</p>
                <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                  No máximo
                  <select value={config.max_chuva_por_dia} disabled={ocupado} onChange={(e) => salvar({ max_chuva_por_dia: Number(e.target.value) })} className="rounded border border-slate-300 px-1 py-0.5">
                    {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  por dia (com 3h de intervalo)
                </label>
              </div>
            </div>
            {galeria("chuva", "Artes de chuva")}

            <div className="flex items-start gap-3 border-t border-slate-100 pt-3">
              <Chave ligado={config.calor_ativo} onClick={() => salvar({ calor_ativo: !config.calor_ativo })} desabilitado={ocupado} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">☀️ Calor</p>
                <p className="text-xs text-slate-500">Posta uma vez no dia quando a máxima prevista chegar a:</p>
                <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                  <input type="number" min={25} max={45} defaultValue={config.calor_graus} key={config.calor_graus} onBlur={(e) => Number(e.target.value) !== config.calor_graus && salvar({ calor_graus: Number(e.target.value) })} className="w-16 rounded border border-slate-300 px-1 py-0.5" />
                  °C ou mais
                </label>
              </div>
            </div>
            {galeria("calor", "Artes de calor")}
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">Só posta entre</span>
            <div className="flex items-center gap-2 text-sm">
              <input type="time" defaultValue={config.janela_inicio.slice(0, 5)} key={`i${config.janela_inicio}`} onBlur={(e) => e.target.value && e.target.value !== config.janela_inicio.slice(0, 5) && salvar({ janela_inicio: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
              e
              <input type="time" defaultValue={config.janela_fim.slice(0, 5)} key={`f${config.janela_fim}`} onBlur={(e) => e.target.value && e.target.value !== config.janela_fim.slice(0, 5) && salvar({ janela_fim: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
            </div>
          </div>

          <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600">Veja o que o robô enxerga agora, sem publicar nada.</span>
              <button type="button" onClick={testar} disabled={ocupado || !config.cidade} className="shrink-0 rounded-md border border-sky-200 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-60">Testar agora</button>
            </div>
            {teste && (
              <ul className="mt-2 space-y-1 text-xs text-slate-700">
                <li>📍 {teste.cidade}</li>
                <li>🌡️ Agora: {teste.leitura.temperatura_agora ?? "—"} °C · máxima prevista hoje: {teste.leitura.temperatura_max_hoje ?? "—"} °C</li>
                <li>🌧️ Chuva prevista na próxima hora: {teste.leitura.chuva_mm_proxima_hora ?? "—"} mm ({teste.leitura.simbolo_proxima_hora ?? "sem dado"})</li>
                <li className="font-medium">{teste.chuva.indica ? "➡️ Indica CHUVA (ainda precisa confirmar na próxima leitura)" : `➡️ Não indica chuva (mínimo ${teste.chuva.minimo_mm} mm + classificação de chuva)`}</li>
                <li className="font-medium">{teste.calor.indica ? `➡️ Indica CALOR (≥ ${teste.calor.graus} °C)` : `➡️ Não indica calor (limite ${teste.calor.graus} °C)`}</li>
              </ul>
            )}
            {config.ultima_leitura?.erro && <p className="mt-2 text-xs text-red-600">Última leitura do robô falhou: {config.ultima_leitura.erro}</p>}
          </div>

          {posts.length > 0 && (
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-600">Últimas publicações</span>
              <ul className="space-y-1 text-xs text-slate-600">
                {posts.map((p) => (
                  <li key={p.id}>
                    {p.tipo === "chuva" ? "🌧️" : "☀️"} {new Date(p.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {p.status === "success" ? "publicado" : p.status === "error" ? `erro: ${p.error_message ?? ""}` : "publicando…"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {progresso && <p className="text-xs text-slate-500">{progresso}</p>}
        </div>
      )}
    </section>
  );
}
