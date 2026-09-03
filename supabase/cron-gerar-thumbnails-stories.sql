-- Agenda a rotina que preenche a miniatura das fotos de Stories antigas,
-- pra rodar sozinha a cada 5 minutos — Database > SQL Editor > New query.
--
-- Rota própria e isolada, separada da que publica os Stories de verdade
-- (/api/cron/run) — zero risco de uma atrapalhar a outra. Processa só um
-- lotinho pequeno por vez, então é seguro deixar agendada pra sempre: depois
-- que preencher tudo, cada execução só confere que não sobrou nada e não
-- faz mais nada (praticamente de graça).
--
-- Não precisa preencher URL nem segredo nenhum à mão: o bloco abaixo pega
-- automaticamente a mesma URL/segredo já usados no cron que publica os
-- Stories de verdade (job "publicar-stories-agendados", criado por
-- supabase/cron.sql) e só troca o caminho no final da URL.

do $$
declare
  comando_existente text;
  comando_novo text;
begin
  select command into comando_existente
  from cron.job
  where jobname = 'publicar-stories-agendados';

  if comando_existente is null then
    raise exception
      'Não encontrei o cron "publicar-stories-agendados" (o que já publica os Stories). '
      'Se o nome dele for outro no seu banco, rode "select jobname from cron.job;" pra achar '
      'o nome certo e me avise.';
  end if;

  comando_novo := replace(comando_existente, '/api/cron/run', '/api/cron/gerar-thumbnails-stories');

  perform cron.schedule('gerar-thumbnails-stories', '*/5 * * * *', comando_novo);
end $$;

-- Pra conferir se está agendado (e ver a URL que ele copiou, se quiser):
-- select jobname, schedule, command from cron.job where jobname = 'gerar-thumbnails-stories';
--
-- Pra remover, se precisar (ex: depois de confirmar que não sobrou nenhuma
-- foto sem miniatura):
-- select cron.unschedule('gerar-thumbnails-stories');
