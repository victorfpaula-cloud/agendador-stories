"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ImagemGerada } from "@/types/database";
import { enviarMidiaDireto } from "@/lib/uploadDireto";
import { custoUSD, formatarReais } from "@/lib/custosGerador";

type FormatoId = ImagemGerada["formato"];
type ModoId = ImagemGerada["modo"];

const FORMATOS: { id: FormatoId; rotulo: string; dica: string }[] = [
  { id: "story", rotulo: "Story 9:16", dica: "1080×1920" },
  { id: "feed", rotulo: "Feed 4:5", dica: "1080×1350" },
  { id: "quadrado", rotulo: "Quadrado 1:1", dica: "1080×1080" },
  { id: "paisagem", rotulo: "Paisagem 16:9", dica: "1920×1080" },
];

const MODOS: { id: ModoId; rotulo: string; dica: string; placeholder: string }[] = [
  {
    id: "criar",
    rotulo: "Criar arte",
    dica: "Do zero, a partir de uma ideia",
    placeholder: "Ex: Pizza artesanal saindo do forno de lenha, fumaça, fundo escuro aconchegante, luz quente.",
  },
  {
    id: "produto",
    rotulo: "Melhorar produto",
    dica: "Mantém o produto, melhora o cenário",
    placeholder: "Ex: Colocar o produto sobre mármore claro, luz natural de janela, estilo catálogo premium.",
  },
  {
    id: "angulo",
    rotulo: "Novo ângulo",
    dica: "Mesmo prato, outra câmera (macro, 45°…)",
    placeholder: "Opcional. Ex: Fundo escuro, vapor saindo, luz quente vindo da esquerda.",
  },
  {
    id: "lettering",
    rotulo: "Arte com texto",
    dica: "Lettering / promoção / aviso",
    placeholder: "Ex: Arte de promoção de fim de semana, estilo moderno, cores vibrantes, destaque no texto.",
  },
];

const ESTILOS_LETTERING: { id: string; rotulo: string }[] = [
  { id: "auto", rotulo: "Automático" },
  { id: "elegante", rotulo: "Elegante dourado" },
  { id: "caligrafico", rotulo: "Caligráfico" },
  { id: "moderno", rotulo: "Moderno bold" },
  { id: "neon", rotulo: "Neon" },
  { id: "vintage", rotulo: "Retrô / vintage" },
  { id: "tridimensional", rotulo: "3D" },
  { id: "minimalista", rotulo: "Minimalista" },
  { id: "rustico", rotulo: "Rústico artesanal" },
];

const TEMAS_TEXTO: { id: string; rotulo: string }[] = [
  { id: "elegante", rotulo: "Elegante dourado" },
  { id: "classico", rotulo: "Clássico serifado" },
  { id: "caligrafico", rotulo: "Caligráfico" },
  { id: "moderno", rotulo: "Moderno impacto" },
  { id: "neon", rotulo: "Neon" },
  { id: "vintage", rotulo: "Retrô / vintage" },
  { id: "minimalista", rotulo: "Minimalista" },
  { id: "rustico", rotulo: "Rústico (giz)" },
];

type OpcoesTexto = { tema: string; posicao: "topo" | "centro" | "baixo"; tamanhoPct: number; cor: string | null; veu: boolean };

const ANGULOS: { id: string; rotulo: string }[] = [
  { id: "macro", rotulo: "Macro (bem de perto)" },
  { id: "tres_quartos", rotulo: "45° (3/4)" },
  { id: "topo", rotulo: "De cima (flat lay)" },
  { id: "rente", rotulo: "Rente à mesa" },
  { id: "livre", rotulo: "Do jeito que eu pedir" },
];

const POSICOES: { id: string; rotulo: string }[] = [
  { id: "superior-esquerdo", rotulo: "Topo · esquerda" },
  { id: "superior-centro", rotulo: "Topo · centro" },
  { id: "superior-direito", rotulo: "Topo · direita" },
  { id: "centro", rotulo: "Centro" },
  { id: "inferior-esquerdo", rotulo: "Rodapé · esquerda" },
  { id: "inferior-centro", rotulo: "Rodapé · centro" },
  { id: "inferior-direito", rotulo: "Rodapé · direita" },
];

type Marca = { logoUrl: string | null; posicao: string; tamanho: number; margem: number; estilo: string };
type Ref = { file: File; preview: string };
type Gerando = { id: string; erro?: string };

