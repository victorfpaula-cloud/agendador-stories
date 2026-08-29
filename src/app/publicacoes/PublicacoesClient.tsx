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
              <CardPost key={post.id} post={post} />
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
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [accountId, setAccountId] = useState("");
  const [dataHora, setDataHora] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function publicar() {
    setErro(null);

    if (!file) {
      setErro("Escolha uma foto ou vídeo.");
      return;
    }
    if (!accountId) {
      setErro("Escolha a conta de destino.");
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
      setProgresso("Enviando mídia…");
      const midia = await enviarMidiaDireto(file, { bucket: BUCKET, accountId });

      setProgresso("Agendando…");
      const json = await chamarApi("/api/feed-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption,
          scheduledAt: scheduledAt.toISOString(),
          accountId,
          media: midia,
        }),
      });

      onCriado(json.post);
      setFile(null);
      setCaption("");
      setAccountId("");
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
          <span className="mb-1 block text-xs font-medium text-slate-500">Foto ou vídeo</span>
          <input
            type="file"
            accept="image/*,video/*"
            disabled={enviando}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
          {file && <span className="mt-1 block truncate text-xs text-slate-400">{file.name}</span>}
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

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-500">Conta</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={enviando}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            >
              <option value="">Escolha a conta</option>
              {accounts.map((conta) => (
                <option key={conta.id} value={conta.id}>
                  {conta.name}
                  {conta.ig_username ? ` (@${conta.ig_username})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-500">Data e horário</span>
            <input
              type="datetime-local"
              value={dataHora}
              onChange={(e) => setDataHora(e.target.value)}
              disabled={enviando}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </label>
        </div>

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

function CardPost({ post }: { post: FeedPostComDetalhes }) {
  const midia = [...(post.feed_post_media ?? [])].sort((a, b) => a.position - b.position)[0];
  const contas = post.feed_post_accounts ?? [];
  const status = STATUS_INFO[post.status];

  return (
    <div className="flex items-start gap-3 rounded-xl2 bg-white p-3 shadow-sm ring-1 ring-slate-200">
      {midia && <MiniaturaMidia url={midia.media_url} tipo={midia.media_type} />}

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-700">{formatarDataHora(post.scheduled_at)}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.cor}`}>
            {status.texto}
          </span>
        </div>
        <p className="truncate text-xs text-slate-500">
          {contas.map((c) => c.accounts.name).join(", ") || "Nenhuma conta"}
        </p>
        {post.caption && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{post.caption}</p>}
        {post.status === "error" && post.error_message && (
          <p className="mt-1 text-xs text-red-600">{post.error_message}</p>
        )}
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
