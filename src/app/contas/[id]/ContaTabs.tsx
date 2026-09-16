"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Navegação em abas dentro de uma conta — Stories (rotina semanal, URL
// permanece a mesma de sempre: /contas/[id]) e Publicações (feed/Reels/
// carrossel + automação do Drive, agora vivendo dentro da própria conta em
// vez de telas globais soltas). A aba de Publicações fica "ativa" tanto na
// tela normal quanto na de configuração do Drive, já que ela é uma
// sub-tela de Publicações.
export default function ContaTabs({ accountId }: { accountId: string }) {
  const pathname = usePathname();
  const emPublicacoes = pathname?.startsWith(`/contas/${accountId}/publicacoes`);

  const abas = [
    { href: `/contas/${accountId}`, label: "Stories", ativo: !emPublicacoes },
    { href: `/contas/${accountId}/publicacoes`, label: "Publicações", ativo: !!emPublicacoes },
  ];

  return (
    <div className="mb-6 flex gap-1 border-b border-slate-200">
      {abas.map((aba) => (
        <Link
          key={aba.href}
          href={aba.href}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
            aba.ativo
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          {aba.label}
        </Link>
      ))}
    </div>
  );
}
