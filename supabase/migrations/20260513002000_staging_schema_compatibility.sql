-- Keep staging bootstrap compatible with the current production data shape.
alter table public.wa_contact_lists
  add column if not exists auto_sync_pedro_leads boolean default false;

alter table public.ai_team_members
  add column if not exists email text,
  add column if not exists visible_features jsonb default '[]'::jsonb;

alter table public.ai_crm_leads
  add column if not exists followup_5min_sent boolean default false,
  add column if not exists last_agent_reply_at timestamptz,
  add column if not exists last_user_reply_at timestamptz;

alter table public.ai_lead_transfers
  add column if not exists confirmation_timeout_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists from_member_id uuid,
  add column if not exists is_confirmed boolean default false,
  add column if not exists transfer_status text;

alter table public.ai_lead_transfers
  alter column lead_id drop not null,
  alter column from_agent_id drop not null;

alter table public.apollo_cron_config
  add column if not exists account_id text,
  add column if not exists active_segment_slug text,
  add column if not exists send_whatsapp_always boolean default false;

alter table public.jose_segment_profiles
  add column if not exists kpi_labels jsonb default '{}'::jsonb;

alter table public.crm_pipeline_stages
  drop constraint if exists crm_pipeline_stages_user_id_name_key;
