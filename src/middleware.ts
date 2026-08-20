import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const ROTAS_PUBLICAS = ["/", "/login", "/api/cron/run"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (ROTAS_PUBLICAS.some((rota) => pathname.startsWith(rota))) {
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

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // Chamadas de API (fetch do navegador) precisam de uma resposta JSON com
    // status 401, não de um redirect pra página de login em HTML — senão o
    // app trava tentando interpretar HTML como JSON e nada é salvo.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { erro: "Sessão expirada. Atualize a página e faça login de novo." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
