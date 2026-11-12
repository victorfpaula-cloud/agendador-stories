import { chaveDiaFechado } from "@/lib/diasFechados";

// Resumo do dia dos Stories agendados (rotina semanal) por conta, usado na
// lista de contas. Regra pra nunca dar "4 de 2": o total é o que está na
// rotina hoje MAIS os Stories de hoje já publicados por horários que depois
// foram apagados/mudados (esses contam nos dois lados). Cada horário conta
// uma vez só, mesmo com mais de uma tentativa no histórico.
export type ResumoSemanal = { total: number; postados: number; erros: number; fechado: boolean };

export function calcularResumoSemanal(
  contasIds: string[],
  slots: { id: string; account_id: string }[],
  logs: { account_id: string | null; slot_id: string | null; status: string }[],
  fechados: Set<string>,
  dataISO: string
): Record<string, ResumoSemanal> {
  const slotsPorConta = new Map<string, Set<string>>();
  for (const s of slots) {
    if (!slotsPorConta.has(s.account_id)) slotsPorConta.set(s.account_id, new Set());
    slotsPorConta.get(s.account_id)!.add(s.id);
  }

  const sucesso = new Map<string, Set<string>>();
  const erro = new Map<string, Set<string>>();
  const orfaos = new Map<string, number>();
  for (const log of logs) {
    if (!log.account_id) continue;
    const ativos = slotsPorConta.get(log.account_id);
    if (log.slot_id && ativos?.has(log.slot_id)) {
      const alvo = log.status === "success" ? sucesso : log.status === "error" ? erro : null;
      if (!alvo) continue;
      if (!alvo.has(log.account_id)) alvo.set(log.account_id, new Set());
      alvo.get(log.account_id)!.add(log.slot_id);
    } else if (log.status === "success") {
      // Horário que já saiu hoje e depois foi removido da rotina.
      orfaos.set(log.account_id, (orfaos.get(log.account_id) ?? 0) + 1);
    }
  }

  const resultado: Record<string, ResumoSemanal> = {};
  for (const id of contasIds) {
    const ok = sucesso.get(id) ?? new Set<string>();
    const falhas = Array.from(erro.get(id) ?? []).filter((slotId) => !ok.has(slotId)).length;
    const orfao = orfaos.get(id) ?? 0;
    resultado[id] = {
      total: (slotsPorConta.get(id)?.size ?? 0) + orfao,
      postados: ok.size + orfao,
      erros: falhas,
      fechado: fechados.has(chaveDiaFechado(id, dataISO)),
    };
  }
  return resultado;
}
