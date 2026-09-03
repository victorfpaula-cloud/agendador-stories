import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gerarThumbnailServidor } from "@/lib/thumbnailServidor";
import type { ScheduleSlot } from "@/types/database";

// Preenche a miniatura dos horários de Stories que já existiam antes dela
// existir (só foi passando a ser gerada em upload/edição novos — ver
// WeekEditor.tsx). Rota própria, isolada de propósito do cron que publica de
// verdade (/api/cron/run): usa uma dependência nova (sharp, processamento de
// imagem) que nunca deve chegar perto do caminho crítico de publicação — se
// algo aqui falhar ou até a função inteira não subir por algum motivo, zero
// impacto em Story nenhum sendo publicado. Roda em lotes pequenos e pode ser
// chamada de novo quantas vezes precisar (idempotente: só pega quem ainda
// não tem miniatura) até não sobrar mais nada — em ~1 semana de publicações
// normais nem precisaria rodar manual, mas dá pra adiantar chamando direto.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TAMANHO_DO_LOTE = 10;

export async function GET(req: NextRequest) {
  return executar(req);
}

export async function POST(req: NextRequest) {
  return executar(req);
}

async function executar(req: NextRequest) {
  const segredoEsperado = process.env.CRON_SECRET;
  const segredoRecebido = req.headers.get("x-cron-secret");

  if (!segredoEsperado || segredoRecebido !== segredoEsperado) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: slots, error } = await admin
    .from("schedule_slots")
    .select("*")
    .eq("media_type", "IMAGE")
    .is("thumbnail_data_url", null)
    .limit(TAMANHO_DO_LOTE);

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const resultados: Array<{ slotId: string; status: "ok" | "falhou" }> = [];

  for (const slot of (slots ?? []) as ScheduleSlot[]) {
    try {
      const res = await fetch(slot.media_url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar a mídia`);

      const buffer = Buffer.from(await res.arrayBuffer());
      const thumbnailDataUrl = await gerarThumbnailServidor(buffer);
      if (!thumbnailDataUrl) throw new Error("Falha ao gerar a miniatura");

      const { error: erroUpdate } = await admin
        .from("schedule_slots")
        .update({ thumbnail_data_url: thumbnailDataUrl })
        .eq("id", slot.id);
      if (erroUpdate) throw new Error(erroUpdate.message);

      resultados.push({ slotId: slot.id, status: "ok" });
    } catch {
      // Best-effort — um horário problemático (ex: arquivo já não existe
      // mais) não pode travar o lote inteiro. Fica pra tentar de novo no
      // próximo ciclo; se continuar falhando sempre, no pior caso esse
      // horário específico segue mostrando o arquivo original.
      resultados.push({ slotId: slot.id, status: "falhou" });
    }
  }

  return NextResponse.json({
    processados: resultados.length,
    sucesso: resultados.filter((r) => r.status === "ok").length,
    falhas: resultados.filter((r) => r.status === "falhou").length,
    detalhes: resultados,
  });
}
