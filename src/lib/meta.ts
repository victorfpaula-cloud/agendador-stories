// Funções de integração com a Graph API do Meta (Facebook Login for Business +
// Instagram Content Publishing). Documentação oficial:
// https://developers.facebook.com/docs/instagram-platform

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || "v20.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

class MetaApiError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = "MetaApiError";
  }
}

async function graphFetch(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET") {
  const url = new URL(`${GRAPH_BASE}${path}`);

  let body: URLSearchParams | undefined;
  if (method === "GET") {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  } else {
    body = new URLSearchParams(params);
  }

  const res = await fetch(url.toString(), {
    method,
    body,
    headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || json?.error) {
    throw new MetaApiError(json?.error?.message || `Erro na Graph API (HTTP ${res.status})`, json?.error);
  }

  return json;
}

// ---------- OAuth ----------

export function montarUrlAutorizacaoFacebook(state: string) {
  const url = new URL("https://www.facebook.com/v20.0/dialog/oauth");
  url.searchParams.set("client_id", process.env.FACEBOOK_APP_ID!);
  url.searchParams.set("redirect_uri", process.env.FACEBOOK_REDIRECT_URI!);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "public_profile");
  return url.toString();
}

export async function trocarCodigoPorTokenCurto(code: string) {
  const json = await graphFetch("/oauth/access_token", {
    client_id: process.env.FACEBOOK_APP_ID!,
    client_secret: process.env.FACEBOOK_APP_SECRET!,
    redirect_uri: process.env.FACEBOOK_REDIRECT_URI!,
    code,
  });
  return json.access_token as string;
}

export async function trocarPorTokenLongaDuracao(shortLivedToken: string) {
  const json = await graphFetch("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.FACEBOOK_APP_ID!,
    client_secret: process.env.FACEBOOK_APP_SECRET!,
    fb_exchange_token: shortLivedToken,
  });
  return json.access_token as string;
}

interface PaginaFacebook {
  id: string;
  name: string;
  access_token: string;
}

export async function listarPaginasGerenciadas(userAccessToken: string): Promise<PaginaFacebook[]> {
  const json = await graphFetch("/me/accounts", {
    fields: "id,name,access_token",
    access_token: userAccessToken,
    limit: "100",
  });
  return (json.data ?? []) as PaginaFacebook[];
}

export async function buscarContaInstagramDaPagina(pageId: string, pageAccessToken: string) {
  const json = await graphFetch(`/${pageId}`, {
    fields: "instagram_business_account{id,username}",
    access_token: pageAccessToken,
  });
  const conta = json.instagram_business_account as { id: string; username?: string } | undefined;
  return conta ?? null;
}

// ---------- Publicação de Stories ----------

interface CriarContainerParams {
  igUserId: string;
  pageAccessToken: string;
  mediaUrl: string;
  mediaType: "IMAGE" | "VIDEO";
}

export async function criarContainerDeStory({
  igUserId,
  pageAccessToken,
  mediaUrl,
  mediaType,
}: CriarContainerParams): Promise<string> {
  const params: Record<string, string> = {
    media_type: "STORIES",
    access_token: pageAccessToken,
  };

  if (mediaType === "VIDEO") {
    params.video_url = mediaUrl;
  } else {
    params.image_url = mediaUrl;
  }

  const json = await graphFetch(`/${igUserId}/media`, params, "POST");
  return json.id as string;
}

export async function statusDoContainer(containerId: string, pageAccessToken: string) {
  const json = await graphFetch(`/${containerId}`, {
    fields: "status_code",
    access_token: pageAccessToken,
  });
  return json.status_code as string; // EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED
}

/** Vídeos precisam ser processados pelo Meta antes de publicar; isso espera até ficar pronto. */
export async function esperarContainerFicarPronto(containerId: string, pageAccessToken: string, timeoutMs = 60_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const status = await statusDoContainer(containerId, pageAccessToken);
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new MetaApiError(`Processamento da mídia falhou (status: ${status})`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new MetaApiError("Tempo esgotado esperando o processamento da mídia (vídeo).");
}

export async function publicarContainer(igUserId: string, containerId: string, pageAccessToken: string) {
  const json = await graphFetch(
    `/${igUserId}/media_publish`,
    { creation_id: containerId, access_token: pageAccessToken },
    "POST"
  );
  return json.id as string;
}

export async function publicarStory(params: CriarContainerParams): Promise<string> {
  const containerId = await criarContainerDeStory(params);

  if (params.mediaType === "VIDEO") {
    await esperarContainerFicarPronto(containerId, params.pageAccessToken);
  }

  return publicarContainer(params.igUserId, containerId, params.pageAccessToken);
}

export { MetaApiError };
