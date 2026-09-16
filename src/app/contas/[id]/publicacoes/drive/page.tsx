import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Account, DriveConfig, DriveExecucao } from "@/types/database";
import DriveConfigClient from "./DriveConfigClient";

// Sub-módulo do Drive (passo 6 = configuração, passo 7 = o robô de verdade)
// — desde o redesign de 16/09/2026, a automação vale só pra essa conta
// (drive_config tem uma linha por account_id). Se algo aqui quebrar, não
// afeta em nada as outras contas nem o motor de publicação — só essa
// telinha fica indisponível. O robô roda 1x por dia (ver
// supabase/drive-cron.sql) pra cada conta configurada e registra o
// resultado em `drive_execucoes`, mostrado embaixo do formulário pra Victor
// acompanhar sem precisar olhar log nenhum da Vercel.
export const dynamic = "force-dynamic";

export default async function DriveConfigDaContaPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: conta } = await admin.from("accounts").select("*").eq("id", params.id).maybeSingle();
  if (!conta) notFound();

  const { data: config, error } = await admin
    .from("drive_config")
    .select("*")
    .eq("account_id", params.id)
    .maybeSingle();

  const { data: ultimaExecucao } = await admin
    .from("drive_execucoes")
    .select("*")
    .eq("account_id", params.id)
    .order("executado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <Link href={`/contas/${params.id}/publicacoes`} className="text-sm text-slate-500 hover:underline">
          ← Publicações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          Automação do Drive — {(conta as Account).name}
        </h1>
        <p className="text-sm text-slate-500">
          O robô confere a pasta do dia uma vez por dia (às 11h) e cria o post automaticamente pra essa conta.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          Não consegui ler a configuração ({error.message}).
        </div>
      )}

      <DriveConfigClient
        accountId={params.id}
        initialConfig={(config as DriveConfig) ?? null}
        ultimaExecucao={(ultimaExecucao as DriveExecucao) ?? null}
      />
    </main>
  );
}
