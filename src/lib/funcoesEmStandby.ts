// Funções em stand-by (Victor, 25/10/2026): AutoStory (Drive) e Gerador de
// imagens ficam fora das telas e dos robôs, mas todo o código e os dados
// continuam no lugar. Pra religar, defina na Vercel a variável de ambiente
// correspondente com o valor 1 (NEXT_PUBLIC_AUTOSTORY_ATIVO ou NEXT_PUBLIC_GERADOR_ATIVO) e faça um
// novo deploy.
export const AUTOSTORY_ATIVO = process.env.NEXT_PUBLIC_AUTOSTORY_ATIVO === "1";
export const GERADOR_ATIVO = process.env.NEXT_PUBLIC_GERADOR_ATIVO === "1";
export const DUPLICAR_ATIVO = process.env.NEXT_PUBLIC_DUPLICAR_ATIVO === "1";
