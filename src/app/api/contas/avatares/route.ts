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

const PREFIXO_NOSSO_STORAGE = "/storage/v1/object/public/story-media/avatares/";

// Baixa a foto uma vez e guarda no Storage (30 dias de cache no navegador):
// as telas passam a carregar a foto do nosso servidor, sem depender do
// link temporário do Instagram. Se der qualquer erro, devolve null e quem
// chama segue com o link do Instagram, como antes.
async function guardarNoStorage(admin: ReturnType<typeof createAdminClient>, contaId: string, url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const tipo = res.headers.get("content-type") || "image/jpeg";
    if (!tipo.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 2_000_000) return null;
    const caminho = `avatares/${contaId}.jpg`;
    const { error } = await admin.storage.from("story-media").upload(caminho, bytes, {
      contentType: tipo,
      upsert: true,
      cacheControl: "2592000",
    });
    if (error) return null;
    const { data } = admin.storage.from("story-media").getPublicUrl(caminho);
    return `${data.publicUrl}?v=${Date.now()}`;
  } catch {
    return null;
  }
}

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
      // Só vale o cache se a foto já está guardada no NOSSO Storage (o link
      // direto do Instagram vence em poucos dias e quebrava a foto).
      const cacheValido =
        conta.avatar_atualizado_em &&
        agora - new Date(conta.avatar_atualizado_em).getTime() < CACHE_MS &&
        !!conta.avatar_url &&
        conta.avatar_url.includes(PREFIXO_NOSSO_STORAGE);

      if (cacheValido) {
        avatares[conta.id] = conta.avatar_url;
        return;
      }

      try {
        const urlInstagram = await buscarFotoDePerfilInstagram(conta.ig_user_id, conta.page_access_token);
        const url = (await guardarNoStorage(admin, conta.id, urlInstagram)) ?? urlInstagram;
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
