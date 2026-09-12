-- Corrige o bug que causava Stories duplicados no Instagram (achado em
-- 11-12/09/2026, conta "Único Sushi Bar"). Já aplicado direto no projeto via
-- Supabase MCP — este arquivo é só o registro/documentação do que foi feito,
-- não precisa rodar de novo.
--
-- Causa raiz: o Supabase (pg_net) às vezes desiste de esperar resposta da
-- rota /api/cron/run por timeout e manda a chamada de novo, enquanto a
-- primeira ainda está publicando por trás (confirmado no log
-- net._http_response — a mesma chamada aparecia com "timed_out":true uma ou
-- duas vezes antes do "200 OK" real). A rota só verificava "já publiquei
-- com sucesso?" antes de começar — duas chamadas concorrentes viam "ainda
-- não" ao mesmo tempo e as duas publicavam no Instagram.
--
-- Correção: um novo status 'publishing' + uma função que reivindica
-- atomicamente o horário antes de publicar (mesma ideia que o módulo de
-- Feed já usava, só que adaptada pro formato do publish_log). Só uma
-- execução consegue "ganhar" o slot+dia; a outra vê reivindicado=false e
-- desiste sem publicar de novo.

alter table public.publish_log
  drop constraint publish_log_status_check;

alter table public.publish_log
  add constraint publish_log_status_check
  check (status = any (array['success'::text, 'error'::text, 'publishing'::text]));

create or replace function public.reivindicar_publicacao(
  p_slot_id uuid,
  p_account_id uuid,
  p_scheduled_for date
) returns table (reivindicado boolean, primeira_tentativa boolean) as $$
declare
  v_id uuid;
  v_foi_insercao boolean;
begin
  insert into public.publish_log (slot_id, account_id, scheduled_for, status, error_message)
  values (p_slot_id, p_account_id, p_scheduled_for, 'publishing', null)
  on conflict (slot_id, scheduled_for)
  do update set status = 'publishing'
    where public.publish_log.status = 'error'
  returning public.publish_log.id, (xmax = 0) into v_id, v_foi_insercao;

  if v_id is null then
    return query select false, false;
  else
    return query select true, v_foi_insercao;
  end if;
end;
$$ language plpgsql;
