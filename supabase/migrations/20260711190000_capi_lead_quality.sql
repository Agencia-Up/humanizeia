-- ============================================================================
-- CAPI · Qualidade de lead de volta pro Meta (loop CRM -> Facebook)
-- Quando a IA qualifica o lead (ai_crm_leads.qualidade_lead: bom/medio/ruim, a
-- régua = visita/entrada/financiamento=bom; sondando=medio; clique acidental/
-- off-topic/ignora=ruim), enfileira um EVENTO CUSTOM pra Meta com o telefone +
-- ad_id + fbc de origem, pra Meta aprender QUAL anúncio traz lead bom vs ruim:
--   bom   -> LeadQualificado
--   medio -> LeadPoucoQualificado
--   ruim  -> LeadRuim
-- REUSA a fila existente (meta_capi_events status=pending -> wa-capi-process-queue
-- hasheia o ph e envia pro Graph). Idempotente: reporta cada qualidade 1x; se a
-- qualidade MUDAR, reporta de novo. Espelha cron_capi_report_sales_runner.
-- ============================================================================

-- Idempotência: guarda a última qualidade já reportada à CAPI.
alter table public.ai_crm_leads
  add column if not exists capi_quality_reported text;

create or replace function public.cron_capi_report_lead_quality_runner()
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v record; v_pixel uuid; v_phone text; v_fbclid text; v_event text;
  v_userdata jsonb; v_customdata jsonb;
begin
  for v in
    select l.id, l.user_id, l.remote_jid, l.ad_id, l.qualidade_lead, l.vehicle_interest, l.created_at
    from public.ai_crm_leads l
    where l.qualidade_lead in ('bom','medio','ruim')
      and (l.capi_quality_reported is null or l.capi_quality_reported is distinct from l.qualidade_lead)
      and l.created_at >= now() - interval '7 days'   -- Meta rejeita evento com +7 dias
      and exists (select 1 from public.meta_pixels p where p.user_id = l.user_id and p.is_active = true)
    limit 500
  loop
    begin
      select id into v_pixel from public.meta_pixels where user_id = v.user_id and is_active = true order by created_at limit 1;
      if v_pixel is null then continue; end if;

      -- telefone do lead (Pedro = ai_crm_leads.remote_jid)
      v_phone := nullif(regexp_replace(split_part(coalesce(v.remote_jid,''),'@',1),'\D','','g'),'');

      -- fbclid pelo telefone -> fbc no formato da Meta (fecha a atribuição ao clique)
      v_fbclid := null;
      if v_phone is not null then
        select fbclid into v_fbclid from public.wa_contacts
          where user_id = v.user_id and regexp_replace(coalesce(phone,''),'\D','','g') = v_phone and fbclid is not null
          limit 1;
      end if;

      v_event := case v.qualidade_lead
        when 'bom'   then 'LeadQualificado'
        when 'medio' then 'LeadPoucoQualificado'
        else              'LeadRuim'
      end;

      v_userdata := '{}'::jsonb;
      if v_phone is not null then v_userdata := jsonb_set(v_userdata, '{ph}', to_jsonb(array[v_phone])); end if;
      if v_fbclid is not null then
        v_userdata := v_userdata || jsonb_build_object('fbc', 'fb.1.' || (extract(epoch from now())*1000)::bigint || '.' || v_fbclid);
      end if;

      v_customdata := jsonb_build_object('lead_quality', v.qualidade_lead);
      if v.ad_id is not null and v.ad_id not in ('','0') then v_customdata := v_customdata || jsonb_build_object('ad_id', v.ad_id); end if;
      if v.vehicle_interest is not null then v_customdata := v_customdata || jsonb_build_object('content_name', v.vehicle_interest); end if;

      -- só enfileira com matching mínimo (telefone); senão a Meta rejeita ("sem info do cliente")
      if v_phone is not null then
        insert into public.meta_capi_events (user_id, pixel_id, event_name, event_time, action_source, user_data, custom_data, status)
        values (v.user_id, v_pixel, v_event, coalesce(v.created_at, now()), 'system_generated', v_userdata, v_customdata, 'pending');
      end if;

      update public.ai_crm_leads set capi_quality_reported = v.qualidade_lead where id = v.id;
    exception when others then
      update public.ai_crm_leads set capi_quality_reported = v.qualidade_lead where id = v.id; -- nunca trava o lote
    end;
  end loop;
end;
$fn$;

comment on function public.cron_capi_report_lead_quality_runner() is
  'Enfileira evento CAPI de qualidade de lead (LeadQualificado/LeadPoucoQualificado/LeadRuim) por ai_crm_leads.qualidade_lead, casando por telefone+ad_id+fbc. Idempotente por capi_quality_reported.';

-- Cron a cada 10 min (a fila de 5 min entrega). Guarda contra re-agendar.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'capi-report-lead-quality-10min') then
    perform cron.unschedule('capi-report-lead-quality-10min');
  end if;
  perform cron.schedule('capi-report-lead-quality-10min', '3,13,23,33,43,53 * * * *', 'select public.cron_capi_report_lead_quality_runner();');
end $$;

-- Self-check
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='ai_crm_leads' and column_name='capi_quality_reported') then
    raise exception 'CAPI lead-quality: coluna capi_quality_reported ausente';
  end if;
  if not exists (select 1 from cron.job where jobname='capi-report-lead-quality-10min') then
    raise exception 'CAPI lead-quality: cron nao agendado';
  end if;
end $$;
