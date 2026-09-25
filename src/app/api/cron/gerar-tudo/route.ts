import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarLeituraStoryDrive } from "@/lib/storyDriveIngestao";
import { executarGeracaoStoriesCiclo } from "@/lib/storyCicloGeracao";

// Chamada única que roda os 2 motores de "gerar conteúdo novo" (AutoStory
// lendo o Drive + CicloStory sorteando a próxima imagem da categoria)
// dentro da MESMA execução da função — substitui 2 crons separados de 30
// em 30 min por 1 só, mesmo motivo do /api/cron/publicar-tudo (cortar o
// "Fluid Active CPU" gasto com inicialização repetida). Continuam 100%
// isolados por baixo dos panos — tabelas, lógica e rotas próprias em
// src/lib/ — só o disparo virou um só.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  async function comSeguranca<T>(nome: string, fn: () => Promise<T>): Promise<T | { erro: string }> {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { erro: `Falha inesperada em ${nome}: ${msg}` };
    }
  }

  const [storiesDrive, storiesCiclo] = await Promise.all([
    comSeguranca("AutoStory", async () => {
      const { data: configs } = await admin.from("story_drive_config").select("account_id");
      const resultados: Record<string, Awaited<ReturnType<typeof executarLeituraStoryDrive>>> = {};
      for (const { account_id } of configs ?? []) {
        resultados[account_id] = await executarLeituraStoryDrive(admin, account_id);
      }
      return { resultados };
    }),
    comSeguranca("CicloStory", () => executarGeracaoStoriesCiclo(admin)),
  ]);

  return NextResponse.json({ storiesDrive, storiesCiclo });
}
