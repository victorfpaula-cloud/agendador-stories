"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PendingConnectionPage } from "@/types/database";

export async function conectarPagina(formData: FormData) {
  const pendingId = String(formData.get("pendingId") ?? "");
  const pageId = String(formData.get("pageId") ?? "");

  const admin = createAdminClient();
  const { data: pending } = await admin
    .from("pending_connections")
    .select("payload")
    .eq("id", pendingId)
    .maybeSingle();

  if (!pending) {
    redirect(`/contas?erro=${encodeURIComponent("Sessão de conexão expirada, tente novamente.")}`);
  }

  const paginas = pending!.payload as PendingConnectionPage[];
  const pagina = paginas.find((p) => p.page_id === pageId);

  if (!pagina) {
    redirect(`/contas?erro=${encodeURIComponent("Página não encontrada, tente novamente.")}`);
  }

  await admin.from("accounts").upsert(
    {
      name: pagina!.name,
      page_id: pagina!.page_id,
      ig_user_id: pagina!.ig_user_id,
      ig_username: pagina!.ig_username,
      page_access_token: pagina!.page_access_token,
      token_obtained_at: new Date().toISOString(),
      is_active: true,
    },
    { onConflict: "page_id" }
  );

  revalidatePath("/contas");
  redirect("/contas");
}
