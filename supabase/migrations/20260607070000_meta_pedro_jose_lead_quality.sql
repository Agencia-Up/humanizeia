-- Meta Ads + Pedro + Jose lead quality integration (staging first)
-- Stores paid-origin metadata, Pedro AI classification, seller feedback,
-- Meta cost snapshots, and consolidated reports for Jose.

alter table public.ai_crm_leads
  add column if not exists meta_lead_id text,
  add column if not exists campaign_id text,
  add column if not exists campaign_name text,
  add column if not exists adset_id text,
  add column if not exists adset_name text,
  add column if not exists ad_id text,
  add column if not exists ad_name text,
  add column if not exists entry_channel text,
  add column if not exists entry_datetime timestamptz,
  add column if not exists paid_origin_payload jsonb not null default '{}'::jsonb;

create index if not exists idx_ai_crm_leads_meta_campaign
  on public.ai_crm_leads(user_id, campaign_id)
  where campaign_id is not null;

create index if not exists idx_ai_crm_leads_meta_ad
  on public.ai_crm_leads(user_id, ad_id)
  where ad_id is not null;

create index if not exists idx_ai_crm_leads_entry_datetime
  on public.ai_crm_leads(user_id, entry_datetime desc)
  where entry_datetime is not null;

create table if not exists public.lead_qualifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.ai_crm_leads(id) on delete cascade,
  ai_classification text not null check (ai_classification in ('qualificado', 'pouco_qualificado', 'inativo')),
  ai_classification_datetime timestamptz not null default now(),
  campaign_id text,
  adset_id text,
  ad_id text,
  source text not null default 'pedro',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create index if not exists idx_lead_qualifications_user_campaign
  on public.lead_qualifications(user_id, campaign_id, ai_classification);

create table if not exists public.seller_feedbacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.ai_crm_leads(id) on delete cascade,
  campaign_id text,
  ad_id text,
  seller_id uuid references public.ai_team_members(id) on delete set null,
  feedback text not null check (feedback in (
    'lead_bom',
    'lead_ruim',
    'sem_interesse',
    'nao_respondeu',
    'agendou',
    'venda_realizada'
  )),
  notes text,
  datetime timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create index if not exists idx_seller_feedbacks_user_campaign
  on public.seller_feedbacks(user_id, campaign_id, feedback);

create index if not exists idx_seller_feedbacks_seller
  on public.seller_feedbacks(seller_id, datetime desc)
  where seller_id is not null;

create table if not exists public.campaign_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.ad_accounts(id) on delete set null,
  entity_level text not null check (entity_level in ('campaign', 'adset', 'ad')),
  entity_id text not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  date date not null,
  spend numeric(12,2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  leads_meta integer not null default 0,
  conversations_started integer not null default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id, entity_level, entity_id, date)
);

create index if not exists idx_campaign_costs_user_date
  on public.campaign_costs(user_id, date desc);

