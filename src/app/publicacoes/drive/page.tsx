import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DriveConfig } from "@/types/database";
import DriveConfigClient from "./DriveConfigClient";

// Sub-módulo do Drive (passo 6) — telinha de configuração isolada, numa rota
// própria (/publicacoes/drive), separada da composição manual de post. Se
// algo aqui quebrar, não afeta em nada a página de Publicações nem o motor
// de publicação — só essa telinha fica indisponível. Ainda não roda nada
// sozinho: é só a configuração (pasta-mãe do Drive, contas-alvo, horário de
// publicação). O cron diário que lê o Drive de verdade chega no passo 7.
export const dynamic = "force-dynamic";

export default async function DriveConfigPage() {
  const admin = createAdminClient();

  const { data: contas } = await admin
    .from("accounts")
    .select("id, name, ig_username")
    .eq("is_active", true)
    .order("name", { ascending: true });

  const { data: config, error } = await admin.from("drive_config").select("*").eq("id", 1).maybeSingle();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <Link href="/publicacoes" className="text-sm text-slate-500 hover:underline">
          ← Publicações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Automação do Drive</h1>
        <p className="text-sm text-slate-500">
          Só configuração por enquanto — o robô que lê o Drive todo dia ainda não está ligado.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          Não consegui ler a configuração ({error.message}).
        </div>
      )}

      <DriveConfigClient accounts={contas ?? []} initialConfig={(config as DriveConfig) ?? null} />
    </main>
  );
}
