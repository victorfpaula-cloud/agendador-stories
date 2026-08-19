-- Agenda a rotina de publicação pra rodar a cada 5 minutos, direto no Postgres do Supabase.
-- Rode isso DEPOIS de já ter feito o deploy do site (precisa da URL final + do CRON_SECRET).
-- Database > SQL Editor > New query. Requer as extensões pg_cron e pg_net (Database > Extensions).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select
  cron.schedule(
    'publicar-stories-agendados',
    '*/5 * * * *',
    $$
    select net.http_post(
      url := 'https://SEU-DOMINIO.vercel.app/api/cron/run',
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
-- Pra remover, se precisar:
-- select cron.unschedule('publicar-stories-agendados');
