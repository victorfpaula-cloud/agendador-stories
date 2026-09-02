import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agendador de Stories",
  description: "Agendamento semanal recorrente de Stories do Instagram",
  // Deixa o "Adicionar à Tela de Início" do iPhone/iPad abrir sempre em modo
  // app (sem a barra do Safari) e usa um nome curto embaixo do ícone — o
  // nome completo ficaria cortado. O ícone em si (apple-icon.png) não
  // precisa de nenhuma linha de código: o Next.js detecta o arquivo
  // sozinho, só precisa existir em src/app/apple-icon.png.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Agendador",
  },
};

// Mesma cor de fundo do manifest e da tela de loading (bg-slate-50). Sem
// isso, o Safari/iOS pinta a barra de status e o fundo do app instalado de
// branco puro no instante da abertura.
export const viewport: Viewport = {
  themeColor: "#f8fafc",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Pinta o fundo antes mesmo do CSS (globals.css) terminar de
            carregar. No iPhone, abrir pelo ícone da tela de início é uma
            conexão "fria": entre o app abrir e o CSS chegar existe um
            instante em que o HTML já está na tela mas sem estilo nenhum —
            nesse instante o navegador usa o fundo branco padrão, e é essa a
            "tela branca" que aparece antes do spinner/logo do loading.tsx.
            Esse <style> inline não depende de nenhum arquivo externo, então
            já vale no primeiro frame. */}
        <style>{`html,body{background-color:#f8fafc}`}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
