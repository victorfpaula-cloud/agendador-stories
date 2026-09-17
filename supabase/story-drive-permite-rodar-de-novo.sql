-- Achado em 17/09/2026: Victor clicou em "Tentar de novo agora" depois de
-- adicionar um arquivo novo na pasta do dia (arquivo 2), mas o robô nem
-- chegou a olhar a pasta — respondeu "já processei hoje" e parou. Ele
-- confirmou que costuma adicionar arquivo 2, 3 na pasta ao longo do dia
-- (não tudo de uma vez de manhã), então "Tentar de novo agora" precisa
-- funcionar a qualquer momento, não só quando a execução automática falhou.
--
-- Corrigido em duas partes:
--   1. src/lib/storyDriveIngestao.ts agora compara por scheduled_at exato
--      (cada posição/horário) em vez de checar "já existe QUALQUER Story
--      criado hoje" — rodar de novo só processa as posições que ainda não
--      têm Story, sem duplicar as que já têm.
--   2. Com isso seguro, a trava (esta migração) libera pra reivindicar de
--      novo também depois de 'sucesso', não só depois de 'erro' — vira só
--      um mutex contra execução concorrente, não mais um "só 1x por dia".
-- Já aplicado direto no projeto via Supabase MCP (migração
-- story_drive_permite_rodar_de_novo) e testado com dados fake (2099-01-01):
-- reivindica, libera de novo depois de sucesso (mesmo "quente"), continua
-- bloqueando enquanto genuinamente 'processando' agora. Este arquivo é só
-- o registro.
--
-- Isso é diferente do Drive do Feed DE PROPÓSITO: lá um post agrupa TODOS
-- os arquivos do dia num carrossel único — rodar de novo depois de sucesso
-- criaria um segundo post duplicado com o mesmo conteúdo. O Drive do Feed
-- continua só 1x por dia (reivindicar_ingestao_drive não mudou aqui).

create or replace function public.reivindicar_ingestao_story_drive(p_account_id uuid, p_dia date)
returns table (reivindicado boolean) as $$
declare
  v_dia date;
begin
  insert into public.story_drive_lock (account_id, dia, status)
  values (p_account_id, p_dia, 'processando')
  on conflict (account_id, dia) do update set status = 'processando', updated_at = now()
    where public.story_drive_lock.status in ('erro', 'sucesso')
       or (public.story_drive_lock.status = 'processando' and public.story_drive_lock.updated_at < now() - interval '10 minutes')
  returning public.story_drive_lock.dia into v_dia;

  if v_dia is null then
    return query select false;
  else
    return query select true;
  end if;
end;
$$ language plpgsql;
