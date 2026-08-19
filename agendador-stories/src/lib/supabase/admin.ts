import { createClient } from "@supabase/supabase-js";

/**
 * Cliente com a service role key — acesso total ao banco e ao storage,
 * ignorando RLS. Só pode ser usado em código que roda no servidor
 * (Route Handlers, Server Components, Server Actions). NUNCA importar
 * este arquivo em um componente marcado "use client".
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Faltam variáveis de ambiente do Supabase (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
