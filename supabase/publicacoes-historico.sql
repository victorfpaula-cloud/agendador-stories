-- Registro permanente de publicações (base do relatório mensal, pedido do
-- Victor em 30/09/2026). Motivo: AutoStory, Story Engine e Feed/Reels são
-- podados pelos próprios motores (só as 15 últimas publicações ficam nas
-- tabelas de origem), então contar o mês direto delas daria número errado.
-- Os Stories do Agendador (publish_log) NÃO são podados e o relatório lê
-- direto de lá — por isso "origem" aqui só tem as três que perdem histórico.
--
-- Alimentado por gatilhos no banco (nenhum motor de publicação foi
-- alterado): toda vez que uma linha dessas tabelas vira status 'success',
-- entra uma linha aqui, idempotente por (origem, ref_id). Não tem poda.
--
-- Já aplicado em produção em 30/09/2026 (via mcp__Supabase__apply_migration,
-- migração "publicacoes_historico"), junto com um preenchimento único com o
-- que ainda existia nas tabelas de origem naquele dia. Este arquivo
-- documenta a estrutura pra quem for rodar uma instalação nova do zero.

create table public.publicacoes_historico (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  origem text not null check (origem in ('story_engine','autostory','feed')),
  tipo text,            -- só pro feed: IMAGE / VIDEO / CAROUSEL / REELS
  dia date not null,    -- dia (fuso de São Paulo) em que a publicação saiu
  ref_id uuid not null, -- id da linha de origem (garante que não duplica)
  created_at timestamptz not null default now(),
  unique (origem, ref_id)
);
create index publicacoes_historico_conta_dia_idx on public.publicacoes_historico (account_id, dia);
alter table public.publicacoes_historico enable row level security;

create or replace function public.registrar_publicacao_historico()
returns trigger
language plpgsql
as $$
declare
  v_tipo text;
  v_dia date;
begin
  if tg_table_name = 'story_posts' then
    v_dia := coalesce(new.dia, (coalesce(new.published_at, now()) at time zone 'America/Sao_Paulo')::date);
    insert into public.publicacoes_historico (account_id, origem, dia, ref_id)
    values (new.account_id, 'autostory', v_dia, new.id)
    on conflict (origem, ref_id) do nothing;
  elsif tg_table_name = 'story_ciclo_posts' then
    v_dia := coalesce(new.dia, (coalesce(new.published_at, now()) at time zone 'America/Sao_Paulo')::date);
    insert into public.publicacoes_historico (account_id, origem, dia, ref_id)
    values (new.account_id, 'story_engine', v_dia, new.id)
    on conflict (origem, ref_id) do nothing;
  elsif tg_table_name = 'feed_post_accounts' then
    select media_type into v_tipo from public.feed_posts where id = new.feed_post_id;
    v_dia := (coalesce(new.published_at, now()) at time zone 'America/Sao_Paulo')::date;
    insert into public.publicacoes_historico (account_id, origem, tipo, dia, ref_id)
    values (new.account_id, 'feed', v_tipo, v_dia, new.id)
    on conflict (origem, ref_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger story_posts_historico after insert or update of status on public.story_posts
  for each row when (new.status = 'success') execute function public.registrar_publicacao_historico();
create trigger story_ciclo_posts_historico after insert or update of status on public.story_ciclo_posts
  for each row when (new.status = 'success') execute function public.registrar_publicacao_historico();
create trigger feed_post_accounts_historico after insert or update of status on public.feed_post_accounts
  for each row when (new.status = 'success') execute function public.registrar_publicacao_historico();
