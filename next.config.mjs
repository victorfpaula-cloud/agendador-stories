/** @type {import('next').NextConfig} */
// Cabeçalhos de segurança básicos (30/09/2026): impede o app de ser embutido
// em outro site (clickjacking), de ter o tipo de arquivo "adivinhado" pelo
// navegador e limita o que vai no Referer.
const cabecalhosDeSeguranca = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: cabecalhosDeSeguranca }];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
