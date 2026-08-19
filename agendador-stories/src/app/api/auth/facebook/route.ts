import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { montarUrlAutorizacaoFacebook } from "@/lib/meta";

// Início do fluxo "Adicionar conta": gera um state anti-CSRF e manda o usuário
// pra tela de login/permissões do Facebook.
export async function GET() {
  const state = randomUUID();
  const admin = createAdminClient();
  await admin.from("oauth_states").insert({ state });

  const url = montarUrlAutorizacaoFacebook(state);
  return NextResponse.redirect(url);
}
