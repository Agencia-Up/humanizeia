-- ============================================================================
-- 05/06/2026 — Modulo Regras de Seguranca (FASE 1: banco)
-- ----------------------------------------------------------------------------
-- 3 tabelas:
--   security_rule_profiles    -> os perfis de regras (limites)
--   security_rule_assignments -> a quem o perfil se aplica (todos / membros)
--   security_rule_violations  -> tentativas bloqueadas (auditoria)
-- Decisao (05/06): FONTE UNICA — estes perfis passam a mandar nos limites de
-- disparo/follow-up (integracao do enforcement vem em fase posterior).
-- RLS: tudo isolado por master_account_id (= auth.uid() do master).
-- Obs: ai_team_members nao distingue vendedor x colaborador hoje; target_type
-- ja deixa preparado ('all'/'seller'/'collaborator') pra quando isso existir.
-- ============================================================================

create table if not exists security_rule_profiles (
  id uuid primary key default gen_random_uuid(),
  master_account_id uuid not null,
  name text not null,
  is_active boolean not null default true,
  -- Disparo em massa
  bulk_send_enabled boolean not null default true,
  bulk_send_daily_limit int not null default 30 check (bulk_send_daily_limit between 1 and 200),
  bulk_send_min_interval_sec int not null default 10 check (bulk_send_min_interval_sec between 1 and 60),
  bulk_send_max_batch int not null default 100 check (bulk_send_max_batch between 10 and 500),
  -- Follow-up manual
  manual_followup_enabled boolean not null default true,
  manual_followup_daily_limit int not null default 20 check (manual_followup_daily_limit between 1 and 100),
  manual_followup_min_interval_min int not null default 60 check (manual_followup_min_interval_min between 30 and 1440),
  -- Mensagens individuais
  individual_msg_daily_limit int not null default 200 check (individual_msg_daily_limit between 50 and 1000),
  individual_msg_min_interval_sec int not null default 3 check (individual_msg_min_interval_sec between 1 and 30),
  -- Horarios permitidos
  allowed_send_start_time time not null default '08:00:00',
  allowed_send_end_time time not null default '20:00:00',
  block_weekends boolean not null default false,
  -- Automacao
  automation_enabled boolean not null default true,
  automation_daily_limit int not null default 150 check (automation_daily_limit between 50 and 500),
  -- Anti-spam
  antispam_max_identical_per_hour int not null default 5 check (antispam_max_identical_per_hour between 1 and 20),
  antispam_block_on_limit boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_srp_master on security_rule_profiles(master_account_id);

create table if not exists security_rule_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references security_rule_profiles(id) on delete cascade,
  master_account_id uuid not null,
  target_type text not null default 'all' check (target_type in ('all','seller','collaborator')),
  target_member_id uuid references ai_team_members(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_sra_master on security_rule_assignments(master_account_id);
create index if not exists idx_sra_profile on security_rule_assignments(profile_id);
create index if not exists idx_sra_member on security_rule_assignments(target_member_id);

create table if not exists security_rule_violations (
  id uuid primary key default gen_random_uuid(),
  master_account_id uuid not null,
  user_id uuid not null,
  action_type text not null,
  rule_violated text not null,
  limit_value int,
  current_value int,
  attempted_at timestamptz not null default now()
);
create index if not exists idx_srv_master on security_rule_violations(master_account_id);
create index if not exists idx_srv_attempted on security_rule_violations(master_account_id, attempted_at desc);

-- RLS — master so enxerga/gerencia o que e dele. Enforcement roda server-side
-- (service role bypassa RLS), entao perfis ficam master-only.
alter table security_rule_profiles enable row level security;
drop policy if exists srp_master_all on security_rule_profiles;
create policy srp_master_all on security_rule_profiles for all
  using (master_account_id = auth.uid()) with check (master_account_id = auth.uid());

alter table security_rule_assignments enable row level security;
drop policy if exists sra_master_all on security_rule_assignments;
create policy sra_master_all on security_rule_assignments for all
  using (master_account_id = auth.uid()) with check (master_account_id = auth.uid());

alter table security_rule_violations enable row level security;
drop policy if exists srv_master_select on security_rule_violations;
create policy srv_master_select on security_rule_violations for select
  using (master_account_id = auth.uid());
