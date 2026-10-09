-- Agendamento Único de Stories (Victor pediu em 09/10/2026): uma mídia, uma
-- data/horário e de 1 a 7 dias seguidos — publica uma vez por dia nesse
-- horário e depois para. Uma linha por dia; as linhas do mesmo agendamento
-- dividem o grupo_id (e o mesmo arquivo, apagado só quando o último sai).
-- Aplicado em produção (migração "story_unico_posts").
create table public.story_unico_posts (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  dia date not null,
  scheduled_at timestamptz not null,
  media_url text,
  media_path text,
  media_type text not null check (media_type in ('IMAGE','VIDEO')),
  thumbnail_data_url text,
  status text not null default 'pending' check (status in ('pending','publishing','success','error')),
  tentativas int not null default 0,
  ig_media_id text,
  error_message text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (grupo_id, dia)
);
create index story_unico_posts_conta_idx on public.story_unico_posts (account_id, scheduled_at);
create index story_unico_posts_pend_idx on public.story_unico_posts (status, scheduled_at);
alter table public.story_unico_posts enable row level security;
