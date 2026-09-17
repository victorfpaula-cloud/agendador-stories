import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import type { Account, StoryDriveConfig, StoryDriveExecucao, StoryPost } from "@/types/database";
import ContaTabs from "../ContaTabs";
import StoryDriveConfigClient from "./StoryDriveConfigClient";

// Story Automático via Drive — irmão da Automação do Drive do Feed, mas
// pra Stories: até 5 arquivos por dia, cada um com seu próprio horário, sem
// carrossel nem legenda (ver src/lib/storyDriveIngestao.ts pro porquê). Se
// algo aqui quebrar, não afeta em nada as outras contas nem os outros
// motores de publicação — só essa telinha fica indisponível.
export const dynamic = "force-dynamic";

export default async function StoryDriveConfigPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: conta } = await admin.from("accounts").select("*").eq("id", params.id).maybeSingle();
  if (!conta) notFound();

  const { data: config, error } = await admin
    .from("story_drive_config")
    .select("*")
    .eq("account_id", params.id)
    .maybeSingle();

  const { data: ultimaExecucao } = await admin
    .from("story_drive_execucoes")
    .select("*")
    .eq("account_id", params.id)
    .order("executado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { dataISO } = agoraEmSaoPaulo();
  const inicioDiaUTC = new Date(`${dataISO}T00:00:00-03:00`).toISOString();
  const fimDiaUTC = new Date(`${dataISO}T23:59:59-03:00`).toISOString();
  const { data: storiesHoje } = await admin
    .from("story_posts")
    .select("*")
    .eq("account_id", params.id)
    .gte("scheduled_at", inicioDiaUTC)
    .lte("scheduled_at", fimDiaUTC)
    .order("scheduled_at", { ascending: true });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4">
        <Link href="/contas" className="text-sm text-slate-500 hover:underline">
          ← Todas as contas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{(conta as Account).name}</h1>
        <p className="text-sm text-slate-500">
          O robô confere a pasta do dia a cada 30 minutos e publica cada Story no horário configurado.
        </p>
      </div>

      <ContaTabs accountId={(conta as Account).id} />

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          Não consegui ler a configuração ({error.message}).
        </div>
      )}

      <StoryDriveConfigClient
        accountId={params.id}
        initialConfig={(config as StoryDriveConfig) ?? null}
        ultimaExecucao={(ultimaExecucao as StoryDriveExecucao) ?? null}
        initialStoriesHoje={(storiesHoje ?? []) as StoryPost[]}
      />
    </main>
  );
}
