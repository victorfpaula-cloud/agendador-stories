import type { MetadataRoute } from "next";

// Deixa o Android/Chrome abrir o app instalado direto em "/contas" — sem
// esse manifest, o ícone abre em "/" (que é só um redirect: aguarda a
// sessão do Supabase resolver pra então mandar pra /login ou /contas). Esse
// vai-e-volta extra é o que fazia a tela demorar mais pra aparecer bem no
// momento de abrir o app pelo ícone, que é o caso mais importante.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agendador de Stories",
    short_name: "Agendador",
    start_url: "/contas",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#4f6bff",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
