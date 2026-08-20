import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agendador de Stories",
  description: "Agendamento semanal recorrente de Stories do Instagram",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
