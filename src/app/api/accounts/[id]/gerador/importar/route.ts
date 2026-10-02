import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_GERADOR, baixarDoBucket, carregarMarca, comporFinal, ehFormato, prepararBase } from "@/lib/geradorImagens";

export const maxDuration = 30;

// Traz pra galeria uma imagem criada FORA do app (ex.: Google Flow). O
// arquivo já foi enviado direto pro Storage pelo navegador (sem o limite de
// 4,5MB da Vercel); aqui ele é ajustado ao formato escolhido, ganha o logo
// (se pedido) e fica disponível pra texto profissional, Story Engine, Feed...
// Nenhuma geração de IA nem custo: é só importação.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const path = typeof body?.path === "string" ? body.path : "";
  const formato: unknown = body?.formato;
  const usarLogo = body?.usarLogo === true;

  // Só aceita arquivos que o próprio navegador acabou de subir pra pasta de importação dessa conta.
  if (!path.startsWith(`${params.id}/import/`) || path.includes("..")) {
    return NextResponse.json({ erro: "Arquivo inválido." }, { status: 400 });
  }
  if (!ehFormato(formato)) return NextResponse.json({ erro: "Escolha o formato." }, { status: 400 });

  const admin = createAdminClient();
  const { data: conta } = await admin.from("accounts").select("id").eq("id", params.id).maybeSingle();
  if (!conta) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  try {
    const bruta = await baixarDoBucket(admin, path);
    // Ajusta ao formato (recorte centralizado). Nada é removido de propósito do arquivo.
    const base = await prepararBase(bruta, formato);

    const marca = await carregarMarca(admin, params.id);
    const comLogo = usarLogo && !!marca?.logo_path;
    const logo =
      comLogo && marca?.logo_path
        ? {
            buffer: await baixarDoBucket(admin, marca.logo_path),
            posicao: marca.logo_posicao,
            tamanhoPct: marca.logo_tamanho_pct,
            margemPct: marca.logo_margem_pct,
          }
        : null;
    const final = await comporFinal(base, formato, null, logo);

    const id = randomUUID();
    const pathFinal = `${params.id}/${id}.jpg`;
    const pathBase = `${params.id}/${id}-base.jpg`;
    const up1 = await admin.storage.from(BUCKET_GERADOR).upload(pathFinal, final, { contentType: "image/jpeg" });
    if (up1.error) throw new Error(`Falha ao salvar a imagem: ${up1.error.message}`);
    const up2 = await admin.storage.from(BUCKET_GERADOR).upload(pathBase, base, { contentType: "image/jpeg" });
    const basePath = up2.error ? null : pathBase;
    const { data: pub } = admin.storage.from(BUCKET_GERADOR).getPublicUrl(pathFinal);

    const { data: linha, error } = await admin
      .from("imagens_geradas")
      .insert({
        account_id: params.id,
        storage_path: pathFinal,
        url: pub.publicUrl,
        formato,
        modelo: "importada",
        modo: "criar",
        pedido: "Imagem importada",
        prompt_final: "",
        com_logo: !!logo,
        base_path: basePath,
        camada: null,
        custo_usd: 0,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await admin.storage.from(BUCKET_GERADOR).remove([path]);
    return NextResponse.json({ imagem: linha });
  } catch (err) {
    return NextResponse.json({ erro: err instanceof Error ? err.message : "Erro ao importar a imagem." }, { status: 500 });
  }
}
