import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Cliente de sessão (login/logout do painel), usado em Server Components
 * e Route Handlers. Usa a anon key + cookies do usuário — só enxerga o que
 * a policy de auth permite (aqui, usamos só pra saber se o admin está logado).
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // chamado a partir de um Server Component sem permissão de escrita;
            // o middleware cuida de manter a sessão atualizada nesses casos.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // idem acima
          }
        },
      },
    }
  );
}
