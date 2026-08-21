import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Rota temporária de diagnóstico: faz exatamente a mesma consulta que
// /contas/[id]/page.tsx usa pra buscar os horários, mas devolve o
// resultado cru em JSON, sem passar pelo React/Next render — serve pra
// descobrir se um horário que sumiu da tela também some daqui (bug no
// banco/consulta) ou aparece certinho aqui (bug em outro lugar do render).
export async function GET(_req: NextRequest, { params }: { params: { accountId: string } }) {
  const admin = createAdminClient();

  const { data: slots, error } = await admin
    .from("schedule_slots")
    .select("*")
    .eq("account_id", params.accountId)
    .order("time_of_day", { ascending: true });

  return NextResponse.json(
    {
      total: slots?.length ?? 0,
      error: error?.message ?? null,
      slots,
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
