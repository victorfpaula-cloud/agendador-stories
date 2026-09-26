"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GlassSurface } from "@/components/Glass";

// Navegação em botões dentro de uma conta — Stories (rotina semanal, URL
// permanece a mesma de sempre: /contas/[id]), Agendamento de Publicações
// (feed/Reels/carrossel), AutoFeed (automação do Drive pro Feed), AutoStory
// (automação do Drive pra Stories) e Story Engine (banco de imagens por
// categoria que gira sem repetir). "AutoFeed"/"AutoStory" são os nomes que
// o Victor escolheu em 17/09/2026; "Story Engine" é o nome que escolheu em
// 26/09/2026 pro módulo que antes se chamava "CicloStory" (não pegou bem —
// a URL/rotas internas continuam usando "ciclo" por trás, só o nome
// visível mudou). Cada botão tem seu próprio ícone só pra reforçar
// visualmente a diferença.
export default function ContaTabs({ accountId }: { accountId: string }) {
  const pathname = usePathname();
  const base = `/contas/${accountId}`;
  const emAutoFeed = pathname?.startsWith(`${base}/publicacoes/drive`);
  const emPublicacoes = pathname?.startsWith(`${base}/publicacoes`) && !emAutoFeed;
  const emAutoStory = pathname?.startsWith(`${base}/stories-drive`);
  const emStoryEngine = pathname?.startsWith(`${base}/stories-ciclo`);
  const emStories = !emPublicacoes && !emAutoFeed && !emAutoStory && !emStoryEngine;

  const abas = [
    { href: base, label: "Stories", ativo: emStories, Icone: IconeStories },
    { href: `${base}/publicacoes`, label: "Publicações", ativo: !!emPublicacoes, Icone: IconePublicacoes },
    { href: `${base}/publicacoes/drive`, label: "AutoFeed", ativo: !!emAutoFeed, Icone: IconeAutoFeed },
    { href: `${base}/stories-drive`, label: "AutoStory", ativo: !!emAutoStory, Icone: IconeAutoStory },
    { href: `${base}/stories-ciclo`, label: "Story Engine", ativo: !!emStoryEngine, Icone: IconeStoryEngine },
  ];

  return (
    // Grade 2x2 no celular (4 botões nunca cabiam numa linha só sem cortar
    // na borda — achado por Victor em 18/09/2026); vira uma linha só a
    // partir do tablet, onde já sobra espaço de sobra. Com 5 botões, o
    // último fica sozinho numa 3a linha no celular — aceitável, ainda sem
    // cortar borda.
    <div className="mb-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {abas.map((aba) => (
        // "contents" tira o <Link> do fluxo de layout (o grid/flex passa a
        // enxergar o GlassSurface direto como item), mas o clique continua
        // funcionando: ele borbulha do conteúdo até o <a> normalmente.
        <Link key={aba.href} href={aba.href} className="contents">
          <GlassSurface
            tint={aba.ativo ? "linear-gradient(180deg, rgba(129,140,248,.48), rgba(61,84,224,.74))" : "rgba(255,255,255,.4)"}
            sheenOpacity={aba.ativo ? 0.85 : 0.3}
            blur={8}
            scale={-18}
            className="flex items-center justify-center gap-1.5 whitespace-nowrap px-3.5 py-2 text-sm font-medium transition"
            style={{ color: aba.ativo ? "#fff" : "#475569" }}
          >
            <aba.Icone className="h-4 w-4 shrink-0" />
            {aba.label}
          </GlassSurface>
        </Link>
      ))}
    </div>
  );
}

type IconeProps = { className?: string };

// Vídeo vertical com "play" — rotina semanal de Stories.
function IconeStories({ className }: IconeProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="5" y="3" width="14" height="18" rx="3" />
      <path d="M10.2 9.2v5.6l4.6-2.8-4.6-2.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Grade 2x2 — feed do Instagram (Publicações).
function IconePublicacoes({ className }: IconeProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </svg>
  );
}

// Setas em ciclo — automação/robô (mesmo ícone que já representava
// "Automação do Drive" antes do redesign de nomes, mantém a continuidade
// visual). Usado só pro AutoFeed pra diferenciar do robô do AutoStory.
function IconeAutoFeed({ className }: IconeProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
    </svg>
  );
}

// Rosto de robô — automação do Drive pras Stories (mesmo 🤖 usado no
// cardzinho do dashboard pra esse recurso, ver ListaContas.tsx).
function IconeAutoStory({ className }: IconeProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 8V5" />
      <circle cx="12" cy="3.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="13.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13.2" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9 16.3h6" />
    </svg>
  );
}

// Raio — remete a motor/potência (pedido do Victor: "algo relacionado a
// potência, motor"), num traço limpo e único, sem picos nem partes soltas
// (as duas tentativas anteriores — engrenagem cheia de dentes e setas de
// shuffle — não agradaram). Exportado porque a tela de Stories normal
// (WeekEditor.tsx) também usa esse ícone nos "containerzinhos fantasma" que
// mostram o que o Story Engine vai postar naquele dia.
export function IconeStoryEngine({ className }: IconeProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
