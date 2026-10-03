-- Dias fechados por conta (Victor pediu em 03/10/2026): num dia marcado, a
-- conta não publica NADA — nem Stories (semanal, Story Engine, AutoStory)
-- nem Feed/Reels/carrossel. No dia seguinte tudo volta ao normal. Os motores
-- consultam esta tabela na hora de publicar (src/lib/diasFechados.ts).
-- Aplicado em produção (migração "dias_fechados").
create table public.dias_fechados (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  dia date not null,
  motivo text,
  created_at timestamptz not null default now(),
  unique (account_id, dia)
);
create index dias_fechados_dia_idx on public.dias_fechados (dia);
alter table public.dias_fechados enable row level security;
