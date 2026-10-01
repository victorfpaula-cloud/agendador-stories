import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Account, GeradorMarca, ImagemGerada } from "@/types/database";
import { BUCKET_GERADOR } from "@/lib/geradorImagens";
import ContaTabs from "../ContaTabs";
import GeradorClient from "./GeradorClient";

// Gerador de imagens (Nano Banana / Gemini) — Victor pediu em 01/10/2026.
export const dynamic = "force-dynamic";

export default async function GeradorImagensPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: conta } = await admin.from("accounts").select("id, name").eq("id", params.id).maybeSingle();
  if (!conta) notFound();

  const { data: marca } = await admin.from("gerador_marca").select("*").eq("account_id", params.id).maybeSingle();
  const { data: imagens, error } = await admin
    .from("imagens_geradas")
    .select("*")
    .eq("account_id", params.id)
    .order("created_at", { ascending: false })
    .limit(80);

  const m = (marca as GeradorMarca | null) ?? null;
  const logoUrl = m?.logo_path ? admin.storage.from(BUCKET_GERADOR).getPublicUrl(m.logo_path).data.publicUrl : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4">
        <Link href="/contas" className="text-sm text-slate-500 hover:underline">
          ← Todas as contas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{(conta as Pick<Account, "name">).name}</h1>
        <p className="text-sm text-slate-500">Crie artes e melhore fotos com o Nano Banana (Gemini).</p>
      </div>

      <ContaTabs accountId={conta.id} />

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          Não consegui carregar a galeria ({error.message}).
        </div>
      )}

      <GeradorClient
        accountId={conta.id}
        nomeConta={conta.name}
        marcaInicial={{
          logoUrl,
          posicao: m?.logo_posicao ?? "inferior-direito",
          tamanho: m?.logo_tamanho_pct ?? 18,
          margem: m?.logo_margem_pct ?? 5,
          estilo: m?.estilo ?? "",
        }}
        imagensIniciais={(imagens ?? []) as ImagemGerada[]}
      />
    </main>
  );
}
