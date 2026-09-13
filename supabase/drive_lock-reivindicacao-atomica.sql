-- Corrige o mesmo bug do Story duplicado (ver
-- publish_log-reivindicacao-atomica.sql), agora achado na automação do
-- Drive (13/09/2026). Já aplicado direto no projeto via Supabase MCP —
-- este arquivo é só o registro/documentação, não precisa rodar de novo.
--
-- Achado: o cron "ler-drive-diario" (dispara 1x por dia) teve 4 tentativas
-- HTTP quase simultâneas registradas em net._http_response, cada uma com
-- seu próprio handshake TCP — o pg_net desiste de esperar resposta em só
-- 5 segundos (bem menos que o tempo real que baixar/subir um vídeo do
-- Drive pode levar) e manda a chamada de novo. A checagem antiga ("já
-- existe post do Drive hoje?") era um SELECT sem reivindicação — a mesma
-- vulnerabilidade de corrida que já tinha causado Story duplicado.
--
-- Correção: trava por dia, mesma ideia do reivindicar_publicacao. Só uma
-- execução consegue processar o dia por vez; libera de novo depois de um
-- erro (pro botão "Tentar de novo agora" ou o cron do dia seguinte
-- funcionarem), nunca depois de um post criado com sucesso.

create table if not exists public.drive_lock (
  dia date primary key,
  status text not null check (status in ('processando', 'sucesso', 'erro')),
  updated_at timestamptz not null default now()
);

alter table public.drive_lock enable row level security;

create or replace function public.reivindicar_ingestao_drive(p_dia date)
returns table (reivindicado boolean) as $$
declare
  v_dia date;
begin
  insert into public.drive_lock (dia, status)
  values (p_dia, 'processando')
  on conflict (dia) do update set status = 'processando', updated_at = now()
    where public.drive_lock.status = 'erro'
  returning public.drive_lock.dia into v_dia;

  if v_dia is null then
    return query select false;
  else
    return query select true;
  end if;
end;
$$ language plpgsql;

-- Também aumentado o timeout do pg_net pra esse cron especificamente, de
-- 5s (padrão) pra 55s (perto do máximo de 60s da função na Vercel) — reduz
-- a frequência das tentativas duplicadas, embora a trava acima já proteja
-- contra qualquer quantidade delas:
--
-- select cron.alter_job(
--   job_id := <id do job ler-drive-diario>,
--   command := $cmd$
--     select net.http_post(
--       url := 'https://SEU-DOMINIO.vercel.app/api/cron/ler-drive',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-cron-secret', 'COLE_AQUI_O_MESMO_VALOR_DE_CRON_SECRET'
--       ),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 55000
--     );
--   $cmd$
-- );
