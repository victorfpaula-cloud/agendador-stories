import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GeminiErro, escreverTexto } from "@/lib/gemini";
import { ESTILOS_LETTERING, FORMATOS, MODOS, carregarMarca, ehEstiloLettering, ehFormato, ehModo } from "@/lib/geradorImagens";

export const maxDuration = 60;

// "Turbinar meu pedido": transforma uma ideia curta num briefing de direção
// de arte detalhado, que o Victor pode editar antes de gerar.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: conta } = await admin.from("accounts").select("id, name").eq("id", params.id).maybeSingle();
  if (!conta) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  const body = await req.json().catch(() => null);
  const pedido = String(body?.pedido ?? "").trim();
  if (pedido.length < 3 || pedido.length > 2000) return NextResponse.json({ erro: "Escreva uma ideia primeiro." }, { status: 400 });
  const modoBruto: unknown = body?.modo;
  const modo = ehModo(modoBruto) ? modoBruto : "criar";
  const formatoBruto: unknown = body?.formato;
  const formato = ehFormato(formatoBruto) ? formatoBruto : "story";
  const textoExato = String(body?.textoExato ?? "").trim().slice(0, 600);
  const estiloBruto: unknown = body?.estiloLettering;
  const estilo = ehEstiloLettering(estiloBruto) ? estiloBruto : "auto";
  const textoNaCamada = body?.textoModo !== "ia" && modo !== "editar";
  const temReferencia = body?.temReferencia === true;

  const marca = await carregarMarca(admin, params.id);

  const sistema = [
    "Você é diretor de arte sênior de uma agência brasileira de publicidade e escreve briefings para um gerador de imagens de última geração (Nano Banana Pro).",
    "Transforme a ideia do usuário em UM briefing de imagem altamente específico, em português do Brasil, entre 80 e 160 palavras, em texto corrido (sem listas, sem títulos, sem aspas).",
    "Um bom briefing é concreto e cinematográfico. Cubra, nesta ordem: (1) assunto e ação principal; (2) cenário e props com materiais e texturas reais (madeira escura, mármore, cerâmica fosca, vapor, gotículas); (3) enquadramento e lente (ex.: 85mm f/1.8, close macro, plongée a 45°); (4) luz — direção, dureza e temperatura (ex.: luz suave de janela vinda da esquerda, contraluz quente, rim light âmbar); (5) paleta de cores e color grading; (6) profundidade de campo e clima; (7) acabamento (fotografia publicitária de revista, hiper-realista, nitidez nos detalhes).",
    "Evite adjetivos vazios (lindo, incrível, perfeito) e clichês genéricos; prefira detalhes observáveis. NÃO mencione logotipo. NÃO use frases como 'imagem de' ou 'gere'. Responda SOMENTE com o briefing.",
    `Tipo de trabalho: ${MODOS[modo]}. Formato: ${FORMATOS[formato].rotulo}.`,
    modo === "angulo" ? "Trabalho: nova fotografia do MESMO prato por outro ângulo. Descreva posição de câmera, lente, profundidade de campo, luz e fundo, mantendo o prato idêntico ao da referência." : "",
    temReferencia ? "O usuário anexou imagem(ns) de referência: diga que o produto/elemento da referência deve ser mantido fiel." : "",
    textoExato && textoNaCamada
      ? "O texto será aplicado depois por fora, com tipografia profissional: NÃO descreva nenhum texto nem letras. Em vez disso, descreva uma faixa calma, limpa e de tonalidade uniforme da composição onde um título vai entrar, e componha o assunto principal fora dela."
      : "",
    textoExato && !textoNaCamada
      ? `A arte terá este texto: "${textoExato}". NÃO o reescreva no briefing; descreva em detalhe o tratamento de lettering — família/estilo da fonte (ex.: serifada Didone de alto contraste, script de pincel, sans condensada pesada), peso, caixa, espaçamento entre letras, cor/material/acabamento (folha de ouro, neon de vidro, giz), tamanho relativo entre título e subtítulo, posição e como as letras recebem a luz e as sombras da cena — seguindo esta direção: ${ESTILOS_LETTERING[estilo].descricao}`
      : "",
    marca?.estilo.trim() ? `Identidade da marca ${conta.name}: ${marca.estilo.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    return NextResponse.json({ prompt: await escreverTexto(sistema, pedido) });
  } catch (err) {
    return NextResponse.json(
      { erro: err instanceof Error ? err.message : "Erro ao turbinar o pedido." },
      { status: err instanceof GeminiErro ? 502 : 500 }
    );
  }
}
