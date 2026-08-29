import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedPostMedia } from "@/types/database";

// Editar/excluir uma publicação agendada — rotas novas e isoladas, nada do
// motor de publicação nem do cron foi tocado.
//
// Editar só é permitido enquanto o post ainda está 'pending' (nenhuma
// tentativa de publicação feita ainda) — depois disso, mexer no conteúdo no
// meio do caminho criaria confusão sobre o que realmente foi publicado (ou
// publicado em qual conta). Não dá pra trocar a mídia por aqui, só legenda,
// data/horário e contas-alvo — trocar a mídia é escopo maior, fica pra uma
// próxima se precisar.
//
// Excluir é permitido em qualquer status: é só um registro no nosso banco,
// não desfaz nada que já tenha ido ao ar no Instagram (a tela já avisa isso
// quando o post já foi publicado).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const body = await req.json().catch(() => null);

  const { data: postAtual, error: erroBusca } = await admin
    .from("feed_posts")
    .select("id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (erroBusca || !postAtual) {
    return NextResponse.json({ erro: "Publicação não encontrada." }, { status: 404 });
  }
  if (postAtual.status !== "pending") {
    return NextResponse.json(
      { erro: "Só dá pra editar publicações que ainda não começaram a publicar." },
      { status: 400 }
    );
  }

  const caption = String(body?.caption ?? "");
  const scheduledAt = String(body?.scheduledAt ?? "");
  const accountIds: string[] = Array.isArray(body?.accountIds)
    ? body.accountIds.filter((x: unknown) => typeof x === "string" && x)
    : [];

  if (accountIds.length === 0) {
    return NextResponse.json({ erro: "Escolha ao menos uma conta." }, { status: 400 });
  }
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
    return NextResponse.json({ erro: "Escolha uma data e horário válidos." }, { status: 400 });
  }
  if (new Date(scheduledAt).getTime() <= Date.now()) {
    return NextResponse.json({ erro: "A data/horário do agendamento precisa ser no futuro." }, { status: 400 });
  }

  const { data: contasEncontradas } = await admin.from("accounts").select("id").in("id", accountIds);
  if (!contasEncontradas || contasEncontradas.length !== accountIds.length) {
    return NextResponse.json({ erro: "Uma ou mais contas selecionadas não foram encontradas." }, { status: 404 });
  }

  const { error: erroUpdate } = await admin
    .from("feed_posts")
    .update({ caption, scheduled_at: scheduledAt })
    .eq("id", params.id);

  if (erroUpdate) {
    return NextResponse.json({ erro: erroUpdate.message }, { status: 500 });
  }

  // Refaz a lista de contas-alvo do zero — mais simples e seguro do que
  // calcular a diferença (quem entrou, quem saiu).
  await admin.from("feed_post_accounts").delete().eq("feed_post_id", params.id);
  const { error: erroContas } = await admin
    .from("feed_post_accounts")
    .insert(accountIds.map((accountId) => ({ feed_post_id: params.id, account_id: accountId })));

  if (erroContas) {
    return NextResponse.json({ erro: erroContas.message }, { status: 500 });
  }

  const { data: postCompleto, error: erroFetch } = await admin
    .from("feed_posts")
    .select("*, feed_post_media(*), feed_post_accounts(*, accounts(id, name, ig_username))")
    .eq("id", params.id)
    .single();

  if (erroFetch || !postCompleto) {
    return NextResponse.json(
      { erro: "Publicação salva, mas houve erro ao carregar os detalhes." },
      { status: 500 }
    );
  }

  return NextResponse.json({ post: postCompleto });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: midias } = await admin
    .from("feed_post_media")
    .select("media_path")
    .eq("feed_post_id", params.id);

  const { error } = await admin.from("feed_posts").delete().eq("id", params.id);

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  // Limpa os arquivos do Storage também — best-effort, não falha a exclusão
  // se der algum problema aqui (o post já foi removido do banco de qualquer
  // jeito, o pior caso é um arquivo órfão no bucket).
  const paths = ((midias ?? []) as Pick<FeedPostMedia, "media_path">[])
    .map((m) => m.media_path)
    .filter(Boolean);
  if (paths.length > 0) {
    try {
      await admin.storage.from("feed-media").remove(paths);
    } catch {
      // Ignorado de propósito.
    }
  }

  return NextResponse.json({ ok: true });
}
