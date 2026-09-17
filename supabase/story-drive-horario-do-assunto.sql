-- AutoStory passa a receber o horário de cada Story embutido no nome do
-- arquivo do Drive (que por sua vez vem do assunto do e-mail que gera o
-- arquivo, via Google Apps Script) em vez dos 5 campos fixos de horário na
-- configuração da conta. Ver src/lib/storyDriveIngestao.ts pra lógica de
-- leitura, e src/app/api/story-posts/[id]/route.ts (PATCH) pro campinho
-- editável na lista de "Stories de hoje".
--
-- Já aplicado em produção em 17/09/2026 (via mcp__Supabase__apply_migration,
-- migração "story_drive_horario_do_assunto"). Este arquivo documenta a
-- mudança pra quem for rodar uma instalação nova do zero.

-- 1) story_posts precisa saber "de qual dia" é o Story mesmo quando ainda
--    não tem horário (scheduled_at nulo) — dia sempre vem preenchido (é o
--    dia da pasta do Drive lida), scheduled_at só depois que o horário for
--    definido (automático ou editado manualmente por Victor).
alter table public.story_posts add column dia date;
update public.story_posts set dia = (scheduled_at at time zone 'America/Sao_Paulo')::date where dia is null;
alter table public.story_posts alter column dia set not null;

alter table public.story_posts alter column scheduled_at drop not null;

-- 2) drive_file_id identifica de forma única cada arquivo do Drive já
--    processado (substitui o casamento por posição/horário de antes) — evita
--    duplicar Story quando "Tentar de novo agora" roda de novo no mesmo dia.
--    Nulo pra qualquer story_post que não tenha vindo do Drive (não existe
--    hoje, mas deixa a coluna correta pro futuro).
alter table public.story_posts add column drive_file_id text;
create unique index story_posts_account_drive_file_unique
  on public.story_posts (account_id, drive_file_id)
  where drive_file_id is not null;

-- 3) Configuração não guarda mais horário fixo nenhum — cada arquivo carrega
--    o seu próprio, embutido no nome pelo Google Apps Script.
alter table public.story_drive_config drop column horario_1;
alter table public.story_drive_config drop column horario_2;
alter table public.story_drive_config drop column horario_3;
alter table public.story_drive_config drop column horario_4;
alter table public.story_drive_config drop column horario_5;
