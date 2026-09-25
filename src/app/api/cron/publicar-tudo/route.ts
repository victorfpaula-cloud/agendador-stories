import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarPublicarStoriesSemanal } from "@/lib/engines/publicarStoriesSemanal";
import { executarPublicarFeed } from "@/lib/engines/publicarFeed";
import { executarPublicarStoriesDrive } from "@/lib/engines/publicarStoriesDrive";
import { executarPublicarStoriesCiclo } from "@/lib/engines/publicarStoriesCiclo";

// Chamada única que roda os 4 motores de publicação (Stories semanal,
// AutoFeed, AutoStory, CicloStory) dentro da MESMA execução da função —
// substitui 5 crons separados de 5 em 5 min (cada um acordando sua própria
// função na Vercel) por 1 só, cortando bastante o "Fluid Active CPU" gasto
// com inicialização repetida (achado por Victor em 25/09/2026, olhando o
// gráfico de uso na Vercel).
//
// Isso NÃO junta os módulos entre si — cada motor continua 100% isolado
// (tabelas, lógica, e-mails próprios, ver src/lib/engines/*), só o jeito
// como são disparados que virou um só. Se um motor falhar, os outros
// continuam rodando normalmente (cada bloco tem seu try/catch próprio).
// As rotas individuais (/api/cron/run, /publicar-feed, etc.) continuam
// existindo, só não são mais chamadas pelo pg_cron — ainda servem pra
// debug/retry manual isolado.
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
      // Um motor com erro inesperado não pode derrubar os outros três.
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return { erro: `Falha inesperada em ${nome}: ${msg}` };
    }
  }

  const [storiesSemanal, feed, storiesDrive, storiesCiclo] = await Promise.all([
    comSeguranca("Stories semanal", () => executarPublicarStoriesSemanal(admin)),
    comSeguranca("AutoFeed", () => executarPublicarFeed(admin)),
    comSeguranca("AutoStory", () => executarPublicarStoriesDrive(admin)),
    comSeguranca("CicloStory", () => executarPublicarStoriesCiclo(admin)),
  ]);

  return NextResponse.json({ storiesSemanal, feed, storiesDrive, storiesCiclo });
}
