import type { createAdminClient } from "@/lib/supabase/admin";

// "Dias fechados" (03/10/2026): datas em que uma conta não publica nada. Cada
// motor de publicação consulta isto antes de publicar. A data é sempre a de
// São Paulo (formato AAAA-MM-DD).

export const MENSAGEM_DIA_FECHADO = "Dia fechado — não publicado.";

export const chaveDiaFechado = (accountId: string, dia: string) => `${accountId}|${dia}`;

// Data (AAAA-MM-DD) no fuso de São Paulo de um instante ISO.
export function dataEmSaoPaulo(iso: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return p; // en-CA já formata como AAAA-MM-DD
}

// Conjunto de "conta|dia" fechados entre as datas informadas.
export async function carregarDiasFechados(
  admin: ReturnType<typeof createAdminClient>,
  dias: string[]
): Promise<Set<string>> {
  const unicos = Array.from(new Set(dias));
  if (unicos.length === 0) return new Set();
  const { data } = await admin.from("dias_fechados").select("account_id, dia").in("dia", unicos);
  return new Set(((data ?? []) as { account_id: string; dia: string }[]).map((r) => chaveDiaFechado(r.account_id, r.dia)));
}
