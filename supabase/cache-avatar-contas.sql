-- Cache da foto de perfil do Instagram (17/09/2026) — antes, /api/contas/avatares
-- buscava a foto na Graph API do Meta TODA vez que a tela de contas abria,
-- pra todas as contas, de propósito (o comentário antigo dizia "a URL
-- expira, não vale a pena guardar"). Isso gastava banda/egress à toa em
-- cada carregamento do painel. Já aplicado direto no projeto via Supabase
-- MCP (migração cache_avatar_contas) — este arquivo é só o registro.
--
-- Guarda agora por até 30 dias (ver CACHE_DIAS em
-- src/app/api/contas/avatares/route.ts) — se a URL cacheada expirar antes
-- disso, o <img onError> do navegador já cai pro círculo com a inicial do
-- nome (ver ContaCard em ListaContas.tsx), então cachear é seguro mesmo a
-- URL do Meta tendo prazo de validade próprio.
alter table public.accounts
  add column if not exists avatar_url text,
  add column if not exists avatar_atualizado_em timestamptz;
