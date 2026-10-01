import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GeminiErro, escreverTexto } from "@/lib/gemini";
import { FORMATOS, MODOS, carregarMarca, ehFormato, ehModo } from "@/lib/geradorImagens";

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
  const temReferencia = body?.temReferencia === true;

  const marca = await carregarMarca(admin, params.id);

  const sistema = [
    "Você é diretor de arte de um social media brasileiro e escreve briefings para um gerador de imagens (Nano Banana).",
    "Transforme a ideia do usuário em UM briefing de imagem detalhado, em português do Brasil, entre 60 e 130 palavras, em texto corrido (sem listas, sem títulos).",
    "Descreva: cena/assunto, composição e enquadramento, iluminação, paleta de cores, estilo (fotografia publicitária, ilustração, 3D...), clima e profundidade. Seja concreto e visual.",
    "NÃO invente textos para aparecer na imagem (o texto exato é tratado à parte). NÃO mencione logotipo. NÃO use frases como 'imagem de' ou 'gere'. Responda SOMENTE com o briefing.",
    `Tipo de trabalho: ${MODOS[modo]}. Formato: ${FORMATOS[formato].rotulo}.`,
    temReferencia ? "O usuário anexou imagem(ns) de referência: diga que o produto/elemento da referência deve ser mantido fiel." : "",
    textoExato ? `A arte terá este texto (apenas reserve espaço visual para ele, sem repeti-lo): "${textoExato}"` : "",
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
