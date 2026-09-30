import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Achado em 30/09/2026: antes, a lista abaixo era conferida com startsWith, e
// como toda rota começa com "/", o app inteiro ficava público (inclusive
// excluir conta e as rotas que usam a chave de administrador do banco).
// Agora "/" e "/login" valem só exatos. Tudo em /api/cron/ continua sem
// sessão porque quem chama é o pg_cron — e cada uma dessas rotas confere o
// x-cron-secret sozinha.
const PAGINAS_PUBLICAS = new Set(["/", "/login"]);
const PREFIXOS_PUBLICOS = ["/api/cron/"];

// O projeto do Supabase é compartilhado com outros apps (existe, por
// exemplo, um usuário revisor do ShoppingHub), então estar logado não basta
// — só entra quem está nessa lista. ADMIN_EMAILS (separado por vírgula) na
// Vercel troca a lista; sem ela vale o padrão abaixo.
function emailsPermitidos(): string[] {
  const lista = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(",") : ["victorfpaula@gmail.com"];
  return lista.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PAGINAS_PUBLICAS.has(pathname) || PREFIXOS_PUBLICOS.some((prefixo) => pathname.startsWith(prefixo))) {
    return NextResponse.next();
  }

  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          res.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // getUser() confere o token de verdade com o Supabase; getSession() só lê o
  // cookie, que dá pra forjar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const autorizado = !!user?.email && emailsPermitidos().includes(user.email.toLowerCase());

  if (!autorizado) {
    // Chamadas de API (fetch do navegador) precisam de uma resposta JSON com
    // status 401, não de um redirect pra página de login em HTML — senão o
    // app trava tentando interpretar HTML como JSON e nada é salvo.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { erro: "Sessão expirada. Atualize a página e faça login de novo." },
        { status: user ? 403 : 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  // Ícone, apple-icon e o manifest do PWA (gerados pelo Next a partir de
  // src/app/icon.png, apple-icon.png e manifest.ts) precisam ser servidos
  // sem exigir sessão — são pedidos pelo navegador/sistema ao instalar o
  // app na tela de início, antes de qualquer login existir. Sem essa
  // exclusão, esse pedido caía no redirect pra /login e o ícone/splash não
  // aparecia.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|loading-icon.png|manifest.webmanifest).*)",
  ],
};
