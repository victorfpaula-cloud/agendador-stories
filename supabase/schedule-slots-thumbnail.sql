-- Adiciona a miniatura pequena (preview) aos horários de Stories —
-- rode este arquivo no SQL Editor do seu projeto Supabase (Database > SQL
-- Editor > New query). Seguro rodar mesmo com a tabela já tendo dados: só
-- adiciona a coluna, não mexe em nenhum horário existente (eles continuam
-- funcionando normalmente, só ficam sem miniatura até a mídia deles ser
-- trocada de novo pela tela).
--
-- Por quê: igual ao módulo de Publicações, mostrar o preview de cada
-- horário usando o arquivo original inteiro (só pra desenhar um
-- quadradinho pequeno) gasta banda à toa toda vez que a tela de uma conta
-- é aberta — foi isso que estourou o Cached Egress do Supabase em
-- 02/09/2026. Diferente de Publicações, aqui o arquivo original nunca pode
-- ser apagado (o mesmo Story se repete toda semana), então a miniatura é
-- só um atalho pra não precisar carregar o arquivo grande à toa — o
-- original continua existindo e sendo usado pra publicar de verdade.

alter table public.schedule_slots
  add column if not exists thumbnail_data_url text;
