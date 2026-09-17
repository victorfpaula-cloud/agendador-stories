"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Navegação em abas dentro de uma conta — Stories (rotina semanal, URL
// permanece a mesma de sempre: /contas/[id]), Agendamento de Publicações
// (feed/Reels/carrossel), Automação do Drive (Feed) e Story Automático
// Drive, cada uma na sua própria aba/URL, todas vivendo dentro da própria
// conta em vez de telas globais soltas. Os dois Drives têm aba própria (em
// vez de ficar escondidos dentro de Publicações/Stories) porque são
// configuração à parte, não um post — clicar já abre a configuração direto.
export default function ContaTabs({ accountId }: { accountId: string }) {
  const pathname = usePathname();
  const base = `/contas/${accountId}`;
  const emDriveFeed = pathname?.startsWith(`${base}/publicacoes/drive`);
  const emPublicacoes = pathname?.startsWith(`${base}/publicacoes`) && !emDriveFeed;
  const emStoriesDrive = pathname?.startsWith(`${base}/stories-drive`);

  const abas = [
    { href: base, label: "Stories", ativo: !emPublicacoes && !emDriveFeed && !emStoriesDrive },
    { href: `${base}/publicacoes`, label: "Agendamento de Publicações", ativo: !!emPublicacoes },
    { href: `${base}/publicacoes/drive`, label: "Automação do Drive", ativo: !!emDriveFeed },
    { href: `${base}/stories-drive`, label: "Story Automático Drive", ativo: !!emStoriesDrive },
  ];

  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
      {abas.map((aba) => (
        <Link
          key={aba.href}
          href={aba.href}
          className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
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
