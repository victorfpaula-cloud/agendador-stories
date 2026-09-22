-- CicloStory: banco de imagens/vídeos por categoria, que gira sem repetir.
-- Cada categoria já é o "slot" completo (nome + dias da semana ativos +
-- horários + galeria de mídia) — pedido do Victor pra não precisar de duas
-- telas separadas (categoria e horário). Módulo isolado de AutoFeed/
-- AutoStory: tabelas, rotas e crons próprios, sem nenhum ponto de contato
-- por baixo dos panos.
--
-- Já aplicado em produção em 22/09/2026 (via mcp__Supabase__apply_migration,
-- migrações "story_ciclo_categorias" e "story_ciclo_posts_horario_set_null").
-- Este arquivo documenta a mudança pra quem for rodar uma instalação nova
-- do zero.

create table public.story_ciclo_categoria (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  nome text not null,
  -- 1 = segunda ... 7 = domingo (mesma convenção de schedule_slots.day_of_week).
  dias_semana int[] not null default '{1,2,3,4,5,6,7}',
  created_at timestamptz not null default now()
);

create table public.story_ciclo_horario (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.story_ciclo_categoria(id) on delete cascade,
  horario time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- O "balde" de imagens/vídeos de cada categoria. `usado_em` nulo = nunca
-- publicada ainda. A escolha de qual publicar é sempre "a que está há mais
-- tempo sem uso" (nulos primeiro) — isso já dá de graça o ciclo que
-- recomeça sozinho pra sempre, sem precisar resetar nada quando esgota.
create table public.story_ciclo_item (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.story_ciclo_categoria(id) on delete cascade,
  media_url text not null,
  media_path text not null,
  media_type text not null check (media_type in ('IMAGE', 'VIDEO')),
  thumbnail_data_url text,
  usado_em timestamptz,
  created_at timestamptz not null default now()
);

-- Um Story gerado pelo CicloStory — mesmo ciclo de vida (pending/publishing/
-- success/error) dos outros motores de publicação, mas nesse módulo o motor
-- de geração nunca baixa nada de fora (a mídia já está no nosso Storage
-- desde o upload): só escolhe o item da vez e copia os dados pra cá.
-- media_url/media_path são cópia própria (não um link vivo pro item) —
-- apagar o item do balde ou o horário depois não quebra um Story já
-- gerado (por isso horario_id e item_id usam "on delete set null").
create table public.story_ciclo_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  category_id uuid not null references public.story_ciclo_categoria(id) on delete cascade,
  horario_id uuid references public.story_ciclo_horario(id) on delete set null,
  item_id uuid references public.story_ciclo_item(id) on delete set null,
  dia date not null,
  scheduled_at timestamptz not null,
  media_url text,
  media_path text,
  media_type text not null check (media_type in ('IMAGE', 'VIDEO')),
  thumbnail_data_url text,
  status text not null default 'pending' check (status in ('pending', 'publishing', 'success', 'error')),
  ig_media_id text,
  error_message text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (horario_id, dia)
);

-- Reivindica + gera o Story de um horário/dia de uma vez só, numa
-- transação: escolhe o item menos usado da categoria (FOR UPDATE SKIP
-- LOCKED evita duas execuções pegarem o mesmo item ao mesmo tempo), marca
-- ele como usado, e insere o Story. Se (horario_id, dia) já existir, não
-- faz nada. Se a categoria estiver sem nenhum item, também não faz nada.
create or replace function public.gerar_story_ciclo(p_horario_id uuid, p_dia date)
returns table(gerado boolean, motivo text, post_id uuid)
language plpgsql
as $$
declare
  v_account_id uuid;
  v_category_id uuid;
  v_horario time;
  v_item record;
  v_usado_em_anterior timestamptz;
  v_new_id uuid;
begin
  select c.account_id, h.category_id, h.horario
    into v_account_id, v_category_id, v_horario
    from public.story_ciclo_horario h
    join public.story_ciclo_categoria c on c.id = h.category_id
   where h.id = p_horario_id;

  if not found then
    return query select false, 'horario_nao_encontrado', null::uuid;
    return;
  end if;

  if exists (select 1 from public.story_ciclo_posts where horario_id = p_horario_id and dia = p_dia) then
    return query select false, 'ja_existe', null::uuid;
    return;
  end if;

  select * into v_item
    from public.story_ciclo_item
   where category_id = v_category_id
   order by usado_em nulls first, created_at asc
   limit 1
   for update skip locked;

  if not found then
    return query select false, 'sem_itens', null::uuid;
    return;
  end if;

  v_usado_em_anterior := v_item.usado_em;
  update public.story_ciclo_item set usado_em = now() where id = v_item.id;

  insert into public.story_ciclo_posts (
    account_id, category_id, horario_id, item_id, dia, scheduled_at,
    media_url, media_path, media_type, thumbnail_data_url, status
  ) values (
    v_account_id, v_category_id, p_horario_id, v_item.id, p_dia,
    (p_dia + v_horario) at time zone 'America/Sao_Paulo',
    v_item.media_url, v_item.media_path, v_item.media_type, v_item.thumbnail_data_url, 'pending'
  )
  on conflict (horario_id, dia) do nothing
  returning id into v_new_id;

  if v_new_id is null then
    -- Corrida rara com outra execução concorrente pro mesmo horário/dia —
    -- devolve o item reservado pro pool, já que não foi usado de verdade.
    update public.story_ciclo_item set usado_em = v_usado_em_anterior where id = v_item.id;
    return query select false, 'ja_existe', null::uuid;
    return;
  end if;

  return query select true, 'gerado', v_new_id;
end;
$$;

create index story_ciclo_horario_category_idx on public.story_ciclo_horario (category_id);
create index story_ciclo_item_category_idx on public.story_ciclo_item (category_id);
create index story_ciclo_posts_status_idx on public.story_ciclo_posts (status, scheduled_at);
