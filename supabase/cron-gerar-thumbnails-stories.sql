-- Agenda a rotina que preenche a miniatura das fotos de Stories antigas,
-- pra rodar sozinha a cada 5 minutos — Database > SQL Editor > New query.
-- Requer as mesmas extensões já usadas em supabase/cron.sql (pg_cron e
-- pg_net), então se você já rodou aquele arquivo não precisa instalar nada
-- de novo.
--
-- Rota própria e isolada, separada da que publica os Stories de verdade
-- (/api/cron/run) — zero risco de uma atrapalhar a outra. Processa só um
-- lotinho pequeno por vez, então é seguro deixar agendada pra sempre: depois
-- que preencher tudo, cada execução só confere que não sobrou nada e não
-- faz mais nada (praticamente de graça).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select
  cron.schedule(
    'gerar-thumbnails-stories',
    '*/5 * * * *',
    $$
    select net.http_post(
      url := 'https://SEU-DOMINIO.vercel.app/api/cron/gerar-thumbnails-stories',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'COLE_AQUI_O_MESMO_VALOR_DE_CRON_SECRET'
      ),
      body := '{}'::jsonb
    );
    $$
  );

-- Pra conferir se está agendado:
-- select * from cron.job;
-- Pra remover, se precisar (ex: depois de confirmar que não sobrou nenhuma
-- foto sem miniatura):
-- select cron.unschedule('gerar-thumbnails-stories');
