-- Cross-post automático pro Feed da Página do Facebook (Victor pediu em
-- 29/09/2026) — quando ligado numa conta, toda publicação de Feed/Reels/
-- carrossel que sai no Instagram dessa conta também tenta sair como post no
-- Feed da mesma Página do Facebook, reaproveitando o page_id e o
-- page_access_token que a conta já guarda desde a conexão inicial (não
-- precisa de nenhum escopo/permissão novo além do que o token já tem).
--
-- É best-effort e isolado: uma falha no Facebook nunca falha nem re-tenta a
-- publicação no Instagram (que é a que importa de verdade) — só fica
-- registrada em fb_cross_post_status/fb_cross_post_error pra dar pra
-- investigar depois. Não cobre carrossel com vídeo misturado com foto (ver publicarNaPagina em
-- src/lib/meta.ts).
--
-- Já aplicado em produção em 29/09/2026 (via mcp__Supabase__apply_migration,
-- migração "cross_post_facebook"). Este arquivo documenta a mudança pra
-- quem for rodar uma instalação nova do zero.

alter table public.accounts
  add column cross_post_facebook boolean not null default false;

alter table public.feed_post_accounts
  add column fb_cross_post_status text not null default 'not_attempted',
  add column fb_cross_post_error text;
