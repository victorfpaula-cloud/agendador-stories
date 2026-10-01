-- Cross-post dos Stories pro Facebook (Victor pediu em 01/10/2026): chavinha
-- por conta (accounts.cross_post_facebook_stories) que faz os Stories dos 3
-- motores (Agendador, Story Engine, AutoStory) também saírem como Story na
-- Página do Facebook vinculada. Usa a API de Stories de Página da Meta
-- (photo_stories / video_stories) com o mesmo page_id/page_access_token que
-- a conta já guarda — o token precisa ter pages_manage_posts (ver botão
-- Reconectar).
--
-- Best-effort: roda só depois do Instagram já ter publicado e nunca afeta o
-- status/tentativas do Story do Instagram. O resultado de cada tentativa
-- fica em fb_stories_log (não é podado) pra dar pra investigar depois.
--
-- Já aplicado em produção em 01/10/2026 (via mcp__Supabase__apply_migration,
-- migração "cross_post_facebook_stories").

alter table public.accounts
  add column cross_post_facebook_stories boolean not null default false;

create table public.fb_stories_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  origem text not null check (origem in ('agendador','story_engine','autostory')),
  ref_id uuid not null,   -- slot (agendador) ou id do post (story_engine/autostory)
  dia date not null,      -- o slot do agendador se repete toda semana, por isso o dia entra na chave
  status text not null check (status in ('success','error')),
  erro text,
  created_at timestamptz not null default now(),
  unique (origem, ref_id, dia)
);
create index fb_stories_log_conta_idx on public.fb_stories_log (account_id, created_at desc);
alter table public.fb_stories_log enable row level security;
