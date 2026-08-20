import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  trocarCodigoPorTokenCurto,
  trocarPorTokenLongaDuracao,
  listarPaginasGerenciadas,
  buscarContaInstagramDaPagina,
} from "@/lib/meta";
import type { PendingConnectionPage } from "@/types/database";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const erroMeta = searchParams.get("error_description") || searchParams.get("error");

  const site = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;

  if (erroMeta) {
    return NextResponse.redirect(`${site}/contas?erro=${encodeURIComponent(erroMeta)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${site}/contas?erro=${encodeURIComponent("Resposta inválida do Facebook.")}`);
  }

  const admin = createAdminClient();

  const { data: estadoValido } = await admin
    .from("oauth_states")
    .select("state")
    .eq("state", state)
    .maybeSingle();

  if (!estadoValido) {
    return NextResponse.redirect(
      `${site}/contas?erro=${encodeURIComponent("Sessão de conexão expirada, clique em Adicionar conta de novo.")}`
    );
  }
  await admin.from("oauth_states").delete().eq("state", state);

  try {
    const tokenCurto = await trocarCodigoPorTokenCurto(code);
    const tokenLongo = await trocarPorTokenLongaDuracao(tokenCurto);
    const paginas = await listarPaginasGerenciadas(tokenLongo);

    const candidatas: PendingConnectionPage[] = [];
    for (const pagina of paginas) {
      const ig = await buscarContaInstagramDaPagina(pagina.id, pagina.access_token);
      if (ig) {
        candidatas.push({
          page_id: pagina.id,
          name: pagina.name,
          ig_user_id: ig.id,
          ig_username: ig.username ?? null,
          page_access_token: pagina.access_token,
        });
      }
    }

    if (candidatas.length === 0) {
      return NextResponse.redirect(
        `${site}/contas?erro=${encodeURIComponent(
          "Nenhuma das Páginas dessa conta do Facebook tem um perfil profissional do Instagram vinculado."
        )}`
      );
    }

    const pendingId = randomUUID();
    await admin.from("pending_connections").insert({ id: pendingId, payload: candidatas });

    // limpeza oportunista de handshakes velhos (> 1h)
    await admin
      .from("pending_connections")
      .delete()
      .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    return NextResponse.redirect(`${site}/contas/conectar?pid=${pendingId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao conectar com o Facebook.";
    return NextResponse.redirect(`${site}/contas?erro=${encodeURIComponent(msg)}`);
  }
}
