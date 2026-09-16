-- Reestruturação: automação do Drive deixa de ser uma configuração única
-- (mirando várias contas via account_ids) e vira uma configuração por
-- conta — cada conta pode ter sua própria pasta do Drive e horário. Já
-- aplicado direto no projeto via Supabase MCP (16/09/2026) — este arquivo é
-- só o registro/documentação, não precisa rodar de novo.
--
-- A linha única que existia (mirava Jaboticabal + Bebedouro) foi migrada
-- pra duas linhas, uma por conta, copiando pasta_drive_id/horario_publicacao
-- — funcionalmente idêntico no dia seguinte à migração. Se quiser pastas
-- diferentes por conta depois, edita cada uma independente na tela.

alter table public.drive_config
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;

-- Remove a PK antiga (id=1 fixo) ANTES de inserir a segunda linha, senão o
-- default de id (sempre 1) colide com a linha original.
alter table public.drive_config drop constraint drive_config_pkey;

do $$
declare
  rec record;
  primeira boolean := true;
  acc uuid;
begin
  select * into rec from public.drive_config where id = 1;
  if rec is null or array_length(rec.account_ids, 1) is null then
    return;
  end if;

  foreach acc in array rec.account_ids loop
    if primeira then
      update public.drive_config set account_id = acc where id = 1;
      primeira := false;
    else
      insert into public.drive_config (pasta_drive_id, horario_publicacao, account_id)
      values (rec.pasta_drive_id, rec.horario_publicacao, acc);
    end if;
  end loop;
end $$;

alter table public.drive_config alter column account_id set not null;
alter table public.drive_config add primary key (account_id);
alter table public.drive_config drop column id;
alter table public.drive_config drop column account_ids;

-- Cada execução passa a saber de qual conta é (linhas antigas ficam com
-- account_id null — só histórico, sem problema).
alter table public.drive_execucoes
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;

-- drive_lock: a trava vira por (conta, dia) em vez de só por dia — senão a
-- automação de uma conta bloquearia a da outra no mesmo dia. Estado
-- transitório (só lock/log operacional), não é dado de negócio — limpa e
-- recomeça.
truncate table public.drive_lock;
alter table public.drive_lock
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;
alter table public.drive_lock drop constraint drive_lock_pkey;
alter table public.drive_lock alter column account_id set not null;
alter table public.drive_lock add primary key (account_id, dia);

drop function if exists public.reivindicar_ingestao_drive(date);

create or replace function public.reivindicar_ingestao_drive(p_account_id uuid, p_dia date)
returns table (reivindicado boolean) as $$
declare
  v_dia date;
begin
  insert into public.drive_lock (account_id, dia, status)
  values (p_account_id, p_dia, 'processando')
  on conflict (account_id, dia) do update set status = 'processando', updated_at = now()
    where public.drive_lock.status = 'erro'
  returning public.drive_lock.dia into v_dia;

  if v_dia is null then
    return query select false;
  else
    return query select true;
  end if;
end;
$$ language plpgsql;
