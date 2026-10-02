-- Gerador de imagens (Nano Banana / Gemini) — Victor pediu em 01/10/2026.
-- Uma "marca" por conta (logo + estilo) e a galeria de imagens geradas.
-- O logo NUNCA passa pelo modelo: é colado por cima da imagem pronta pelo
-- servidor (sharp), então sai idêntico ao arquivo enviado.
-- Já aplicado em produção (migração "gerador_imagens").

insert into storage.buckets (id, name, public)
values ('gerador-imagens', 'gerador-imagens', true)
on conflict (id) do nothing;

create table public.gerador_marca (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  logo_path text,
  logo_posicao text not null default 'inferior-direito'
    check (logo_posicao in ('superior-esquerdo','superior-direito','inferior-esquerdo','inferior-direito','inferior-centro','superior-centro','centro')),
  logo_tamanho_pct int not null default 18 check (logo_tamanho_pct between 5 and 60),
  logo_margem_pct int not null default 5 check (logo_margem_pct between 0 and 20),
  estilo text not null default '',   -- cores, tom, estilo visual da marca (vai no prompt)
  updated_at timestamptz not null default now()
);
alter table public.gerador_marca enable row level security;

create table public.imagens_geradas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  storage_path text not null,
  url text not null,
  formato text not null,
  modelo text not null,
  modo text not null default 'criar',
  pedido text not null default '',
  prompt_final text not null default '',
  com_logo boolean not null default false,
  favorita boolean not null default false,
  origem_id uuid references public.imagens_geradas(id) on delete set null,
  created_at timestamptz not null default now()
);
create index imagens_geradas_conta_idx on public.imagens_geradas (account_id, created_at desc);
alter table public.imagens_geradas enable row level security;

-- Camada de texto profissional (01/10/2026): a IA gera só a arte (base_path,
-- sem texto) e o app escreve o texto com fontes de verdade por cima. `camada`
-- guarda as opções (texto, tema, posição, tamanho, cor, véu) pra reeditar o
-- texto depois sem gastar IA. Aplicado em produção (migração "gerador_camada_texto").
alter table public.imagens_geradas
  add column base_path text,
  add column camada jsonb;
