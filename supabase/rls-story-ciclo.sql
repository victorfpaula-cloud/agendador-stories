-- RLS nas 4 tabelas do Story Engine (achado na revisão de segurança de
-- 30/09/2026): tinham sido criadas sem RLS, então qualquer um com a anon key
-- (que é pública no navegador) conseguia ler/alterar. O app só acessa essas
-- tabelas pelo servidor (chave de administrador, que ignora RLS), então
-- ligar sem nenhuma policy não quebra nada.
--
-- Já aplicado em produção em 30/09/2026 (migração "rls_story_ciclo").
alter table public.story_ciclo_categoria enable row level security;
alter table public.story_ciclo_horario enable row level security;
alter table public.story_ciclo_item enable row level security;
alter table public.story_ciclo_posts enable row level security;
