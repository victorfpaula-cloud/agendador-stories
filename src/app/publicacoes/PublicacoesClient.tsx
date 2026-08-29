"use client";

import { useState } from "react";
import { enviarMidiaDireto } from "@/lib/uploadDireto";
import type { FeedPostComDetalhes, FeedPostStatus } from "@/types/database";

const BUCKET = "feed-media";

// Mesmo padrão de tratamento de erro usado no resto do app: evita travar
// silenciosamente se a sessão expirou ou o servidor respondeu algo inesperado.
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

// Formata em pt-BR, sempre no fuso de São Paulo — mesmo padrão usado pro
// resto do app (agoraEmSaoPaulo em src/lib/days.ts), pra bater com o
// horário que o cron efetivamente usa pra decidir o que já é "devido".
function formatarDataHora(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// "2026-08-29T17:00:00.000Z" -> "2026-08-29T14:00" (formato local que o
// <input type="datetime-local"> espera), já convertido pro fuso de São
// Paulo — pra abrir o formulário de edição já com o horário certo na tela.
function paraCampoDataHora(iso: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// Mesma regra usada no servidor (/api/feed-posts) pra decidir o tipo do
// post só pela quantidade/tipo de arquivo — mostrado aqui só como
// informação pro usuário, quem decide de verdade é o servidor.
function tipoDetectado(files: File[]): string | null {
  if (files.length === 0) return null;
  if (files.length === 1) return files[0].type.startsWith("video/") ? "Reels" : "Post no feed";
  return `Carrossel (${files.length} itens)`;
}

type Conta = { id: string; name: string; ig_username: string | null };

export default function PublicacoesClient({
  accounts,
  initialPosts,
}: {
  accounts: Conta[];
  initialPosts: FeedPostComDetalhes[];
}) {
  const [posts, setPosts] = useState<FeedPostComDetalhes[]>(initialPosts);

  function aoCriar(post: FeedPostComDetalhes) {
    setPosts((atual) =>
      [...atual, post].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    );
  }

  function aoAtualizar(post: FeedPostComDetalhes) {
    setPosts((atual) =>
      atual
        .map((p) => (p.id === post.id ? post : p))
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    );
  }

  function aoExcluir(id: string) {
    setPosts((atual) => atual.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-8">
      <ComporPost accounts={accounts} onCriado={aoCriar} />

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Agendadas</h2>
        {posts.length === 0 ? (
          <div className="rounded-xl2 border-2 border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Nenhuma publicação agendada ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {posts.map((post) => (
              <CardPost
                key={post.id}
                post={post}
                accounts={accounts}
                onAtualizado={aoAtualizar}
                onExcluido={aoExcluir}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ComporPost({
  accounts,
  onCriado,
}: {
  accounts: Conta[];
  onCriado: (post: FeedPostComDetalhes) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [dataHora, setDataHora] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const tipo = tipoDetectado(files);

  function alternarConta(id: string) {
    setAccountIds((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function publicar() {
    setErro(null);

    if (files.length === 0) {
      setErro("Escolha ao menos uma foto ou vídeo.");
      return;
    }
    if (files.length > 10) {
      setErro("Carrossel aceita no máximo 10 arquivos.");
      return;
    }
    if (accountIds.length === 0) {
      setErro("Escolha ao menos uma conta de destino.");
      return;
    }
    if (!dataHora) {
      setErro("Escolha a data e o horário do agendamento.");
      return;
    }
    const scheduledAt = new Date(dataHora);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      setErro("A data/horário do agendamento precisa ser no futuro.");
      return;
    }

    setEnviando(true);
    try {
      // Um upload de cada vez, na ordem em que os arquivos foram escolhidos
      // — o servidor usa essa mesma ordem como ordem do carrossel.
      const midias: { url: string; path: string; mediaType: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgresso(files.length > 1 ? `Enviando arquivo ${i + 1} de ${files.length}…` : "Enviando mídia…");
        const midia = await enviarMidiaDireto(files[i], { bucket: BUCKET, pasta: "manual" });
        midias.push(midia);
      }

      setProgresso("Agendando…");
      const json = await chamarApi("/api/feed-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption,
          scheduledAt: scheduledAt.toISOString(),
          accountIds,
          media: midias,
        }),
      });

      onCriado(json.post);
      setFiles([]);
      setCaption("");
      setAccountIds([]);
      setDataHora("");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao agendar a publicação.");
    } finally {
      setEnviando(false);
      setProgresso(null);
    }
  }

  return (
    <div className="rounded-xl2 bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-4 text-sm font-semibold text-slate-700">Nova publicação</h2>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Foto(s) ou vídeo</span>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            disabled={enviando}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
          {/* Sem nada pra marcar: 1 vídeo vira Reels, 1 foto vira post no
              feed, 2 ou mais arquivos viram carrossel — automático. */}
          {files.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {files.map((f, i) => (
                <span key={i} className="block truncate text-xs text-slate-400">
                  {f.name}
                </span>
              ))}
              {tipo && (
                <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                  {tipo}
                </span>
              )}
            </div>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Legenda</span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            disabled={enviando}
            rows={3}
            placeholder="Legenda do post (opcional)"
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">
            Contas ({accountIds.length === 0 ? "nenhuma selecionada" : `${accountIds.length} selecionada(s)`})
          </span>
          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-slate-300 p-1.5">
            {accounts.length === 0 && (
              <p className="px-1.5 py-1 text-xs text-slate-400">Nenhuma conta ativa disponível.</p>
            )}
            {accounts.map((conta) => (
              <label
                key={conta.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={accountIds.includes(conta.id)}
                  onChange={() => alternarConta(conta.id)}
                  disabled={enviando}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-slate-700">
                  {conta.name}
                  {conta.ig_username ? ` (@${conta.ig_username})` : ""}
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Data e horário</span>
          <input
            type="datetime-local"
            value={dataHora}
            onChange={(e) => setDataHora(e.target.value)}
            disabled={enviando}
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm sm:w-1/2"
          />
        </label>

        <button
          type="button"
          onClick={publicar}
          disabled={enviando}
          className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {enviando ? progresso ?? "Agendando…" : "Agendar publicação"}
        </button>

        {erro && <p className="text-xs text-red-600">{erro}</p>}
      </div>
    </div>
  );
}

const STATUS_INFO: Record<FeedPostStatus, { cor: string; texto: string }> = {
  pending: { cor: "bg-amber-50 text-amber-700", texto: "Agendado" },
  publishing: { cor: "bg-blue-50 text-blue-700", texto: "Publicando…" },
  success: { cor: "bg-green-50 text-green-700", texto: "Publicado" },
  error: { cor: "bg-red-50 text-red-700", texto: "Erro" },
};

function CardPost({
  post,
  accounts,
  onAtualizado,
  onExcluido,
}: {
  post: FeedPostComDetalhes;
  accounts: Conta[];
  onAtualizado: (post: FeedPostComDetalhes) => void;
  onExcluido: (id: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);

  const midias = [...(post.feed_post_media ?? [])].sort((a, b) => a.position - b.position);
  const midia = midias[0];
  const contas = post.feed_post_accounts ?? [];
  const status = STATUS_INFO[post.status];
  const podeEditar = post.status === "pending";

  async function excluir() {
    const aviso =
      post.status === "success" || post.status === "publishing"
        ? "Essa publicação já foi enviada ao Instagram — excluir aqui só remove o registro do agendador, NÃO apaga o post lá. Excluir mesmo assim?"
        : "Excluir essa publicação agendada?";
    if (!confirm(aviso)) return;

    setExcluindo(true);
    setErroExclusao(null);
    try {
      await chamarApi(`/api/feed-posts/${post.id}`, { method: "DELETE" });
      onExcluido(post.id);
    } catch (err) {
      setErroExclusao(err instanceof Error ? err.message : "Erro ao excluir a publicação.");
      setExcluindo(false);
    }
  }

  if (editando) {
    return (
      <EditarPost
        post={post}
        accounts={accounts}
        onSalvo={(atualizado) => {
          onAtualizado(atualizado);
          setEditando(false);
        }}
        onCancelar={() => setEditando(false)}
      />
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl2 bg-white p-3 shadow-sm ring-1 ring-slate-200">
      {midia && <MiniaturaMidia url={midia.media_url} tipo={midia.media_type} />}

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-700">{formatarDataHora(post.scheduled_at)}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {post.source === "drive" && (
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                Drive
              </span>
            )}
            {post.media_type === "REELS" && (
              <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
                Reels
              </span>
            )}
            {post.media_type === "CAROUSEL" && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                Carrossel · {midias.length} itens
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.cor}`}>{status.texto}</span>
          </span>
        </div>
        <p className="truncate text-xs text-slate-500">
          {contas.map((c) => c.accounts.name).join(", ") || "Nenhuma conta"}
        </p>
        {post.caption && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{post.caption}</p>}
        {post.status === "error" && post.error_message && (
          <p className="mt-1 text-xs text-red-600">{post.error_message}</p>
        )}

        <div className="mt-2 flex items-center gap-3 border-t border-slate-100 pt-2">
          {podeEditar && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="text-xs font-medium text-slate-500 hover:text-brand-600"
            >
              Editar
            </button>
          )}
          <button
            type="button"
            onClick={excluir}
            disabled={excluindo}
            className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-60"
          >
            {excluindo ? "…" : "Excluir"}
          </button>
        </div>
        {erroExclusao && <p className="mt-1 text-xs text-red-600">{erroExclusao}</p>}
      </div>
    </div>
  );
}

// Formulário de edição inline — substitui o card enquanto está aberto.
// Só edita legenda, data/horário e contas-alvo (não dá pra trocar a mídia
// por aqui). Só é chamado com posts 'pending', então nem tenta lidar com
// os outros status.
function EditarPost({
  post,
  accounts,
  onSalvo,
  onCancelar,
}: {
  post: FeedPostComDetalhes;
  accounts: Conta[];
  onSalvo: (post: FeedPostComDetalhes) => void;
  onCancelar: () => void;
}) {
  const [caption, setCaption] = useState(post.caption);
  const [accountIds, setAccountIds] = useState<string[]>(
    (post.feed_post_accounts ?? []).map((c) => c.account_id)
  );
  const [dataHora, setDataHora] = useState(paraCampoDataHora(post.scheduled_at));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function alternarConta(id: string) {
    setAccountIds((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function salvar() {
    setErro(null);

    if (accountIds.length === 0) {
      setErro("Escolha ao menos uma conta de destino.");
      return;
    }
    if (!dataHora) {
      setErro("Escolha a data e o horário do agendamento.");
      return;
    }
    const scheduledAt = new Date(dataHora);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      setErro("A data/horário do agendamento precisa ser no futuro.");
      return;
    }

    setSalvando(true);
    try {
      const json = await chamarApi(`/api/feed-posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption,
          scheduledAt: scheduledAt.toISOString(),
          accountIds,
        }),
      });
      onSalvo(json.post);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao salvar a publicação.");
    } finally {
      setSalvando(false);
    }
  }

  const midias = [...(post.feed_post_media ?? [])].sort((a, b) => a.position - b.position);
  const midia = midias[0];

  return (
    <div className="rounded-xl2 bg-white p-3 shadow-sm ring-2 ring-brand-300">
      <div className="flex items-start gap-3">
        {midia && <MiniaturaMidia url={midia.media_url} tipo={midia.media_type} />}
        <p className="pt-1.5 text-xs text-slate-400">
          A mídia não dá pra trocar por aqui — só legenda, contas e horário. Pra trocar a mídia,
          exclua e crie de novo.
        </p>
      </div>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Legenda</span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            disabled={salvando}
            rows={3}
            placeholder="Legenda do post (opcional)"
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">
            Contas ({accountIds.length === 0 ? "nenhuma selecionada" : `${accountIds.length} selecionada(s)`})
          </span>
          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-slate-300 p-1.5">
            {accounts.map((conta) => (
              <label
                key={conta.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={accountIds.includes(conta.id)}
                  onChange={() => alternarConta(conta.id)}
                  disabled={salvando}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-slate-700">
                  {conta.name}
                  {conta.ig_username ? ` (@${conta.ig_username})` : ""}
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Data e horário</span>
          <input
            type="datetime-local"
            value={dataHora}
            onChange={(e) => setDataHora(e.target.value)}
            disabled={salvando}
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm sm:w-1/2"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {salvando ? "Salvando…" : "Salvar"}
          </button>
          <button
            type="button"
            onClick={onCancelar}
            disabled={salvando}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>

        {erro && <p className="text-xs text-red-600">{erro}</p>}
      </div>
    </div>
  );
}

function MiniaturaMidia({ url, tipo }: { url: string; tipo: string }) {
  if (tipo === "VIDEO") {
    return <video src={url} className="h-12 w-12 shrink-0 rounded-md object-cover" muted />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />;
}
