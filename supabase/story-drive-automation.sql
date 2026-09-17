-- Sub-módulo novo: Story Automático via Drive (17/09/2026). Mesma ideia do
-- Drive do Feed (supabase/feed-posts.sql + drive_config-por-conta.sql), mas
-- pra Stories — com diferenças importantes porque a API do Instagram não
-- tem "carrossel" de Story: cada arquivo vira uma publicação separada.
-- Já aplicado direto no projeto via Supabase MCP (migração
-- story_drive_automation) e testado com dia fake (2099-01-01) antes de ir
-- pro código — este arquivo é só o registro/documentação.
--
-- Diferenças em relação ao Drive do Feed:
--   * até 5 arquivos por dia, CADA UM com seu próprio horário configurado
--     (horario_1..horario_5) — o arquivo N (na ordem alfabética de sempre,
--     mesmo critério do Feed) só é publicado se horario_N estiver
--     preenchido; em branco, esse arquivo é ignorado, mesmo que exista.
--   * pasta do dia é direto "DD-MM-AAAA" dentro da pasta-mãe — sem pasta de
--     mês no meio (layout diferente do Drive do Feed, confirmado por
--     Victor com print real do Drive dele).
--   * sem legenda — Stories não têm.
--   * TODOS os arquivos de imagem/vídeo da pasta contam, sem filtrar por
--     nome (Victor confirmou que podem chegar arquivos com outros nomes
--     misturados na mesma pasta, tipo conteúdo de Delivery).

create table public.story_drive_config (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  pasta_drive_id text,
  horario_1 time,
  horario_2 time,
  horario_3 time,
  horario_4 time,
  horario_5 time,
  updated_at timestamptz not null default now()
);

alter table public.story_drive_config enable row level security;

-- Trava por conta+dia, mesmo padrão de reivindicar_ingestao_drive (evita
-- ingestão duplicada quando o pg_net retenta uma chamada que só pareceu ter
-- travado por timeout, mas ainda está processando por trás).
create table public.story_drive_lock (
  account_id uuid not null references public.accounts(id) on delete cascade,
  dia date not null,
  status text not null check (status in ('processando', 'sucesso', 'erro')),
  updated_at timestamptz not null default now(),
  primary key (account_id, dia)
);

alter table public.story_drive_lock enable row level security;

create table public.story_drive_execucoes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  executado_em timestamptz not null default now(),
  resultado text not null check (resultado in ('sem_config', 'sem_pasta', 'sem_horario', 'ja_existe', 'stories_criados', 'erro')),
  detalhe text,
  created_at timestamptz not null default now()
);

alter table public.story_drive_execucoes enable row level security;

-- Um Story pendente/publicado/com erro, criado automaticamente a partir do
-- Drive. Cada linha é uma publicação de Story independente (sem carrossel) —
-- motor de publicação próprio (/api/cron/publicar-stories-drive), isolado
-- do motor semanal (/api/cron/run) e do motor do Feed
-- (/api/cron/publicar-feed).
create table public.story_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  scheduled_at timestamptz not null,
  media_url text,
  media_path text,
  media_type text not null check (media_type in ('IMAGE', 'VIDEO')),
  thumbnail_data_url text,
  source text not null default 'drive' check (source in ('drive')),
  status text not null default 'pending' check (status in ('pending', 'publishing', 'success', 'error')),
  ig_media_id text,
  error_message text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.story_posts enable row level security;
create index story_posts_pending_idx on public.story_posts(scheduled_at) where status = 'pending';

create or replace function public.reivindicar_ingestao_story_drive(p_account_id uuid, p_dia date)
returns table (reivindicado boolean) as $$
declare
  v_dia date;
begin
  insert into public.story_drive_lock (account_id, dia, status)
  values (p_account_id, p_dia, 'processando')
  on conflict (account_id, dia) do update set status = 'processando', updated_at = now()
    where public.story_drive_lock.status = 'erro'
  returning public.story_drive_lock.dia into v_dia;

  if v_dia is null then
    return query select false;
  else
    return query select true;
  end if;
end;
$$ language plpgsql;

-- Cron de ingestão (lê a pasta 1x por dia, às 9h horário de Brasília =
-- 12:00 UTC) e cron de publicação (a cada 5 min) — ver supabase/cron.sql
-- pro padrão; comandos exatos aplicados via Supabase MCP:
--
-- select cron.schedule(
--   'ler-stories-drive-diario',
--   '0 12 * * *',
--   $cmd$
--     select net.http_post(
--       url := 'https://SEU-DOMINIO.vercel.app/api/cron/ler-stories-drive',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-cron-secret', 'COLE_AQUI_O_MESMO_VALOR_DE_CRON_SECRET'
--       ),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 55000
--     );
--   $cmd$
-- );
--
-- select cron.schedule(
--   'publicar-stories-drive-agendado',
--   '*/5 * * * *',
--   $cmd$
--     select net.http_post(
--       url := 'https://SEU-DOMINIO.vercel.app/api/cron/publicar-stories-drive',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-cron-secret', 'COLE_AQUI_O_MESMO_VALOR_DE_CRON_SECRET'
--       ),
--       body := '{}'::jsonb
--     );
--   $cmd$
-- );
