import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buscarFotoDePerfilInstagram } from "@/lib/meta";

export const dynamic = "force-dynamic";

// Endpoint leve, só de leitura, chamado pelo navegador DEPOIS que a tela de
// "/contas" já apareceu (ver ListaContas.tsx) — assim a foto de perfil de
// cada conta nunca atrasa o primeiro carregamento do app. A URL do Meta
// expira com o tempo, então não vale a pena guardar no banco: é buscada de
// novo a cada chamada. Uma conta com token vencido ou instável não deve
// travar as demais — só fica sem foto.
export async function GET() {
  const admin = createAdminClient();
  const { data: contas } = await admin
    .from("accounts")
    .select("id, ig_user_id, page_access_token");

  const avatares: Record<string, string | null> = {};
  await Promise.all(
    ((contas ?? []) as { id: string; ig_user_id: string; page_access_token: string }[]).map(
      async (conta) => {
        try {
          avatares[conta.id] = await buscarFotoDePerfilInstagram(
            conta.ig_user_id,
            conta.page_access_token
          );
        } catch {
          avatares[conta.id] = null;
        }
      }
    )
  );

  return NextResponse.json({ avatares });
}
