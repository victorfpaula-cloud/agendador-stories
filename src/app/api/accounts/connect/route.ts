import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listarPaginasGerenciadas,
  buscarContaInstagramDaPagina,
} from "@/lib/meta";
import type { PendingConnectionPage } from "@/types/database";

// Endpoint que usa um access token pessoal (sem OAuth)
export async function GET(req: NextRequest) {
  const site = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!token) {
    return NextResponse.redirect(
      `${site}/contas?erro=${encodeURIComponent(
        "Token de acesso não configurado. Contate o administrador."
      )}`
    );
  }

  try {
    // Usa o token pessoal para listar as páginas
    const paginas = await listarPaginasGerenciadas(token);

    if (!paginas || paginas.length === 0) {
      return NextResponse.redirect(
        `${site}/contas?erro=${encodeURIComponent(
          "Nenhuma página encontrada com este token."
        )}`
      );
    }

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
          "Nenhuma das Páginas tem um perfil profissional do Instagram vinculado."
        )}`
      );
    }

    const admin = createAdminClient();
    const pendingId = randomUUID();
    await admin.from("pending_connections").insert({ id: pendingId, payload: candidatas });

    // Limpeza de conexões antigas (> 1h)
    await admin
      .from("pending_connections")
      .delete()
      .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    return NextResponse.redirect(`${site}/contas/conectar?pid=${pendingId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao conectar conta.";
    return NextResponse.redirect(`${site}/contas?erro=${encodeURIComponent(msg)}`);
  }
}
