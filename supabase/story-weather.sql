-- Story Weather (Story Engine): publica Stories prontos quando o tempo
-- combina (chuva agora / dia muito quente). Módulo isolado: tabelas, motor
-- (src/lib/engines/publicarStoryWeather.ts) e tela próprios.
-- Já aplicado em produção (migração "story_weather").

create table public.story_weather_config (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  ativo boolean not null default false,
  cidade text,
  latitude numeric(8,4),
  longitude numeric(8,4),
  chuva_ativa boolean not null default true,
  calor_ativo boolean not null default false,
  calor_graus int not null default 34,
  janela_inicio time not null default '09:00',
  janela_fim time not null default '22:00',
  max_chuva_por_dia int not null default 1,
  -- estado do motor: leituras seguidas com chuva (precisa de 2) e a última leitura
  chuva_confirmacoes int not null default 0,
  ultima_checagem timestamptz,
  ultima_leitura jsonb,
  updated_at timestamptz not null default now()
);

create table public.story_weather_itens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  tipo text not null check (tipo in ('chuva','calor')),
  media_url text not null,
  media_path text not null,
  media_type text not null check (media_type in ('IMAGE','VIDEO')),
  thumbnail_data_url text,
  usado_em timestamptz,
  created_at timestamptz not null default now()
);
create index story_weather_itens_conta_tipo_idx on public.story_weather_itens (account_id, tipo);

-- Um registro por tentativa/publicação. A trava (conta, tipo, dia, seq) é o que
-- impede publicar duas vezes ao mesmo tempo. Nunca é podado.
create table public.story_weather_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  tipo text not null check (tipo in ('chuva','calor')),
  dia date not null,
  seq int not null,
  status text not null default 'publishing' check (status in ('publishing','success','error')),
  item_id uuid references public.story_weather_itens(id) on delete set null,
  ig_media_id text,
  leitura jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (account_id, tipo, dia, seq)
);

alter table public.story_weather_config enable row level security;
alter table public.story_weather_itens enable row level security;
alter table public.story_weather_posts enable row level security;