// Reduz a referência antes de enviar (a Vercel limita o corpo da requisição
// a ~4,5MB). É só referência pro modelo — não vira a imagem final.
async function reduzirReferencia(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    return blob ? new File([blob], "ref.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

export default function GeradorClient({
  accountId,
  nomeConta,
  marcaInicial,
  imagensIniciais,
  motoresDisponiveis,
  gastoHojeUsd,
  usdBrl,
  limiteReais,
}: {
  gastoHojeUsd: number;
  usdBrl: number;
  limiteReais: number;
  accountId: string;
  nomeConta: string;
  motoresDisponiveis: { nano: boolean; gpt: boolean };
  marcaInicial: Marca;
  imagensIniciais: ImagemGerada[];
}) {
  const api = `/api/accounts/${accountId}/gerador`;

  const [marca, setMarca] = useState<Marca>(marcaInicial);
  const [galeria, setGaleria] = useState<ImagemGerada[]>(imagensIniciais);
  const [modo, setModo] = useState<ModoId>("criar");
  const [formato, setFormato] = useState<FormatoId>("story");
  // Motor de imagem: Nano Banana (Google) ou GPT Image (OpenAI). A escolha fica
  // lembrada neste aparelho.
  const [motor, setMotorEstado] = useState<"nano" | "gpt">("nano");
  useEffect(() => {
    try {
      if (window.localStorage.getItem("gerador-motor") === "gpt" && motoresDisponiveis.gpt) setMotorEstado("gpt");
    } catch {
      /* sem acesso ao armazenamento local — segue no padrão */
    }
  }, [motoresDisponiveis.gpt]);
  function setMotor(m: "nano" | "gpt") {
    setMotorEstado(m);
    try {
      window.localStorage.setItem("gerador-motor", m);
    } catch {
      /* ignora */
    }
  }
  const [qualidade, setQualidade] = useState<"rapido" | "premium">("rapido");
  const [pedido, setPedido] = useState("");
  const [textoExato, setTextoExato] = useState("");
  const [estiloLettering, setEstiloLettering] = useState("auto");
  // "camada" = o app escreve o texto com fontes de verdade (recomendado);
  // "ia" = a IA desenha as letras.
  const [textoModo, setTextoModo] = useState<"camada" | "ia">("camada");
  const [opTexto, setOpTexto] = useState<OpcoesTexto>({ tema: "elegante", posicao: "topo", tamanhoPct: 12, cor: null, veu: true });
  const [angulo, setAngulo] = useState("macro");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [usarLogo, setUsarLogo] = useState(!!marcaInicial.logoUrl);
  const [variacoes, setVariacoes] = useState(1);
  const [gastoUsd, setGastoUsd] = useState(gastoHojeUsd);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [base, setBase] = useState<ImagemGerada | null>(null); // imagem sendo editada
  const [gerando, setGerando] = useState<Gerando[]>([]);
  const [turbinando, setTurbinando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [soFavoritas, setSoFavoritas] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const emEdicao = modo === "editar" && base;
  const modoInfo = MODOS.find((m) => m.id === modo);
  const ocupado = gerando.some((g) => !g.erro);
  // Com texto na imagem o servidor sempre usa o Premium (o Rápido desenha
  // letras mal), então a tela já mostra isso.
  const temTexto = modo === "lettering" || textoExato.trim().length > 0;
  // Referência também força o Premium: o Rápido tende a devolver a foto igual.
  // Premium custa ~3x mais: começa no Rápido, exceto nos modos de produto/ângulo,
  // onde o Premium segue a foto de referência bem melhor (dá pra trocar).
  useEffect(() => {
    setQualidade(modo === "angulo" || modo === "produto" ? "premium" : "rapido");
  }, [modo]);
  const textoNaIA = temTexto && (textoModo === "ia" || modo === "editar");
  const forcaPremium = motor === "nano" && textoNaIA;
  const qualidadeEfetiva = forcaPremium ? "premium" : qualidade;
  const maxRefs = 6;

  async function adicionarRefs(lista: FileList | null) {
    if (!lista) return;
    const novos: Ref[] = [];
    for (const f of Array.from(lista)) {
      if (!f.type.startsWith("image/")) continue;
      const reduzido = await reduzirReferencia(f);
      novos.push({ file: reduzido, preview: URL.createObjectURL(reduzido) });
    }
    setRefs((atual) => [...atual, ...novos].slice(0, maxRefs));
  }

  async function turbinar() {
    setErro(null);
    if (pedido.trim().length < 3) {
      setErro("Escreva uma ideia primeiro (pode ser curtinha).");
      return;
    }
    setTurbinando(true);
    try {
      const res = await fetch(`${api}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido, modo, formato, textoExato, estiloLettering, textoModo: emEdicao ? "ia" : textoModo, temReferencia: refs.length > 0 }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.erro || "Não consegui turbinar o pedido.");
      setPedido(json.prompt);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao turbinar o pedido.");
    } finally {
      setTurbinando(false);
    }
  }

  async function gerarUma(id: string) {
    const form = new FormData();
    form.set("modo", modo);
    form.set("formato", formato);
    form.set("qualidade", qualidadeEfetiva);
    form.set("motor", motor);
    form.set("estiloLettering", estiloLettering);
    form.set("textoModo", textoModo);
    form.set("temaTexto", opTexto.tema);
    form.set("posicaoTexto", opTexto.posicao);
    form.set("tamanhoTexto", String(opTexto.tamanhoPct));
    form.set("corTexto", opTexto.cor ?? "");
    form.set("veuTexto", opTexto.veu ? "1" : "0");
    form.set("angulo", angulo);
    form.set("pedido", pedido);
    form.set("textoExato", textoExato);
    form.set("usarLogo", usarLogo && marca.logoUrl ? "1" : "0");
    if (emEdicao && base) form.set("baseImagemId", base.id);
    for (const r of refs) form.append("refs", r.file);

    try {
      const res = await fetch(`${api}/gerar`, { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.erro || (res.status === 504 ? "Demorou demais. Tente \"Rápido\"." : "Erro ao gerar."));
      setGerando((g) => g.filter((x) => x.id !== id));
      setGaleria((g) => [json.imagem as ImagemGerada, ...g]);
      if (typeof json.custoUsd === "number") setGastoUsd((g) => g + json.custoUsd);
      if (json.aviso) setAvisos((a) => (a.includes(json.aviso) ? a : [...a, json.aviso]));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao gerar.";
      setGerando((g) => g.map((x) => (x.id === id ? { ...x, erro: msg } : x)));
    }
  }

  function gerar() {
    setErro(null);
    setAvisos([]);
    if (modo === "angulo") {
      if (refs.length === 0) {
        setErro("Anexe a foto do prato/produto em \"Imagens de referência\".");
        return;
      }
      if (angulo === "livre" && pedido.trim().length < 3) {
        setErro("Descreva o ângulo que você quer.");
        return;
      }
    } else if (pedido.trim().length < 3) {
      setErro("Descreva o que você quer na imagem.");
      return;
    }
    if (modo === "produto" && refs.length === 0) {
      setErro("Pra melhorar um produto, anexe a foto dele em \"Imagens de referência\".");
      return;
    }
    if (modo === "editar" && !base) {
      setErro("Escolha uma imagem da galeria pra editar.");
      return;
    }
    const total = refs.reduce((s, r) => s + r.file.size, 0);
    if (total > 4_000_000) {
      setErro("As referências somam mais de 4MB. Remova alguma.");
      return;
    }
    const qtd = emEdicao ? 1 : variacoes;
    const novos = Array.from({ length: qtd }, () => ({ id: crypto.randomUUID() }));
    setGerando((g) => [...g, ...novos]);
    novos.forEach((n) => void gerarUma(n.id));
  }

  function editarImagem(img: ImagemGerada) {
    setBase(img);
    setModo("editar");
    setFormato(img.formato);
    setPedido("");
    setTextoExato("");
    setRefs([]);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function sairDaEdicao() {
    setBase(null);
    setModo("criar");
  }

  function reaproveitar(img: ImagemGerada) {
    setBase(null);
    setModo(img.modo === "editar" ? "criar" : img.modo);
    setFormato(img.formato);
    setPedido(img.pedido);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function alternarFavorita(img: ImagemGerada) {
    setGaleria((g) => g.map((x) => (x.id === img.id ? { ...x, favorita: !x.favorita } : x)));
    await fetch(`${api}/imagens/${img.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorita: !img.favorita }),
    }).catch(() => null);
  }

  async function excluir(img: ImagemGerada) {
    if (!confirm("Excluir essa imagem da galeria?")) return;
    setGaleria((g) => g.filter((x) => x.id !== img.id));
    if (base?.id === img.id) sairDaEdicao();
    await fetch(`${api}/imagens/${img.id}`, { method: "DELETE" }).catch(() => null);
  }

  async function baixar(img: ImagemGerada) {
    try {
      const blob = await (await fetch(img.url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${nomeConta.replace(/[^\w-]+/g, "-").toLowerCase()}-${img.formato}-${img.id.slice(0, 6)}.jpg`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(img.url, "_blank");
    }
  }

  const visiveis = soFavoritas ? galeria.filter((g) => g.favorita) : galeria;

  return (
    <div className="space-y-8">
      <PainelMarca accountId={accountId} marca={marca} onChange={setMarca} onLogo={(tem) => setUsarLogo(tem)} />

      <section ref={formRef} className="rounded-xl2 bg-white p-5 shadow-card ring-1 ring-slate-200">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Nova imagem</h2>

        {emEdicao && base ? (
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-brand-50 p-3 ring-1 ring-brand-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={base.url} alt="" className="h-16 w-12 rounded object-cover" />
            <div className="flex-1 text-sm text-slate-700">
              <strong>Editando uma imagem.</strong> Diga só o que mudar — o resto fica igual.
            </div>
            <button onClick={sairDaEdicao} className="text-xs text-slate-500 underline">
              Cancelar
            </button>
          </div>
        ) : (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MODOS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModo(m.id)}
                className={`rounded-lg px-3 py-2 text-left text-sm ring-1 transition ${
                  modo === m.id ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="font-medium">{m.rotulo}</div>
                <div className={`text-xs ${modo === m.id ? "text-white/80" : "text-slate-500"}`}>{m.dica}</div>
              </button>
            ))}
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          {FORMATOS.map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={!!emEdicao}
              onClick={() => setFormato(f.id)}
              className={`rounded-full px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                formato === f.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f.rotulo} <span className="text-xs opacity-70">{f.dica}</span>
            </button>
          ))}
        </div>

        {modo === "angulo" && !emEdicao && (
          <div className="mb-4">
            <div className="mb-1 text-sm font-medium text-slate-700">Qual ângulo?</div>
            <div className="flex flex-wrap gap-2">
              {ANGULOS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAngulo(a.id)}
                  className={`rounded-full px-3 py-1.5 text-sm transition ${
                    angulo === a.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {a.rotulo}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Anexe a foto do prato abaixo em “Imagens de referência”. A IA mantém o prato igual e muda só a posição da câmera.
            </p>
          </div>
        )}

        <label className="mb-1 block text-sm font-medium text-slate-700">
          {emEdicao ? "O que mudar?" : modo === "angulo" ? "Observações (opcional)" : "O que você quer?"}
        </label>
        <textarea
          value={pedido}
          onChange={(e) => setPedido(e.target.value)}
          rows={5}
          placeholder={emEdicao ? "Ex: Trocar o fundo por um céu de pôr do sol. Não mexer no resto." : modoInfo?.placeholder}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        {!emEdicao && (
          <button
            type="button"
            onClick={turbinar}
            disabled={turbinando}
            className="mt-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            {turbinando ? "Turbinando…" : "✨ Turbinar meu pedido (IA escreve um briefing melhor — você pode editar)"}
          </button>
        )}

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Texto que deve aparecer na imagem <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <textarea
            value={textoExato}
            onChange={(e) => setTextoExato(e.target.value)}
            rows={2}
            maxLength={600}
            placeholder={emEdicao ? "Ex: Trocar o título para: Estamos Abertos" : "Ex: PROMOÇÃO DE SEXTA\nChopp em dobro até 20h"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-500">Vai escrito exatamente assim, com a grafia que você digitou.</p>

          {temTexto && !emEdicao && (
            <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    ["camada", "Texto profissional", "A IA faz a arte; o app escreve o texto com fontes de verdade. Letras perfeitas e dá pra editar depois."],
                    ["ia", "A IA desenha o texto", "Letras integradas à cena (3D, neon, giz…), mas podem sair com erros. Usa o modo Premium."],
                  ] as const
                ).map(([id, titulo, dica]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTextoModo(id)}
                    className={`rounded-lg px-3 py-2 text-left text-sm ring-1 transition ${
                      textoModo === id ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="font-medium">{titulo}</div>
                    <div className={`text-xs ${textoModo === id ? "text-white/80" : "text-slate-500"}`}>{dica}</div>
                  </button>
                ))}
              </div>

              {textoModo === "camada" ? (
                <ControlesTexto valor={opTexto} onChange={setOpTexto} />
              ) : (
                <div>
                  <div className="mb-1 text-sm font-medium text-slate-700">Estilo do lettering</div>
                  <div className="flex flex-wrap gap-2">
                    {ESTILOS_LETTERING.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => setEstiloLettering(e.id)}
                        className={`rounded-full px-3 py-1.5 text-xs transition ${
                          estiloLettering === e.id ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {e.rotulo}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {!emEdicao && (
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Imagens de referência{" "}
              <span className="font-normal text-slate-400">
                ({modo === "produto" || modo === "angulo" ? "a foto do produto — obrigatória" : "opcional"}, até {maxRefs})
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {refs.map((r, i) => (
                <div key={r.preview} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.preview} alt="" className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
                  <button
                    type="button"
                    onClick={() => setRefs((a) => a.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-slate-800 text-xs text-white"
                    aria-label="Remover referência"
                  >
                    ×
                  </button>
                </div>
              ))}
              {refs.length < maxRefs && (
                <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-2xl text-slate-400 hover:bg-slate-50">
                  +
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void adicionarRefs(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        )}

        <div className="mt-5">
          <div className="mb-1 text-sm font-medium text-slate-700">Motor de imagem</div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["nano", "Nano Banana", "Google", motoresDisponiveis.nano],
                ["gpt", "GPT Image", "OpenAI (ChatGPT)", motoresDisponiveis.gpt],
              ] as const
            ).map(([id, nome, empresa, ok]) => (
              <button
                key={id}
                type="button"
                disabled={!ok}
                onClick={() => setMotor(id)}
                className={`rounded-lg px-3 py-2 text-left text-sm ring-1 transition disabled:opacity-50 ${
                  motor === id ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="font-medium">{nome}</div>
                <div className={`text-xs ${motor === id ? "text-white/80" : "text-slate-500"}`}>
                  {ok ? empresa : "chave não configurada na Vercel"}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">Qualidade</div>
            <div className="flex gap-2">
              {(["rapido", "premium"] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={forcaPremium && q === "rapido"}
                  onClick={() => setQualidade(q)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm ring-1 transition disabled:opacity-40 ${
                    qualidadeEfetiva === q ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {q === "rapido" ? "Rápido" : "Premium"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {motor === "gpt"
                ? qualidadeEfetiva === "rapido"
                  ? "Qualidade média: mais veloz e barata."
                  : "Qualidade alta: mais detalhe e texto melhor, mas é mais lenta e cara — pode estourar o limite de 60s."
                : qualidadeEfetiva === "rapido"
                  ? "Mais barato (~3x menos que o Premium). Bom pra testar ideias."
                  : "Melhor texto, detalhes e fidelidade. Demora mais."}
            </p>
          </div>

          {!emEdicao && (
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">Quantas variações: {variacoes}</div>
              <input
                type="range"
                min={1}
                max={4}
                value={variacoes}
                onChange={(e) => setVariacoes(Number(e.target.value))}
                className="w-full"
              />
              <p className="text-xs text-slate-500">Gera várias opções de uma vez pra você escolher.</p>
            </div>
          )}
        </div>

        <label className={`mt-4 flex items-center gap-2 text-sm ${marca.logoUrl ? "text-slate-700" : "text-slate-400"}`}>
          <input
            type="checkbox"
            checked={usarLogo && !!marca.logoUrl}
            disabled={!marca.logoUrl}
            onChange={(e) => setUsarLogo(e.target.checked)}
          />
          Colocar o logo da marca (colado por cima, sem alterar)
          {!marca.logoUrl && <span className="text-xs">— envie o logo no painel “Marca” acima</span>}
        </label>

        {erro && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{erro}</div>}

        <p className="mt-5 text-center text-xs text-slate-500">
          Custo estimado: <strong>{formatarReais(custoUSD(motor, qualidadeEfetiva) * (emEdicao ? 1 : variacoes), usdBrl)}</strong>{" "}
          ({emEdicao ? 1 : variacoes} × {formatarReais(custoUSD(motor, qualidadeEfetiva), usdBrl)}) · Hoje:{" "}
          <strong>{formatarReais(gastoUsd, usdBrl)}</strong> de R$ {limiteReais.toFixed(2).replace(".", ",")}
        </p>
        <button
          onClick={gerar}
          disabled={ocupado}
          className="mt-2 w-full rounded-full bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          {ocupado ? "Gerando…" : emEdicao ? "Aplicar edição" : `Gerar ${variacoes > 1 ? `${variacoes} imagens` : "imagem"}`}
        </button>
        <p className="mt-2 text-center text-xs text-slate-400">
          Imagens geradas por IA levam a marca invisível do Google (SynthID) e o Instagram pode rotulá-las como “feito com IA”.
        </p>
      </section>

      {avisos.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          {avisos.map((a) => (
            <p key={a}>⚠ {a}</p>
          ))}
        </div>
      )}

      {gerando.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {gerando.map((g) => (
            <div
              key={g.id}
              className="flex aspect-[4/5] flex-col items-center justify-center rounded-xl2 bg-slate-100 p-3 text-center text-xs text-slate-500 ring-1 ring-slate-200"
            >
              {g.erro ? (
                <>
                  <p className="text-red-600">{g.erro}</p>
                  <button
                    onClick={() => setGerando((l) => l.filter((x) => x.id !== g.id))}
                    className="mt-2 underline"
                  >
                    Fechar
                  </button>
                </>
              ) : (
                <>
                  <div className="mb-2 h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
                  Criando…
                </>
              )}
            </div>
          ))}
        </section>
      )}

      <ImportarImagem
        accountId={accountId}
        temLogo={!!marca.logoUrl}
        onImportada={(img) => setGaleria((g) => [img, ...g])}
      />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Galeria ({galeria.length})</h2>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={soFavoritas} onChange={(e) => setSoFavoritas(e.target.checked)} />
            Só favoritas
          </label>
        </div>

        {visiveis.length === 0 ? (
          <div className="rounded-xl2 border-2 border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            {soFavoritas ? "Nenhuma favorita ainda." : "As imagens que você gerar aparecem aqui."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visiveis.map((img) => (
              <CartaoImagem
                key={img.id}
                img={img}
                accountId={accountId}
                onBaixar={() => baixar(img)}
                onEditar={() => editarImagem(img)}
                onReusar={() => reaproveitar(img)}
                onFavorita={() => alternarFavorita(img)}
                onExcluir={() => excluir(img)}
                onTextoAtualizado={(nova) => setGaleria((g) => g.map((x) => (x.id === nova.id ? nova : x)))}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CartaoImagem({
  img,
  accountId,
  onBaixar,
  onEditar,
  onReusar,
  onFavorita,
  onExcluir,
  onTextoAtualizado,
}: {
  img: ImagemGerada;
  accountId: string;
  onBaixar: () => void;
  onEditar: () => void;
  onReusar: () => void;
  onFavorita: () => void;
  onExcluir: () => void;
  onTextoAtualizado: (img: ImagemGerada) => void;
}) {
  const [editandoTexto, setEditandoTexto] = useState(false);
  const [enviandoEngine, setEnviandoEngine] = useState(false);
  const btn = "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200";
  return (
    <div className="overflow-hidden rounded-xl2 bg-white shadow-card ring-1 ring-slate-200">
      <a href={img.url} target="_blank" rel="noreferrer" className="relative block bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt={img.pedido.slice(0, 80)} loading="lazy" className="w-full" />
        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">
          {img.formato}
          {img.com_logo ? " · logo" : ""}
        </span>
      </a>
      <div className="flex flex-wrap gap-1.5 p-2">
        <button onClick={onBaixar} className={btn}>
          Baixar
        </button>
        <button onClick={onEditar} className={btn}>
          Editar
        </button>
        {img.base_path && (
          <button onClick={() => setEditandoTexto((v) => !v)} className={btn} title="Adicionar/mudar o texto, o estilo ou a posição (sem gastar IA)">
            Texto
          </button>
        )}
        <button onClick={onReusar} className={btn} title="Usar o mesmo pedido de novo">
          Refazer
        </button>
        {(img.formato === "feed" || img.formato === "quadrado") && (
          <Link href={`/contas/${accountId}/publicacoes?imagem=${encodeURIComponent(img.url)}`} className={btn}>
            Usar no Feed
          </Link>
        )}
        <button onClick={() => setEnviandoEngine((v) => !v)} className={btn} title="Mandar pra uma categoria do Story Engine">
          Story Engine
        </button>
        <button onClick={onFavorita} className={btn} aria-label="Favoritar">
          {img.favorita ? "★" : "☆"}
        </button>
        <button onClick={onExcluir} className={`${btn} text-red-600`} aria-label="Excluir">
          ✕
        </button>
      </div>
      {enviandoEngine && <EnviarParaStoryEngine accountId={accountId} img={img} onFechar={() => setEnviandoEngine(false)} />}
      {editandoTexto && img.base_path && (
        <EditorTexto
          accountId={accountId}
          img={img}
          onSalvo={(nova) => {
            onTextoAtualizado(nova);
            setEditandoTexto(false);
          }}
        />
      )}
    </div>
  );
}

function PainelMarca({
  accountId,
  marca,
  onChange,
  onLogo,
}: {
  accountId: string;
  marca: Marca;
  onChange: (m: Marca) => void;
  onLogo: (tem: boolean) => void;
}) {
  const api = `/api/accounts/${accountId}/gerador/marca`;
  const [aberto, setAberto] = useState(!marca.logoUrl);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function enviarLogo(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    const form = new FormData();
    form.set("logo", file);
    const res = await fetch(`${api}/logo`, { method: "POST", body: form });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setMsg(json?.erro || "Erro ao enviar o logo.");
      return;
    }
    onChange({ ...marca, logoUrl: json.logo_url });
    onLogo(true);
  }

  async function removerLogo() {
    if (!confirm("Remover o logo dessa conta?")) return;
    await fetch(`${api}/logo`, { method: "DELETE" });
    onChange({ ...marca, logoUrl: null });
    onLogo(false);
  }

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    const res = await fetch(api, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logo_posicao: marca.posicao,
        logo_tamanho_pct: marca.tamanho,
        logo_margem_pct: marca.margem,
        estilo: marca.estilo,
      }),
    });
    const json = await res.json().catch(() => null);
    setSalvando(false);
    setMsg(res.ok ? "Salvo!" : json?.erro || "Erro ao salvar.");
  }

  return (
    <section className="rounded-xl2 bg-white p-5 shadow-card ring-1 ring-slate-200">
      <button onClick={() => setAberto(!aberto)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-semibold text-slate-700">Marca da conta (logo e estilo)</span>
        <span className="text-xs text-slate-500">{aberto ? "Fechar" : marca.logoUrl ? "Editar" : "Configurar"}</span>
      </button>

      {aberto && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">Logo</div>
            <div className="flex items-center gap-3">
              <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-[conic-gradient(#e2e8f0_25%,#fff_0_50%,#e2e8f0_0_75%,#fff_0)] bg-[length:16px_16px] ring-1 ring-slate-200">
                {marca.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={marca.logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-xs text-slate-400">sem logo</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="cursor-pointer rounded-full bg-brand-600 px-3 py-1.5 text-center text-xs font-medium text-white hover:bg-brand-700">
                  {marca.logoUrl ? "Trocar logo" : "Enviar logo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      void enviarLogo(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {marca.logoUrl && (
                  <button onClick={removerLogo} className="text-xs text-red-600 underline">
                    Remover
                  </button>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Use PNG com fundo transparente. O logo <strong>não passa pela IA</strong>: é colado por cima da imagem pronta, idêntico ao arquivo
              enviado (só é ajustado ao tamanho escolhido, sem cortar nem mudar cores).
            </p>
          </div>

          {marca.logoUrl && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Posição</label>
                <select
                  value={marca.posicao}
                  onChange={(e) => onChange({ ...marca, posicao: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {POSICOES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.rotulo}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Tamanho: {marca.tamanho}% da largura</label>
                <input type="range" min={5} max={60} value={marca.tamanho} onChange={(e) => onChange({ ...marca, tamanho: Number(e.target.value) })} className="w-full" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Margem: {marca.margem}%</label>
                <input type="range" min={0} max={20} value={marca.margem} onChange={(e) => onChange({ ...marca, margem: Number(e.target.value) })} className="w-full" />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Estilo da marca (a IA respeita em toda imagem)</label>
            <textarea
              value={marca.estilo}
              onChange={(e) => onChange({ ...marca, estilo: e.target.value })}
              rows={3}
              maxLength={1500}
              placeholder="Ex: Cores: vinho (#7a1f2b) e dourado. Visual elegante e acolhedor, fotos com luz quente. Evitar neon e fundos muito poluídos."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <button onClick={salvar} disabled={salvando} className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
              {salvando ? "Salvando…" : "Salvar marca"}
            </button>
            {msg && <span className="text-sm text-slate-600">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

// Escolha de estilo/posição/tamanho/cor do texto profissional (usado ao gerar
// e ao reeditar uma imagem).
function ControlesTexto({ valor, onChange }: { valor: OpcoesTexto; onChange: (v: OpcoesTexto) => void }) {
  const set = (p: Partial<OpcoesTexto>) => onChange({ ...valor, ...p });
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">Estilo do texto</div>
        <div className="flex flex-wrap gap-2">
          {TEMAS_TEXTO.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set({ tema: t.id })}
              className={`rounded-full px-3 py-1.5 text-xs transition ${
                valor.tema === t.id ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              {t.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-700">Posição</div>
          <div className="flex gap-1.5">
            {(["topo", "centro", "baixo"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ posicao: p })}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs capitalize ring-1 transition ${
                  valor.posicao === p ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-700">Tamanho: {valor.tamanhoPct}</div>
          <input type="range" min={6} max={22} value={valor.tamanhoPct} onChange={(e) => set({ tamanhoPct: Number(e.target.value) })} className="w-full" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-slate-700">
          Cor
          <input type="color" value={valor.cor ?? "#ffffff"} onChange={(e) => set({ cor: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-slate-300" />
          {valor.cor ? (
            <button type="button" onClick={() => set({ cor: null })} className="underline">
              usar cor do estilo
            </button>
          ) : (
            <span className="text-slate-400">(a do estilo)</span>
          )}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-700">
          <input type="checkbox" checked={valor.veu} onChange={(e) => set({ veu: e.target.checked })} />
          Escurecer atrás do texto (mais contraste)
        </label>
      </div>
    </div>
  );
}

// Reedita o texto de uma imagem já gerada: refaz só a camada de texto sobre a
// base guardada — instantâneo e sem gastar IA.
function EditorTexto({ accountId, img, onSalvo }: { accountId: string; img: ImagemGerada; onSalvo: (img: ImagemGerada) => void }) {
  const c = img.camada ?? { texto: "", tema: "elegante", posicao: "topo" as const, tamanhoPct: 12, cor: null, veu: true };
  const [texto, setTexto] = useState(c.texto);
  const [op, setOp] = useState<OpcoesTexto>({ tema: c.tema, posicao: c.posicao, tamanhoPct: c.tamanhoPct, cor: c.cor, veu: c.veu });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aplicar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/gerador/imagens/${img.id}/texto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto, tema: op.tema, posicao: op.posicao, tamanhoPct: op.tamanhoPct, cor: op.cor, veu: op.veu }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.erro || "Erro ao aplicar o texto.");
      onSalvo(json.imagem as ImagemGerada);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao aplicar o texto.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-slate-200 bg-slate-50 p-3">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        maxLength={600}
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
      />
      <ControlesTexto valor={op} onChange={setOp} />
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      <button onClick={aplicar} disabled={salvando} className="w-full rounded-full bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
        {salvando ? "Aplicando…" : "Aplicar texto (sem gastar IA)"}
      </button>
    </div>
  );
}

// Escolhe a categoria do Story Engine da conta e manda a imagem pra lá.
function EnviarParaStoryEngine({ accountId, img, onFechar }: { accountId: string; img: ImagemGerada; onFechar: () => void }) {
  const [categorias, setCategorias] = useState<{ id: string; nome: string }[] | null>(null);
  const [escolhida, setEscolhida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/accounts/${accountId}/ciclo-categorias`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelado) return;
        const lista = ((j?.categorias ?? []) as { id: string; nome: string }[]).map((c) => ({ id: c.id, nome: c.nome }));
        setCategorias(lista);
        if (lista.length > 0) setEscolhida(lista[0].id);
      })
      .catch(() => !cancelado && setCategorias([]));
    return () => {
      cancelado = true;
    };
  }, [accountId]);

  async function enviar() {
    setEnviando(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/gerador/imagens/${img.id}/story-engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: escolhida }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.erro || "Erro ao enviar.");
      setMsg({ ok: true, texto: `Enviada pra categoria “${json.categoria}”.` });
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof Error ? e.message : "Erro ao enviar." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3 text-sm">
      {categorias === null ? (
        <p className="text-xs text-slate-500">Carregando categorias…</p>
      ) : categorias.length === 0 ? (
        <p className="text-xs text-slate-600">Essa conta ainda não tem categoria no Story Engine. Crie uma na aba “Story Engine”.</p>
      ) : (
        <>
          {img.formato !== "story" && (
            <p className="text-xs text-amber-700">Atenção: essa imagem não é 9:16, vai aparecer com bordas no Story.</p>
          )}
          <select value={escolhida} onChange={(e) => setEscolhida(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <button
            onClick={enviar}
            disabled={enviando || !escolhida || msg?.ok === true}
            className="w-full rounded-full bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {enviando ? "Enviando…" : "Enviar pra essa categoria"}
          </button>
        </>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.texto}</p>}
      <button onClick={onFechar} className="text-xs text-slate-500 underline">
        Fechar
      </button>
    </div>
  );
}

// Traz pra galeria uma imagem feita fora do app (ex.: Google Flow). Não gasta
// IA: depois dá pra pôr texto profissional, logo, mandar pro Story Engine etc.
function ImportarImagem({ accountId, temLogo, onImportada }: { accountId: string; temLogo: boolean; onImportada: (img: ImagemGerada) => void }) {
  const [formato, setFormato] = useState<FormatoId>("story");
  const [usarLogo, setUsarLogo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function importar(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setErro(null);
    setEnviando(true);
    try {
      for (const file of Array.from(arquivos)) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use imagens JPG, PNG ou WebP.");
        // Sobe direto pro Storage (sem o limite de ~4,5MB do servidor) e o servidor ajusta ao formato.
        const up = await enviarMidiaDireto(file, { bucket: "gerador-imagens", pasta: `${accountId}/import` });
        const res = await fetch(`/api/accounts/${accountId}/gerador/importar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: up.path, formato, usarLogo: usarLogo && temLogo }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.erro || "Erro ao importar.");
        onImportada(json.imagem as ImagemGerada);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao importar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <details className="rounded-xl2 bg-white p-4 shadow-card ring-1 ring-slate-200">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">Importar imagem de fora (Flow, ChatGPT, etc.) — sem custo</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-slate-500">
          Gerou a imagem em outro lugar? Traga pra cá e use o texto profissional, o logo, o Story Engine e o Feed daqui. Não gasta IA.
        </p>
        <div className="flex flex-wrap gap-2">
          {FORMATOS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormato(f.id)}
              className={`rounded-full px-3 py-1.5 text-xs transition ${formato === f.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
        <label className={`flex items-center gap-2 text-xs ${temLogo ? "text-slate-700" : "text-slate-400"}`}>
          <input type="checkbox" disabled={!temLogo} checked={usarLogo && temLogo} onChange={(e) => setUsarLogo(e.target.checked)} />
          Colocar o logo da marca
        </label>
        <label className="inline-block cursor-pointer rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          {enviando ? "Importando…" : "Escolher imagem(ns)"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={enviando}
            className="hidden"
            onChange={(e) => {
              void importar(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <p className="text-xs text-slate-400">A imagem é ajustada ao formato escolhido (recorte centralizado).</p>
        {erro && <p className="text-xs text-red-600">{erro}</p>}
      </div>
    </details>
  );
}
