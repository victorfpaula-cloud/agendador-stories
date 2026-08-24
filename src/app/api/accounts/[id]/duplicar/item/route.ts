import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { duplicarMidia } from "@/lib/storage";

// Segunda etapa do "Duplicar rotina": copia UM arquivo de mídia por vez pra
// pasta da conta de destino. Não mexe em nenhum horário no banco ainda — só
// prepara o arquivo. É chamado uma vez pra cada horário da rotina de
// origem, um de cada vez, pra o navegador conseguir mostrar o progresso
// real e tentar de novo só esse item (sem perder o que já foi copiado) se
// algum der um erro passageiro.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const destinoId = params.id;

  const body = await req.json().catch(() => null);
  const mediaPath = body?.mediaPath as string | undefined;

  if (!mediaPath) {
    return NextResponse.json({ erro: "Caminho da mídia original não informado." }, { status: 400 });
  }

  try {
    const copia = await duplicarMidia(admin, destinoId, mediaPath);
    return NextResponse.json({ url: copia.url, path: copia.path });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao copiar a mídia.";
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
