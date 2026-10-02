import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { agoraEmSaoPaulo } from "@/lib/days";
import { ehPosicaoTexto, ehTemaTexto, type OpcoesTexto } from "@/lib/tipografia";
import { GeminiErro, gerarImagem, type Qualidade, type Referencia } from "@/lib/gemini";
import {
  BUCKET_GERADOR,
  FORMATOS,
  baixarDoBucket,
  carregarMarca,
  ehAngulo,
  ehEstiloLettering,
  ehFormato,
  ehModo,
  exigePremium,
  comporFinal,
  prepararBase,
  montarPrompt,
  quaseIgual,
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
  const pedido = String(form.get("pedido") ?? "").trim();
  const textoExato = String(form.get("textoExato") ?? "").trim().slice(0, 600);
  const usarLogo = form.get("usarLogo") === "1";
  const estiloBruto: unknown = form.get("estiloLettering");
  const estiloLettering = ehEstiloLettering(estiloBruto) ? estiloBruto : "auto";
  // "camada" (padrão): a IA faz só a arte e o app escreve o texto com fontes
  // de verdade; "ia": a IA desenha as letras. Em edição, sempre "ia".
  const textoNaCamada = form.get("textoModo") !== "ia" && modo !== "editar";
  const temaBruto: unknown = form.get("temaTexto");
  const tema = ehTemaTexto(temaBruto) ? temaBruto : "elegante";
  const posBruta: unknown = form.get("posicaoTexto");
  const posicaoTexto = ehPosicaoTexto(posBruta) ? posBruta : "topo";
  const tamanhoTexto = Math.min(22, Math.max(6, Number(form.get("tamanhoTexto")) || 12));
  const corBruta = String(form.get("corTexto") ?? "");
  const corTexto = /^#[0-9a-fA-F]{6}$/.test(corBruta) ? corBruta : null;
  const veuTexto = form.get("veuTexto") !== "0";
  const anguloBruto: unknown = form.get("angulo");
  const angulo = ehAngulo(anguloBruto) ? anguloBruto : "livre";
  const baseId = String(form.get("baseImagemId") ?? "");

  if (!ehModo(modo) || !ehFormato(formato)) return NextResponse.json({ erro: "Modo ou formato inválido." }, { status: 400 });
  if (modo !== "angulo" && pedido.length < 3) return NextResponse.json({ erro: "Descreva o que você quer na imagem." }, { status: 400 });
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

  const maxRefs = 6;
  for (const item of form.getAll("refs")) {
    if (!(item instanceof File)) continue;
    if (!MIMES_OK.has(item.type)) return NextResponse.json({ erro: "Referência precisa ser JPG, PNG ou WebP." }, { status: 400 });
    if (item.size > 4_000_000) return NextResponse.json({ erro: "Uma das referências é grande demais." }, { status: 400 });
    referencias.push({ mimeType: item.type, data: Buffer.from(await item.arrayBuffer()) });
  }
  if (referencias.length > maxRefs) {
    return NextResponse.json({ erro: `Cabem até ${maxRefs} imagens de referência.` }, { status: 400 });
  }
  if ((modo === "produto" || modo === "angulo") && referencias.length === 0) {
    return NextResponse.json({ erro: "Envie a foto do produto/prato como referência." }, { status: 400 });
  }
  if (modo === "angulo" && angulo === "livre" && pedido.length < 3) {
    return NextResponse.json({ erro: "Descreva o ângulo que você quer (ou escolha um dos botões)." }, { status: 400 });
  }

  // Texto na imagem e trabalho com referência sempre vão pro Premium (o
  // Rápido erra letras, desenha mal e tende a devolver a referência igual).
  const qualidade: Qualidade =
    form.get("qualidade") === "premium" || exigePremium(modo, textoExato.length > 0 && !textoNaCamada, referencias.length > 0) ? "premium" : "rapido";

  const marca = await carregarMarca(admin, params.id);
  const comLogo = usarLogo && !!marca?.logo_path;

  const parametrosPrompt = {
    modo,
    formato,
    pedido,
    textoExato,
    marca,
    nomeConta: conta.name,
    usarLogo: comLogo,
    qtdReferencias: referencias.length,
    estiloLettering,
    angulo,
    textoNaCamada,
    posicaoTexto,
  };
  const prompt = montarPrompt(parametrosPrompt);

  try {
    const inicio = Date.now();
    const aspecto = FORMATOS[formato].aspecto;
    let r = await gerarImagem({ qualidade, prompt, referencias, aspecto });
    let aviso: string | null = null;

    // Trava anti-cópia: se o modelo devolveu a própria referência quase
    // igual (num modo que pede mudança), tenta de novo com mais força — só
    // se ainda der tempo dentro dos 60s da função.
    const pedeMudanca = modo === "angulo" || modo === "produto" || (modo === "criar" && referencias.length > 0);
    if (pedeMudanca && (await quaseIgual(r.imagem, referencias[0].data))) {
      const restante = 54_000 - (Date.now() - inicio);
      aviso = "A IA devolveu quase a mesma foto da referência. Use \"Refazer\" ou descreva a mudança com mais detalhe.";
      if (restante >= 15_000) {
        try {
          const r2 = await gerarImagem({
            qualidade,
            prompt: montarPrompt({ ...parametrosPrompt, reforcoAnticopia: true }),
            referencias,
            aspecto,
            timeoutMs: restante,
          });
          r = r2;
          if (!(await quaseIgual(r2.imagem, referencias[0].data))) aviso = null;
        } catch {
          // mantém a primeira imagem com o aviso
        }
      }
    }

    let logo = null;
    if (comLogo && marca?.logo_path) {
      logo = {
        buffer: await baixarDoBucket(admin, marca.logo_path),
        posicao: marca.logo_posicao,
        tamanhoPct: marca.logo_tamanho_pct,
        margemPct: marca.logo_margem_pct,
      };
    }
    const base = await prepararBase(r.imagem, formato);
    const camada: OpcoesTexto | null =
      textoExato && textoNaCamada
        ? { texto: textoExato, tema, posicao: posicaoTexto, tamanhoPct: tamanhoTexto, cor: corTexto, veu: veuTexto }
        : null;
    const final = await comporFinal(base, formato, camada, logo);

    const id = randomUUID();
    const path = `${params.id}/${id}.jpg`;
    const { error: upErr } = await admin.storage.from(BUCKET_GERADOR).upload(path, final, { contentType: "image/jpeg" });
    if (upErr) throw new Error(`Falha ao salvar a imagem: ${upErr.message}`);
    const { data: pub } = admin.storage.from(BUCKET_GERADOR).getPublicUrl(path);

    // A base (sem texto) fica guardada pra dar pra trocar/ajustar o texto
    // depois sem gastar IA.
    let basePath: string | null = null;
    if (camada) {
      basePath = `${params.id}/${id}-base.jpg`;
      const { error: baseErr } = await admin.storage.from(BUCKET_GERADOR).upload(basePath, base, { contentType: "image/jpeg" });
      if (baseErr) basePath = null;
    }

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
        base_path: basePath,
        camada: basePath ? camada : null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ imagem: linha, aviso });
  } catch (err) {
    const status = err instanceof GeminiErro ? 502 : 500;
    return NextResponse.json({ erro: err instanceof Error ? err.message : "Erro ao gerar a imagem." }, { status });
  }
}
