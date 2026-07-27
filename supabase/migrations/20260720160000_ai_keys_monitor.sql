-- ============================================================================
-- Monitor automatico das chaves de IA da plataforma (OpenAI/Anthropic/DeepSeek/
-- Gemini). Motivo: a chave da Anthropic ficou SEM CREDITO de 16/07 a 20/07 e o
-- cerebro de feedback falhou 4 dias em silencio — ninguem foi avisado.
-- A aba Administracao > Provedores de IA ja sonda AO VIVO, mas so quando o dono
-- abre a tela. Este monitor roda a cada 15 min via cron (admin-ai-providers com
-- {monitor:true}), guarda o estado, e a edge alerta os superadmins por e-mail
-- quando uma chave CAI (e quando VOLTA), com re-alerta a cada 6h enquanto caida.
-- ============================================================================

-- Estado atual de cada provedor (1 linha por provedor)
create table if not exists public.ai_provider_health (
  provider      text primary key,
  status        text not null,             -- ok | quota | auth | rate | down | other | no_key
  detalhe       text,
  http_status   integer,
  in_use        boolean not null default false,
  checked_at    timestamptz not null default now(),
  last_ok_at    timestamptz,
  down_since    timestamptz,
  last_alert_at timestamptz,
  updated_at    timestamptz not null default now()
);

-- Trilha de eventos (caiu / voltou / alerta_repetido) pro painel e auditoria
create table if not exists public.ai_provider_health_log (
  id         uuid primary key default gen_random_uuid(),
  provider   text not null,
  evento     text not null,                -- caiu | voltou | alerta_repetido
  status     text,
  detalhe    text,
  created_at timestamptz not null default now()
);
create index if not exists ai_provider_health_log_created_idx
  on public.ai_provider_health_log (created_at desc);

-- RLS: leitura so superadmin (escrita so service_role, que ignora RLS)
alter table public.ai_provider_health enable row level security;
alter table public.ai_provider_health_log enable row level security;
drop policy if exists superadmin_read_ai_health on public.ai_provider_health;
create policy superadmin_read_ai_health on public.ai_provider_health
  for select using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin = true));
drop policy if exists superadmin_read_ai_health_log on public.ai_provider_health_log;
create policy superadmin_read_ai_health_log on public.ai_provider_health_log
  for select using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin = true));

-- Cron: checa a cada 15 min (ping de 1 token por provedor — custo desprezivel)
select cron.unschedule('ai-keys-monitor-15min')
 where exists (select 1 from cron.job where jobname = 'ai-keys-monitor-15min');
select cron.schedule(
  'ai-keys-monitor-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/admin-ai-providers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)),
    body := jsonb_build_object('monitor', true),
    timeout_milliseconds := 60000)
  $$
);
