-- E-mail de erro só depois de esgotar as tentativas (3), não mais na
-- primeira falha — Victor pediu pra só ser avisado quando o robô realmente
-- desistiu, não a cada tentativa isolada que ainda vai ser repetida
-- sozinha. Vale pros 4 motores de publicação (Stories semanal, AutoFeed,
-- AutoStory, CicloStory).
--
-- Já aplicado em produção em 24/09/2026 (via mcp__Supabase__apply_migration,
-- migração "retry_antes_de_email_de_erro"). Este arquivo documenta a
-- mudança pra quem for rodar uma instalação nova do zero.

-- 1) Stories semanal (publish_log + reivindicar_publicacao): a função já
--    reivindicava de novo dentro da janela de tolerância de 15 min (a cada
--    ciclo do cron, 5 em 5 min) — só não expunha QUANTAS vezes já tentou.
--    Troca "primeira_tentativa" (boolean) por "tentativas" (contador), pra
--    a rota decidir se já é hora de avisar por e-mail ou se ainda vale
--    esperar o próximo ciclo tentar de novo sozinho.
alter table public.publish_log add column tentativas int not null default 0;

drop function if exists public.reivindicar_publicacao(uuid, uuid, date);

create function public.reivindicar_publicacao(p_slot_id uuid, p_account_id uuid, p_scheduled_for date)
returns table(reivindicado boolean, tentativas int)
language plpgsql
as $$
declare
  v_id uuid;
  v_tentativas int;
begin
  insert into public.publish_log (slot_id, account_id, scheduled_for, status, error_message, updated_at, tentativas)
  values (p_slot_id, p_account_id, p_scheduled_for, 'publishing', null, now(), 1)
  on conflict (slot_id, scheduled_for)
  do update set status = 'publishing', updated_at = now(), tentativas = public.publish_log.tentativas + 1
    where public.publish_log.status = 'error'
       or (public.publish_log.status = 'publishing' and public.publish_log.updated_at < now() - interval '10 minutes')
  returning public.publish_log.id, public.publish_log.tentativas into v_id, v_tentativas;

  if v_id is null then
    return query select false, 0;
  else
    return query select true, v_tentativas;
  end if;
end;
$$;

-- 2) AutoFeed (feed_post_accounts): não tinha retentativa nenhuma antes —
--    uma falha ia direto pra "error" e e-mail na hora. Contador por
--    conta-alvo (não pelo post inteiro), porque cada conta pode falhar e
--    ser reativada de forma independente das outras.
alter table public.feed_post_accounts add column tentativas int not null default 0;

-- 3) AutoStory (story_posts): mesma ideia, contador por Story.
alter table public.story_posts add column tentativas int not null default 0;

-- 4) CicloStory (story_ciclo_posts): mesma ideia, contador por Story.
alter table public.story_ciclo_posts add column tentativas int not null default 0;
