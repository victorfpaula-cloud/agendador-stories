import type { Metadata } from "next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
