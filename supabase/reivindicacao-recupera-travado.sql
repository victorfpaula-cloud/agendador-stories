-- Achado em 16-17/09/2026: 2 Stories da conta "Único Sushi Bar" (11h e 17h
-- de uma quarta-feira) ficaram travados em status 'publishing' pra sempre —
-- bolinha amarela ("aguardando") na tela, sem nunca virar verde (sucesso)
-- nem vermelha (erro), e sem nenhum e-mail de aviso.
--
-- Causa raiz: se a função da Vercel travar/expirar no meio da publicação
-- (limite de 60s do plano Hobby — ver maxDuration em /api/cron/run — ou
-- qualquer outro jeito de morrer no meio do caminho sem passar pelo catch),
-- a reivindicação (reivindicar_publicacao) já tinha marcado o slot como
-- 'publishing' antes de tentar publicar de verdade. A trava só permitia
-- reivindicar de novo depois de um status 'erro' — nunca depois de
-- 'publishing' travado — então esse horário ficava preso pra sempre: o
-- catch que registraria o erro e mandaria o e-mail nunca roda (o processo
-- morreu antes de chegar lá), e as próximas execuções do cron (a cada 5 min)
-- veem 'publishing' e pulam, achando que outra execução ainda está
-- processando.
--
-- Mesma vulnerabilidade estrutural existia nos outros dois módulos de Drive
-- (drive_lock e story_drive_lock, ambos criados neste mesmo mês) — corrigido
-- nos três de uma vez. Já aplicado direto no projeto via Supabase MCP
-- (migração reivindicacao_recupera_travado) e testado com dados fake
-- (2099-01-01, nos três) cobrindo: reivindica, bloqueia enquanto "quente"
-- (< 10 min), libera de novo depois de "frio" (> 10 min), e nunca libera
-- depois de sucesso — antes de aplicar de vez. Este arquivo é só o registro.
--
-- Correção: além do 'erro' de sempre, também permite reivindicar de novo se
-- o status ainda for o transitório ('publishing'/'processando') MAS já faz
-- mais de 10 minutos desde a última atualização — bem mais que qualquer
-- execução legítima (o teto da própria Vercel é 60s), então depois disso só
-- pode significar que a tentativa anterior morreu no meio do caminho.
--
-- Reforço complementar (não substitui a correção acima, só reduz a chance de
-- precisar dela): esperarContainerFicarPronto, dentro de publicarStory
-- (src/lib/meta.ts), passou de 60s pra 40s de espera — deixando ~20s de
-- folga real dentro do limite de 60s da Vercel pro resto da função
-- (reivindicação, criar container, publicar, gravar no banco) terminar a
-- tempo de registrar sucesso ou erro corretamente, em vez de ser morta no
-- meio do caminho.

alter table public.publish_log add column if not exists updated_at timestamptz not null default now();

create or replace function public.reivindicar_publicacao(p_slot_id uuid, p_account_id uuid, p_scheduled_for date)
returns table (reivindicado boolean, primeira_tentativa boolean) as $$
declare
  v_id uuid;
  v_foi_insercao boolean;
begin
  insert into public.publish_log (slot_id, account_id, scheduled_for, status, error_message, updated_at)
  values (p_slot_id, p_account_id, p_scheduled_for, 'publishing', null, now())
  on conflict (slot_id, scheduled_for)
  do update set status = 'publishing', updated_at = now()
    where public.publish_log.status = 'error'
       or (public.publish_log.status = 'publishing' and public.publish_log.updated_at < now() - interval '10 minutes')
  returning public.publish_log.id, (xmax = 0) into v_id, v_foi_insercao;

  if v_id is null then
    return query select false, false;
  else
    return query select true, v_foi_insercao;
  end if;
end;
$$ language plpgsql;

create or replace function public.reivindicar_ingestao_drive(p_account_id uuid, p_dia date)
returns table (reivindicado boolean) as $$
declare
  v_dia date;
begin
  insert into public.drive_lock (account_id, dia, status)
  values (p_account_id, p_dia, 'processando')
  on conflict (account_id, dia) do update set status = 'processando', updated_at = now()
    where public.drive_lock.status = 'erro'
       or (public.drive_lock.status = 'processando' and public.drive_lock.updated_at < now() - interval '10 minutes')
  returning public.drive_lock.dia into v_dia;

  if v_dia is null then
    return query select false;
  else
    return query select true;
  end if;
end;
$$ language plpgsql;

create or replace function public.reivindicar_ingestao_story_drive(p_account_id uuid, p_dia date)
returns table (reivindicado boolean) as $$
declare
  v_dia date;
begin
  insert into public.story_drive_lock (account_id, dia, status)
  values (p_account_id, p_dia, 'processando')
  on conflict (account_id, dia) do update set status = 'processando', updated_at = now()
    where public.story_drive_lock.status = 'erro'
       or (public.story_drive_lock.status = 'processando' and public.story_drive_lock.updated_at < now() - interval '10 minutes')
  returning public.story_drive_lock.dia into v_dia;

  if v_dia is null then
    return query select false;
  else
    return query select true;
  end if;
end;
$$ language plpgsql;
