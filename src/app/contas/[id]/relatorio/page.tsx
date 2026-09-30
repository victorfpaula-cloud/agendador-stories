import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { gerarRelatorioMensal, mesValido, renderizarRelatorioHtml } from "@/lib/relatorio";
import EnviarRelatorioPorEmail from "./EnviarRelatorioPorEmail";

// Relatório mensal gerado na hora, dentro da conta (mesmo HTML que chega por
// e-mail no último dia do mês — ver /api/cron/relatorio-mensal).
export const dynamic = "force-dynamic";

export default async function RelatorioDaContaPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { mes?: string; feed?: string };
}) {
  const admin = createAdminClient();
  const { data: conta } = await admin.from("accounts").select("id, name").eq("id", params.id).maybeSingle();
  if (!conta) notFound();

  const agora = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date());
  const mes = mesValido(searchParams.mes) ? searchParams.mes : agora;
  const incluirFeed = searchParams.feed !== "0";

  const relatorio = await gerarRelatorioMensal(admin, { mes, contaIds: [params.id], incluirFeed });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/contas/${params.id}`} className="text-sm text-slate-500 hover:underline">
          ← Voltar pra {conta.name.trim()}
        </Link>
        <EnviarRelatorioPorEmail accountId={params.id} mes={mes} incluirFeed={incluirFeed} />
      </div>

      <div className="overflow-hidden rounded-xl2 bg-white shadow-sm ring-1 ring-slate-200">
        <div dangerouslySetInnerHTML={{ __html: renderizarRelatorioHtml(relatorio) }} />
      </div>
    </main>
  );
}
