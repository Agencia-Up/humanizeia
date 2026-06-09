-- Fila + gatilho da Conversions API for Business Messaging (CTWA) — ADITIVO.
-- Nao toca codigo do Pedro: reage a escrita do lead via TRIGGER no banco
-- (mesmo padrao seguro ja usado no projeto pra cobranca por conversa).

-- 1) Lar por-tenant do WhatsApp Business Account ID (WABA). Vai em user_data da CAPI.
alter table public.meta_pixels
  add column if not exists waba_id text;
comment on column public.meta_pixels.waba_id is
  'WhatsApp Business Account ID (waba) usado em user_data.whatsapp_business_account_id na CAPI for Business Messaging.';

-- 2) Fila de eventos CTWA (isolada da fila CAPI antiga pra nao mudar nada existente).
create table if not exists public.wa_ctwa_capi_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  lead_id       uuid references public.ai_crm_leads(id) on delete cascade,
  ctwa_clid     text not null,
  remote_jid    text,
  event_name    text not null,                 -- 'Lead' | 'CompleteRegistration' | 'Purchase'
  status        text not null default 'pending', -- pending | sent | failed | skipped
  attempts      integer not null default 0,
  response_code integer,
  response_body text,
  error_message text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

-- Idempotencia: no maximo 1 evento por (lead, tipo de evento).
create unique index if not exists uq_wa_ctwa_capi_lead_event
  on public.wa_ctwa_capi_events(lead_id, event_name)
  where lead_id is not null;

create index if not exists idx_wa_ctwa_capi_pending
  on public.wa_ctwa_capi_events(status, created_at)
  where status = 'pending';

alter table public.wa_ctwa_capi_events enable row level security;
do $$ begin
  create policy "master_view_own_ctwa_capi" on public.wa_ctwa_capi_events
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- 3) Gatilho: enfileira eventos quando o lead ganha ctwa_clid ou vira qualificado.
create or replace function public.enqueue_ctwa_capi_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.ctwa_clid is null or NEW.ctwa_clid = '' then
    return NEW;
  end if;

  -- BLINDAGEM: enfileirar NUNCA pode derrubar a escrita do lead (atendimento
  -- do Pedro intocado). Qualquer erro aqui e engolido.
  begin
    -- Lead: assim que o ctwa_clid passa a existir no lead.
    if (TG_OP = 'INSERT') or (OLD.ctwa_clid is distinct from NEW.ctwa_clid) then
      insert into public.wa_ctwa_capi_events (user_id, lead_id, ctwa_clid, remote_jid, event_name)
      values (NEW.user_id, NEW.id, NEW.ctwa_clid, NEW.remote_jid, 'Lead')
      on conflict (lead_id, event_name) where lead_id is not null do nothing;
    end if;

    -- Qualificado: quando status_crm vira 'qualificado'.
    if NEW.status_crm = 'qualificado'
       and ((TG_OP = 'INSERT') or (OLD.status_crm is distinct from NEW.status_crm)) then
      insert into public.wa_ctwa_capi_events (user_id, lead_id, ctwa_clid, remote_jid, event_name)
      values (NEW.user_id, NEW.id, NEW.ctwa_clid, NEW.remote_jid, 'CompleteRegistration')
      on conflict (lead_id, event_name) where lead_id is not null do nothing;
    end if;
  exception when others then
    null; -- engole qualquer erro de enfileiramento
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_enqueue_ctwa_capi on public.ai_crm_leads;
create trigger trg_enqueue_ctwa_capi
  after insert or update of ctwa_clid, status_crm on public.ai_crm_leads
  for each row
  execute function public.enqueue_ctwa_capi_event();

-- 4) Cron que drena a fila a cada 5 min chamando a edge function (so se houver pendentes).
create or replace function public.cron_wa_ctwa_capi_drain()
returns void
language plpgsql
security definer
as $$
declare
  v_service_key text;
  v_url text;
begin
  begin
    select decrypted_secret into v_service_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    v_service_key := null;
  end;

  v_url := 'https://ezoltigtqgbmftmiwjxh.supabase.co/functions/v1/wa-capi-ctwa-send';

  if v_service_key is null or v_service_key = '' then
    raise notice 'cron_wa_ctwa_capi_drain: service_role_key missing';
    return;
  end if;

  if not exists (select 1 from public.wa_ctwa_capi_events where status = 'pending') then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object('action', 'drain')
  );
end;
$$;

do $$
begin
  perform cron.unschedule('wa-ctwa-capi-drain');
exception when others then null;
end $$;

select cron.schedule(
  'wa-ctwa-capi-drain',
  '*/5 * * * *',
  $$select public.cron_wa_ctwa_capi_drain()$$
);
