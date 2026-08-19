-- Agendador de Stories — schema do banco
-- Rode este arquivo no SQL Editor do seu projeto Supabase (Database > SQL Editor > New query)

create extension if not exists "pgcrypto";

-- Contas conectadas (Página do Facebook + conta profissional do Instagram vinculada)
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  page_id text not null unique,
  ig_user_id text not null,
  ig_username text,
  page_access_token text not null,
  token_obtained_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Horários recorrentes semanais de cada conta
-- day_of_week: 1 = segunda-feira ... 7 = domingo (padrão ISO-8601)
create table if not exists public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  time_of_day time not null,
  media_url text not null,
  media_path text not null,
  media_type text not null check (media_type in ('IMAGE','VIDEO')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists schedule_slots_account_idx on public.schedule_slots(account_id);
create index if not exists schedule_slots_day_time_idx on public.schedule_slots(day_of_week, time_of_day);

-- Histórico de publicações (evita duplicar e serve de log/depuração)
create table if not exists public.publish_log (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid references public.schedule_slots(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  scheduled_for date not null,
  status text not null check (status in ('success','error')),
  ig_media_id text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (slot_id, scheduled_for)
);

-- Handshake temporário do OAuth do Facebook (guarda as Páginas encontradas até o usuário escolher)
create table if not exists public.pending_connections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  payload jsonb not null
);

create table if not exists public.oauth_states (
  state text primary key,
  created_at timestamptz not null default now()
);

-- RLS: ativado em todas as tabelas, sem policies públicas.
-- Só o backend (service role key, nunca exposta ao navegador) acessa esses dados.
alter table public.accounts enable row level security;
alter table public.schedule_slots enable row level security;
alter table public.publish_log enable row level security;
alter table public.pending_connections enable row level security;
alter table public.oauth_states enable row level security;

-- Bucket de storage pra guardar as artes (público pra leitura, pois a API do Instagram
-- precisa baixar a imagem/vídeo por uma URL pública)
insert into storage.buckets (id, name, public)
values ('story-media', 'story-media', true)
on conflict (id) do nothing;

drop policy if exists "Leitura publica story-media" on storage.objects;
create policy "Leitura publica story-media"
  on storage.objects for select
  using (bucket_id = 'story-media');

-- Escrita/alteração no bucket só pelo backend (service role), então não criamos
-- policy de insert/update/delete pra anon/authenticated de propósito.