create index if not exists idx_campaign_costs_campaign
  on public.campaign_costs(user_id, campaign_id, date desc);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.ad_accounts(id) on delete set null,
  period_start date not null,
  period_end date not null,
  json_data jsonb not null default '{}'::jsonb,
  jose_recommendations jsonb,
  status text not null default 'generated' check (status in ('generated', 'sent_to_jose', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  unique (report_id)
);

create index if not exists idx_reports_user_period
  on public.reports(user_id, period_end desc, period_start desc);

alter table public.lead_qualifications enable row level security;
alter table public.seller_feedbacks enable row level security;
alter table public.campaign_costs enable row level security;
alter table public.reports enable row level security;

drop policy if exists "Users manage own lead qualifications" on public.lead_qualifications;
create policy "Users manage own lead qualifications"
  on public.lead_qualifications for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users manage own seller feedbacks" on public.seller_feedbacks;
create policy "Users manage own seller feedbacks"
  on public.seller_feedbacks for all
  to authenticated
  using (
    user_id = auth.uid()
    or seller_id in (select id from public.ai_team_members where auth_user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    or seller_id in (select id from public.ai_team_members where auth_user_id = auth.uid())
  );

drop policy if exists "Users read own campaign costs" on public.campaign_costs;
create policy "Users read own campaign costs"
  on public.campaign_costs for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users read own reports" on public.reports;
create policy "Users read own reports"
  on public.reports for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Service role lead qualifications" on public.lead_qualifications;
create policy "Service role lead qualifications"
  on public.lead_qualifications for all to service_role using (true) with check (true);

drop policy if exists "Service role seller feedbacks" on public.seller_feedbacks;
create policy "Service role seller feedbacks"
  on public.seller_feedbacks for all to service_role using (true) with check (true);

drop policy if exists "Service role campaign costs" on public.campaign_costs;
create policy "Service role campaign costs"
  on public.campaign_costs for all to service_role using (true) with check (true);

drop policy if exists "Service role reports" on public.reports;
create policy "Service role reports"
  on public.reports for all to service_role using (true) with check (true);

create or replace function public.sync_lead_qualification_from_ai_crm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_classification text;
begin
  v_classification := case
    when new.status_crm = 'qualificado' then 'qualificado'
    when new.status_crm = 'pouco_qualificado' then 'pouco_qualificado'
    when new.status_crm = 'inativo' then 'inativo'
    else null
  end;

  if v_classification is null then
    return new;
  end if;

  insert into public.lead_qualifications (
    user_id,
    lead_id,
    ai_classification,
    ai_classification_datetime,
    campaign_id,
    adset_id,
    ad_id,
    source,
    updated_at
  )
  values (
    new.user_id,
    new.id,
    v_classification,
    now(),
    new.campaign_id,
    new.adset_id,
    new.ad_id,
    'pedro',
    now()
  )
  on conflict (lead_id) do update set
    ai_classification = excluded.ai_classification,
    ai_classification_datetime = excluded.ai_classification_datetime,
    campaign_id = excluded.campaign_id,
    adset_id = excluded.adset_id,
    ad_id = excluded.ad_id,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_lead_qualification_from_ai_crm on public.ai_crm_leads;
create trigger trg_sync_lead_qualification_from_ai_crm
  after insert or update of status_crm, campaign_id, adset_id, ad_id
  on public.ai_crm_leads
  for each row
  execute function public.sync_lead_qualification_from_ai_crm();

insert into public.lead_qualifications (
  user_id,
  lead_id,
  ai_classification,
  ai_classification_datetime,
  campaign_id,
  adset_id,
  ad_id,
  source
)
select
  l.user_id,
  l.id,
  l.status_crm,
  coalesce(l.created_at, now()),
  l.campaign_id,
  l.adset_id,
  l.ad_id,
  'pedro_backfill'
from public.ai_crm_leads l
where l.status_crm in ('qualificado', 'pouco_qualificado', 'inativo')
on conflict (lead_id) do update set
  ai_classification = excluded.ai_classification,
  ai_classification_datetime = excluded.ai_classification_datetime,
  campaign_id = excluded.campaign_id,
  adset_id = excluded.adset_id,
  ad_id = excluded.ad_id,
  updated_at = now();

create or replace function public.cron_meta_lead_quality_hourly()
returns void
language plpgsql
security definer
as $$
declare
  v_master uuid;
  v_service_key text;
  v_url text;
begin
  begin
    select decrypted_secret into v_service_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    v_service_key := null;
  end;

  begin
    select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'logosia_staging_meta_lead_quality_url' limit 1;
  exception when others then
    v_url := null;
  end;

  v_url := coalesce(v_url, 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/meta-lead-quality');

  if v_service_key is null or v_service_key = '' then
    raise notice 'cron_meta_lead_quality_hourly: service_role_key missing';
    return;
  end if;

  for v_master in
    select distinct user_id
    from public.ai_crm_leads
    where created_at > now() - interval '90 days'
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'action', 'sync_costs',
        'master_user_id', v_master,
        'date_preset', 'today'
      )
    );
  end loop;
end;
$$;

create or replace function public.cron_meta_lead_quality_daily_report()
returns void
language plpgsql
security definer
as $$
declare
  v_master uuid;
  v_service_key text;
  v_url text;
begin
  begin
    select decrypted_secret into v_service_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    v_service_key := null;
  end;

  begin
    select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'logosia_staging_meta_lead_quality_url' limit 1;
  exception when others then
    v_url := null;
  end;

  v_url := coalesce(v_url, 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/meta-lead-quality');

  if v_service_key is null or v_service_key = '' then
    raise notice 'cron_meta_lead_quality_daily_report: service_role_key missing';
    return;
  end if;

  for v_master in
    select distinct user_id
    from public.ai_crm_leads
    where created_at > now() - interval '90 days'
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'action', 'send_to_jose',
        'master_user_id', v_master,
        'date_preset', 'yesterday'
      )
    );
  end loop;
end;
$$;

do $$
begin
  perform cron.unschedule('meta-lead-quality-hourly');
exception when others then null;
end $$;

select cron.schedule(
  'meta-lead-quality-hourly',
  '17 * * * *',
  $$select public.cron_meta_lead_quality_hourly()$$
);

comment on table public.campaign_costs is
  'Daily Meta Marketing API insights by campaign/adset/ad. 07:00 BRT daily report uses these rows.';

comment on table public.reports is
  'Consolidated Meta Ads + Pedro + seller feedback reports sent to Jose.';
