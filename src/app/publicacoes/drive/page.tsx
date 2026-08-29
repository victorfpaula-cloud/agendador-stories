import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DriveConfig, DriveExecucao } from "@/types/database";
import DriveConfigClient from "./DriveConfigClient";

// Sub-módulo do Drive (passo 6 = configuração, passo 7 = o robô de verdade)
// — telinha isolada, numa rota própria (/publicacoes/drive), separada da
// composição manual de post. Se algo aqui quebrar, não afeta em nada a
// página de Publicações nem o motor de publicação — só essa telinha fica
// indisponível. O robô roda 1x por dia (ver supabase/drive-cron.sql) e
// registra o resultado em `drive_execucoes`, mostrado embaixo do
// formulário pra Victor acompanhar sem precisar olhar log nenhum da Vercel.
export const dynamic = "force-dynamic";

export default async function DriveConfigPage() {
  const admin = createAdminClient();

  const { data: contas } = await admin
    .from("accounts")
    .select("id, name, ig_username")
    .eq("is_active", true)
    .order("name", { ascending: true });

  const { data: config, error } = await admin.from("drive_config").select("*").eq("id", 1).maybeSingle();

  const { data: ultimaExecucao } = await admin
    .from("drive_execucoes")
    .select("*")
    .order("executado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <Link href="/publicacoes" className="text-sm text-slate-500 hover:underline">
          ← Publicações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Automação do Drive</h1>
        <p className="text-sm text-slate-500">
          O robô confere a pasta do dia uma vez por dia (às 11h) e cria o post automaticamente.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          Não consegui ler a configuração ({error.message}).
        </div>
      )}

      <DriveConfigClient
        accounts={contas ?? []}
        initialConfig={(config as DriveConfig) ?? null}
        ultimaExecucao={(ultimaExecucao as DriveExecucao) ?? null}
      />
    </main>
  );
}
