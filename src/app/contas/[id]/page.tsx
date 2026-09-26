import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import type { Account, PublishLog, ScheduleSlot } from "@/types/database";
import WeekEditor from "./WeekEditor";
import DuplicarRotina from "./DuplicarRotina";
import ContaTabs from "./ContaTabs";

export const dynamic = "force-dynamic";

export default async function ContaPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: conta } = await admin.from("accounts").select("*").eq("id", params.id).maybeSingle();
  if (!conta) notFound();

  // Lista das outras contas, pra alimentar o seletor de "Duplicar rotina de…".
  const { data: outrasContas } = await admin
    .from("accounts")
    .select("id, name")
    .neq("id", params.id)
    .order("name", { ascending: true });

  const { data: slots } = await admin
    .from("schedule_slots")
    .select("*")
    .eq("account_id", params.id)
    .order("time_of_day", { ascending: true });

  // Status de publicação de hoje (pra bolinha colorida): só busca os logs do dia
  // atual, já que é o único dia em que "aguardando/publicado/erro" faz sentido —
  // dias futuros ainda não tiveram nenhuma tentativa.
  const { diaSemanaIso, dataISO } = agoraEmSaoPaulo();
  const { data: logs } = await admin
    .from("publish_log")
    .select("*")
    .eq("account_id", params.id)
    .eq("scheduled_for", dataISO)
    .order("created_at", { ascending: true });

  // Ordenado do mais antigo pro mais novo, então se um horário teve mais de
  // uma tentativa hoje (ex: erro às 10:05 e sucesso de novo às 11:30 depois
  // de mudar o horário), a última tentativa é a que "vence" e aparece na bolinha.
  const logsHoje: Record<string, "success" | "error"> = {};
  for (const log of (logs ?? []) as PublishLog[]) {
    // "publishing" é só o instante entre reivindicar o horário e terminar de
    // publicar — se a tela carregar bem nesse meio-tempo (raro, dura no
    // máximo alguns segundos), trata como "ainda não tentou" em vez de
    // quebrar a bolinha de status.
    if (log.slot_id && (log.status === "success" || log.status === "error")) {
      logsHoje[log.slot_id] = log.status;
    }
  }

  // "Containerzinho fantasma" do Story Engine nos dias da semana (pedido do
  // Victor em 26/09/2026) — mostra os horários configurados lá (categoria
  // ativa + horário ativo), sem imagem própria (a mídia só é escolhida na
  // hora que o robô roda), só como aviso visual do que vai sair naquele
  // dia. Duas consultas simples em vez de um join embutido de propósito:
  // sem tipos gerados do banco, o supabase-js infere embed como array
  // mesmo sendo N:1, o que já deu erro de build antes (ver
  // /api/cron/gerar-stories-ciclo).
  const { data: storyEngineHorarios } = await admin
    .from("story_ciclo_horario")
    .select("id, horario, category_id")
    .eq("is_active", true);

  const { data: storyEngineCategorias } = await admin
    .from("story_ciclo_categoria")
    .select("id, nome, dias_semana")
    .eq("account_id", params.id)
    .eq("ativa", true);

  const categoriasPorId = new Map<string, { nome: string; dias_semana: number[] }>(
    ((storyEngineCategorias ?? []) as { id: string; nome: string; dias_semana: number[] }[]).map((c) => [
      c.id,
      { nome: c.nome, dias_semana: c.dias_semana },
    ])
  );

  const storyEngineSlots = ((storyEngineHorarios ?? []) as { id: string; horario: string; category_id: string }[])
    .map((h) => {
      const categoria = categoriasPorId.get(h.category_id);
      if (!categoria) return null; // categoria de outra conta, ou pausada
      return { id: h.id, horario: h.horario, categoriaNome: categoria.nome, diasSemana: categoria.dias_semana };
    })
    .filter((s): s is { id: string; horario: string; categoriaNome: string; diasSemana: number[] } => s !== null);

  const { data: storyEnginePostsHoje } = await admin
    .from("story_ciclo_posts")
    .select("horario_id, status")
    .eq("account_id", params.id)
    .eq("dia", dataISO);

  const storyEngineStatusHoje: Record<string, "success" | "error"> = {};
  for (const post of (storyEnginePostsHoje ?? []) as { horario_id: string | null; status: string }[]) {
    if (post.horario_id && (post.status === "success" || post.status === "error")) {
      storyEngineStatusHoje[post.horario_id] = post.status;
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/contas" className="text-sm text-slate-500 hover:underline">
            ← Todas as contas
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{(conta as Account).name}</h1>
          <p className="text-sm text-slate-500">
            {(conta as Account).ig_username ? `@${(conta as Account).ig_username}` : "Instagram conectado"} ·
            rotina semanal de Stories
          </p>
          <div className="mt-3">
            <DuplicarRotina
              contaAtualId={(conta as Account).id}
              contaAtualNome={(conta as Account).name}
              outrasContas={(outrasContas ?? []) as { id: string; name: string }[]}
            />
          </div>
        </div>
        <a
          href="/api/accounts/connect"
          className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-brand-400 hover:text-brand-600"
        >
          Reconectar
        </a>
      </div>

      <ContaTabs accountId={(conta as Account).id} />

      <WeekEditor
        accountId={(conta as Account).id}
        initialSlots={(slots ?? []) as ScheduleSlot[]}
        diaHoje={diaSemanaIso}
        logsHoje={logsHoje}
        storyEngineSlots={storyEngineSlots}
        storyEngineStatusHoje={storyEngineStatusHoje}
      />
    </main>
  );
}
