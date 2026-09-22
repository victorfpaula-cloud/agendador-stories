-- CicloStory ganha (1) uma chave de ligar/desligar por categoria — pausa
-- sem apagar nada, mantém horários/imagens/histórico intactos — e (2)
-- escolha aleatória entre os itens "empatados" na prioridade (nunca-usados
-- entre si) em vez de sempre seguir a ordem em que foram enviados.
--
-- Já aplicado em produção em 22/09/2026 (via mcp__Supabase__apply_migration,
-- migração "story_ciclo_categoria_ativa_e_sorteio"). Este arquivo documenta
-- a mudança pra quem for rodar uma instalação nova do zero (roda depois de
-- supabase/story-ciclo.sql).

alter table public.story_ciclo_categoria add column ativa boolean not null default true;

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

  -- Critério principal continua "usado_em nulls first" (garante o ciclo
  -- sem repetir antes de girar tudo) — só o desempate deixou de ser
  -- created_at (ordem de upload) e virou random().
  select * into v_item
    from public.story_ciclo_item
   where category_id = v_category_id
   order by usado_em nulls first, random()
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
    update public.story_ciclo_item set usado_em = v_usado_em_anterior where id = v_item.id;
    return query select false, 'ja_existe', null::uuid;
    return;
  end if;

  return query select true, 'gerado', v_new_id;
end;
$$;
