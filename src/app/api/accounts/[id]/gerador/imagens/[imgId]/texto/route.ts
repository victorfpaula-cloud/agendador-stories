import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_GERADOR, baixarDoBucket, carregarMarca, comporFinal, ehFormato } from "@/lib/geradorImagens";
import { ehPosicaoTexto, ehTemaTexto, type OpcoesTexto } from "@/lib/tipografia";

export const maxDuration = 30;

// Reescreve/reestiliza o texto de uma imagem que usa a "camada de texto":
// pega a base (arte da IA, sem texto) e refaz o texto — instantâneo e sem
// gastar nenhuma geração de IA.
export async function POST(req: NextRequest, { params }: { params: { id: string; imgId: string } }) {
  const body = await req.json().catch(() => null);
  const texto = String(body?.texto ?? "").trim().slice(0, 600);
  const temaBruto: unknown = body?.tema;
  const posBruta: unknown = body?.posicao;
  if (!texto) return NextResponse.json({ erro: "Escreva o texto." }, { status: 400 });
  if (!ehTemaTexto(temaBruto) || !ehPosicaoTexto(posBruta)) return NextResponse.json({ erro: "Estilo ou posição inválidos." }, { status: 400 });
  const tamanho = Math.min(22, Math.max(6, Number(body?.tamanhoPct) || 12));
  const cor = typeof body?.cor === "string" && /^#[0-9a-fA-F]{6}$/.test(body.cor) ? body.cor : null;
  const veu = body?.veu !== false;

  const admin = createAdminClient();
  const { data: img } = await admin
    .from("imagens_geradas")
    .select("*")
    .eq("id", params.imgId)
    .eq("account_id", params.id)
    .maybeSingle();
  if (!img) return NextResponse.json({ erro: "Imagem não encontrada." }, { status: 404 });
  if (!img.base_path || !ehFormato(img.formato)) {
    return NextResponse.json({ erro: "Essa imagem não tem camada de texto editável." }, { status: 400 });
  }

  try {
    const base = await baixarDoBucket(admin, img.base_path);

    let logo = null;
    if (img.com_logo) {
      const marca = await carregarMarca(admin, params.id);
      if (marca?.logo_path) {
        logo = {
          buffer: await baixarDoBucket(admin, marca.logo_path),
          posicao: marca.logo_posicao,
          tamanhoPct: marca.logo_tamanho_pct,
          margemPct: marca.logo_margem_pct,
        };
      }
    }

    const camada: OpcoesTexto = { texto, tema: temaBruto, posicao: posBruta, tamanhoPct: tamanho, cor, veu };
    const final = await comporFinal(base, img.formato, camada, logo);

    // Caminho novo a cada edição (o CDN público guardaria a versão antiga).
    const path = `${params.id}/${randomUUID()}.jpg`;
    const { error: upErr } = await admin.storage.from(BUCKET_GERADOR).upload(path, final, { contentType: "image/jpeg" });
    if (upErr) throw new Error(`Falha ao salvar a imagem: ${upErr.message}`);
    const { data: pub } = admin.storage.from(BUCKET_GERADOR).getPublicUrl(path);

    const { data: atualizada, error } = await admin
      .from("imagens_geradas")
      .update({ storage_path: path, url: pub.publicUrl, camada })
      .eq("id", params.imgId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await admin.storage.from(BUCKET_GERADOR).remove([img.storage_path]);
    return NextResponse.json({ imagem: atualizada });
  } catch (err) {
    return NextResponse.json({ erro: err instanceof Error ? err.message : "Erro ao aplicar o texto." }, { status: 500 });
  }
}
