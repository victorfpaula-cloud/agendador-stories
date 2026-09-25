-- Consolidação dos crons pra reduzir "Fluid Active CPU" na Vercel (Victor
-- notou o uso subindo perto do teto no dashboard da Vercel em 25/09/2026).
-- Não muda nenhuma lógica de negócio nem mistura tabelas/dados entre os
-- módulos — só o JEITO como os robôs são disparados: em vez de cada motor
-- ter seu próprio cron batendo numa rota separada, agora tem uma rota
-- combinada que chama a lógica de cada motor (ainda isolada, em
-- src/lib/engines/*) dentro da MESMA execução de função.
--
-- Já aplicado em produção em 25/09/2026 (via mcp__Supabase__execute_sql,
-- direto — não precisou de mcp__Supabase__apply_migration porque não mexe
-- em tabela nenhuma, só na configuração dos jobs do pg_cron). Este arquivo
-- documenta a mudança pra quem for rodar uma instalação nova do zero.

-- Publicação (rodava em 5 crons de 5 em 5 min: Stories semanal, AutoFeed,
-- AutoStory, CicloStory, todos separados) -> 1 cron só, /api/cron/publicar-tudo.
select cron.unschedule('publicar-stories-agendados');
select cron.unschedule('publicar-feed-agendado');
select cron.unschedule('publicar-stories-drive-agendado');
select cron.unschedule('publicar-stories-ciclo-agendado');

select cron.schedule(
  'publicar-tudo-agendado',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://agendador-stories2.vercel.app/api/cron/publicar-tudo',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '<CRON_SECRET>'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $$
);

-- Geração de conteúdo novo (rodava em 2 crons de 30 em 30 min: AutoStory
-- lendo o Drive, CicloStory sorteando a próxima imagem) -> 1 cron só,
-- /api/cron/gerar-tudo.
select cron.unschedule('ler-stories-drive-diario');
select cron.unschedule('gerar-stories-ciclo-agendado');

select cron.schedule(
  'gerar-tudo-agendado',
  '*/30 * * * *',
  $$
    select net.http_post(
      url := 'https://agendador-stories2.vercel.app/api/cron/gerar-tudo',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '<CRON_SECRET>'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $$
);

-- gerar-thumbnails-stories (backfill de miniaturas antigas — deliberadamente
-- isolado do caminho de publicação, ver comentário na própria rota) não foi
-- juntado com nada: é um job de baixa urgência, então só reduzimos a
-- frequência dele de 5 em 5 min pra 30 em 30 min.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'gerar-thumbnails-stories'),
  schedule := '*/30 * * * *'
);

-- ler-drive-diario (AutoFeed, 1x/dia) não muda — frequência já era baixa.
