import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import { GeminiErro, gerarImagem, type Qualidade, type Referencia } from "@/lib/gemini";
import {
  BUCKET_GERADOR,
  FORMATOS,
  baixarDoBucket,
  carregarMarca,
  ehFormato,
  ehModo,
  finalizarImagem,
  montarPrompt,
} from "@/lib/geradorImagens";

// Uma chamada = UMA imagem. Pra gerar variações, o navegador dispara várias
// chamadas em paralelo (cada uma com seus 60s).
export const maxDuration = 60;

const MIMES_OK = new Set(["image/jpeg", "image/png", "image/webp"]);
const LIMITE_DIARIO = Number(process.env.GERADOR_LIMITE_DIARIO) || 150;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: conta } = await admin.from("accounts").select("id, name").eq("id", params.id).maybeSingle();
  if (!conta) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ erro: "Pedido inválido (imagens de referência grandes demais?)." }, { status: 400 });
  }

  const modo = form.get("modo");
  const formato = form.get("formato");
  const qualidade: Qualidade = form.get("qualidade") === "premium" ? "premium" : "rapido";
  const pedido = String(form.get("pedido") ?? "").trim();
  const textoExato = String(form.get("textoExato") ?? "").trim().slice(0, 600);
  const usarLogo = form.get("usarLogo") === "1";
  const baseId = String(form.get("baseImagemId") ?? "");

  if (!ehModo(modo) || !ehFormato(formato)) return NextResponse.json({ erro: "Modo ou formato inválido." }, { status: 400 });
  if (pedido.length < 3) return NextResponse.json({ erro: "Descreva o que você quer na imagem." }, { status: 400 });
  if (pedido.length > 4000) return NextResponse.json({ erro: "Pedido grande demais." }, { status: 400 });

  // Teto diário (todas as contas somadas) pra um clique maluco não virar conta alta.
  const { dataISO } = agoraEmSaoPaulo();
  const { count } = await admin
    .from("imagens_geradas")
    .select("id", { count: "exact", head: true })
    .gte("created_at", `${dataISO}T00:00:00-03:00`);
  if ((count ?? 0) >= LIMITE_DIARIO) {
    return NextResponse.json({ erro: `Limite de ${LIMITE_DIARIO} imagens por dia atingido (proteção de custo).` }, { status: 429 });
  }

  const referencias: Referencia[] = [];
  let origemId: string | null = null;

  if (modo === "editar") {
    const { data: base } = await admin
      .from("imagens_geradas")
      .select("id, storage_path")
      .eq("id", baseId)
      .eq("account_id", params.id)
      .maybeSingle();
    if (!base) return NextResponse.json({ erro: "Imagem a editar não encontrada." }, { status: 404 });
    origemId = base.id;
    try {
      referencias.push({ mimeType: "image/jpeg", data: await baixarDoBucket(admin, base.storage_path) });
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro ao ler a imagem." }, { status: 500 });
    }
  }

  const maxRefs = qualidade === "premium" ? 6 : 3;
  for (const item of form.getAll("refs")) {
    if (!(item instanceof File)) continue;
    if (!MIMES_OK.has(item.type)) return NextResponse.json({ erro: "Referência precisa ser JPG, PNG ou WebP." }, { status: 400 });
    if (item.size > 4_000_000) return NextResponse.json({ erro: "Uma das referências é grande demais." }, { status: 400 });
    referencias.push({ mimeType: item.type, data: Buffer.from(await item.arrayBuffer()) });
  }
  if (referencias.length > maxRefs) {
    return NextResponse.json(
      { erro: `No modo ${qualidade === "premium" ? "Premium" : "Rápido"} cabem até ${maxRefs} imagens de referência.` },
      { status: 400 }
    );
  }
  if (modo === "produto" && referencias.length === 0) {
    return NextResponse.json({ erro: "Pra melhorar um produto, envie a foto dele como referência." }, { status: 400 });
  }

  const marca = await carregarMarca(admin, params.id);
  const comLogo = usarLogo && !!marca?.logo_path;

  const prompt = montarPrompt({
    modo,
    formato,
    pedido,
    textoExato,
    marca,
    nomeConta: conta.name,
    usarLogo: comLogo,
    qtdReferencias: referencias.length,
  });

  try {
    const r = await gerarImagem({ qualidade, prompt, referencias, aspecto: FORMATOS[formato].aspecto });

    let logo = null;
    if (comLogo && marca?.logo_path) {
      logo = {
        buffer: await baixarDoBucket(admin, marca.logo_path),
        posicao: marca.logo_posicao,
        tamanhoPct: marca.logo_tamanho_pct,
        margemPct: marca.logo_margem_pct,
      };
    }
    const final = await finalizarImagem(r.imagem, formato, logo);

    const path = `${params.id}/${randomUUID()}.jpg`;
    const { error: upErr } = await admin.storage.from(BUCKET_GERADOR).upload(path, final, { contentType: "image/jpeg" });
    if (upErr) throw new Error(`Falha ao salvar a imagem: ${upErr.message}`);
    const { data: pub } = admin.storage.from(BUCKET_GERADOR).getPublicUrl(path);

    const { data: linha, error } = await admin
      .from("imagens_geradas")
      .insert({
        account_id: params.id,
        storage_path: path,
        url: pub.publicUrl,
        formato,
        modelo: r.modelo,
        modo,
        pedido,
        prompt_final: prompt,
        com_logo: !!logo,
        origem_id: origemId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ imagem: linha });
  } catch (err) {
    const status = err instanceof GeminiErro ? 502 : 500;
    return NextResponse.json({ erro: err instanceof Error ? err.message : "Erro ao gerar a imagem." }, { status });
  }
}
