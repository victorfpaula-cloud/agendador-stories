import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buscarFotoDePerfilInstagram } from "@/lib/meta";

export const dynamic = "force-dynamic";

// Quantos dias uma foto de perfil cacheada vale antes de buscar de novo na
// Graph API — antes, essa rota buscava a foto de TODAS as contas toda vez
// que a tela de contas abria (gastando banda à toa). A foto de perfil quase
// nunca muda, então cachear por um tempo é seguro: se a URL do Meta em si
// expirar antes dos 30 dias, o <img onError> do navegador já cai sozinho
// pro círculo com a inicial do nome (ver ContaCard em ListaContas.tsx).
const CACHE_DIAS = 30;
const CACHE_MS = CACHE_DIAS * 24 * 60 * 60 * 1000;

interface ContaComCache {
  id: string;
  ig_user_id: string;
  page_access_token: string;
  avatar_url: string | null;
  avatar_atualizado_em: string | null;
}

// Endpoint leve, só de leitura, chamado pelo navegador DEPOIS que a tela de
// "/contas" já apareceu (ver ListaContas.tsx) — assim a foto de perfil de
// cada conta nunca atrasa o primeiro carregamento do app. Uma conta com
// token vencido ou instável não deve travar as demais — só fica sem foto
// (ou mantém a última cacheada, se tiver uma).
export async function GET() {
  const admin = createAdminClient();
  const { data: contas } = await admin
    .from("accounts")
    .select("id, ig_user_id, page_access_token, avatar_url, avatar_atualizado_em");

  const agora = Date.now();
  const avatares: Record<string, string | null> = {};

  await Promise.all(
    ((contas ?? []) as ContaComCache[]).map(async (conta) => {
      const cacheValido =
        conta.avatar_atualizado_em && agora - new Date(conta.avatar_atualizado_em).getTime() < CACHE_MS;

      if (cacheValido) {
        avatares[conta.id] = conta.avatar_url;
        return;
      }

      try {
        const url = await buscarFotoDePerfilInstagram(conta.ig_user_id, conta.page_access_token);
        avatares[conta.id] = url;
        await admin
          .from("accounts")
          .update({ avatar_url: url, avatar_atualizado_em: new Date().toISOString() })
          .eq("id", conta.id);
      } catch {
        // Falha ao buscar de novo — se tinha algo cacheado (mesmo vencido),
        // melhor mostrar isso do que nada.
        avatares[conta.id] = conta.avatar_url ?? null;
      }
    })
  );

  return NextResponse.json({ avatares });
}
