-- ============================================================================
-- CAPI · Match quality — enriquecer os eventos pra Meta CASAR e OTIMIZAR melhor
-- Os leads têm telefone (100%) e nome (100%) mas não têm clique de anúncio
-- (ad_id/fbclid vazios). Pra a Meta "enxergar" e otimizar por qualidade, mandamos
-- o MÁXIMO de identificadores que temos: ph + fn + ln + external_id (+ fbc quando
-- houver). O carteiro (wa-capi-process-queue) hasheia fn/ln/em (não só ph).
-- Também injeta event_id (dedup). Vale p/ o cron de qualidade E o de vendas.
-- ============================================================================

-- ── Qualidade de lead ───────────────────────────────────────────────────────
create or replace function public.cron_capi_report_lead_quality_runner()
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v record; v_pixel uuid; v_phone text; v_fbclid text; v_event text;
  v_nome text; v_fn text; v_ln text;
  v_userdata jsonb; v_customdata jsonb;
begin
  for v in
    select l.id, l.user_id, l.remote_jid, l.ad_name, l.qualidade_lead, l.vehicle_interest, l.lead_name, l.created_at
    from public.ai_crm_leads l
    where l.qualidade_lead in ('bom','medio','ruim')
      and (l.capi_quality_reported is null or l.capi_quality_reported is distinct from l.qualidade_lead)
      and l.created_at >= now() - interval '7 days'
      and exists (select 1 from public.meta_pixels p where p.user_id = l.user_id and p.is_active = true)
    limit 500
  loop
    begin
      select id into v_pixel from public.meta_pixels where user_id = v.user_id and is_active = true order by created_at limit 1;
      if v_pixel is null then continue; end if;

      v_phone := nullif(regexp_replace(split_part(coalesce(v.remote_jid,''),'@',1),'\D','','g'),'');

      v_fbclid := null;
      if v_phone is not null then
        select fbclid into v_fbclid from public.wa_contacts
          where user_id = v.user_id and regexp_replace(coalesce(phone,''),'\D','','g') = v_phone and fbclid is not null limit 1;
      end if;

      -- nome -> fn/ln (ignora nomes genéricos)
      v_nome := regexp_replace(coalesce(v.lead_name,''), '\s+', ' ', 'g');
      if v_nome ~* '^\(?sem' or lower(trim(v_nome)) in ('lead','','cliente') then v_nome := ''; end if;
      v_fn := nullif(split_part(trim(v_nome),' ',1),'');
      v_ln := nullif(trim(substring(trim(v_nome) from position(' ' in trim(v_nome)))),'');

      v_event := case v.qualidade_lead when 'bom' then 'LeadQualificado' when 'medio' then 'LeadPoucoQualificado' else 'LeadRuim' end;

      v_userdata := '{}'::jsonb;
      if v_phone is not null then v_userdata := jsonb_set(v_userdata, '{ph}', to_jsonb(array[v_phone])); end if;
      if v_fn is not null then v_userdata := v_userdata || jsonb_build_object('fn', to_jsonb(array[v_fn])); end if;
      if v_ln is not null then v_userdata := v_userdata || jsonb_build_object('ln', to_jsonb(array[v_ln])); end if;
      v_userdata := v_userdata || jsonb_build_object('external_id', to_jsonb(array[v.id::text]));
      if v_fbclid is not null then
        v_userdata := v_userdata || jsonb_build_object('fbc', 'fb.1.' || (extract(epoch from now())*1000)::bigint || '.' || v_fbclid);
      end if;

      v_customdata := jsonb_build_object('lead_quality', v.qualidade_lead);
      if v.vehicle_interest is not null then v_customdata := v_customdata || jsonb_build_object('content_name', v.vehicle_interest); end if;
      if coalesce(v.ad_name,'') <> '' then v_customdata := v_customdata || jsonb_build_object('content_category', v.ad_name); end if;

      if v_phone is not null then
        insert into public.meta_capi_events (user_id, pixel_id, event_name, event_time, action_source, user_data, custom_data, status, event_id)
        values (v.user_id, v_pixel, v_event, coalesce(v.created_at, now()), 'system_generated', v_userdata, v_customdata, 'pending',
                md5(v.id::text || ':' || v_event));
      end if;

      update public.ai_crm_leads set capi_quality_reported = v.qualidade_lead where id = v.id;
    exception when others then
      update public.ai_crm_leads set capi_quality_reported = v.qualidade_lead where id = v.id;
    end;
  end loop;
end;
$fn$;

-- ── Vendas (Purchase) — mesmo enriquecimento ────────────────────────────────
create or replace function public.cron_capi_report_sales_runner()
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v record; v_pixel uuid; v_phone text; v_ad_id text; v_fbclid text;
  v_lead_name text; v_nome text; v_fn text; v_ln text;
  v_userdata jsonb; v_customdata jsonb;
begin
  for v in
    select cv.* from public.comercial_vendas cv
    where cv.capi_reported_at is null
      and cv.created_at >= now() - interval '7 days'
      and exists (select 1 from public.meta_pixels p where p.user_id = cv.user_id and p.is_active = true)
    limit 200
  loop
    begin
      select id into v_pixel from public.meta_pixels where user_id = v.user_id and is_active = true order by created_at limit 1;
      if v_pixel is null then continue; end if;

      v_phone := null; v_ad_id := null; v_lead_name := null;
      if v.origem_lead_id is not null then
        select regexp_replace(split_part(l.remote_jid,'@',1),'\D','','g'), l.ad_id, l.lead_name
          into v_phone, v_ad_id, v_lead_name from public.ai_crm_leads l where l.id = v.origem_lead_id;
        if v_phone is null then
          select regexp_replace(coalesce(l.phone,''),'\D','','g'), l.name
            into v_phone, v_lead_name from public.crm_leads l where l.id = v.origem_lead_id;
        end if;
      end if;
      v_phone := nullif(v_phone,'');

      v_fbclid := null;
      if v_phone is not null then
        select fbclid into v_fbclid from public.wa_contacts
          where user_id = v.user_id and regexp_replace(coalesce(phone,''),'\D','','g') = v_phone and fbclid is not null limit 1;
      end if;

      v_nome := regexp_replace(coalesce(v_lead_name,''), '\s+', ' ', 'g');
      if v_nome ~* '^\(?sem' or lower(trim(v_nome)) in ('lead','','cliente') then v_nome := ''; end if;
      v_fn := nullif(split_part(trim(v_nome),' ',1),'');
      v_ln := nullif(trim(substring(trim(v_nome) from position(' ' in trim(v_nome)))),'');

      v_userdata := '{}'::jsonb;
      if v_phone is not null then v_userdata := jsonb_set(v_userdata, '{ph}', to_jsonb(array[v_phone])); end if;
      if v_fn is not null then v_userdata := v_userdata || jsonb_build_object('fn', to_jsonb(array[v_fn])); end if;
      if v_ln is not null then v_userdata := v_userdata || jsonb_build_object('ln', to_jsonb(array[v_ln])); end if;
      if v.origem_lead_id is not null then v_userdata := v_userdata || jsonb_build_object('external_id', to_jsonb(array[v.origem_lead_id::text])); end if;
      if v_fbclid is not null then
        v_userdata := v_userdata || jsonb_build_object('fbc', 'fb.1.' || (extract(epoch from now())*1000)::bigint || '.' || v_fbclid);
      end if;

      v_customdata := jsonb_build_object('currency','BRL','value', coalesce(v.valor,0));
      if v_ad_id is not null and v_ad_id not in ('','0') then v_customdata := v_customdata || jsonb_build_object('ad_id', v_ad_id); end if;
      if v.veiculo is not null then v_customdata := v_customdata || jsonb_build_object('content_name', v.veiculo); end if;

      if v_phone is not null then
        insert into public.meta_capi_events (user_id, pixel_id, event_name, event_time, action_source, user_data, custom_data, status, event_id)
        values (v.user_id, v_pixel, 'Purchase', coalesce(v.created_at, now()), 'system_generated', v_userdata, v_customdata, 'pending',
                md5(v.id::text || ':Purchase'));
      end if;

      update public.comercial_vendas set capi_reported_at = now() where id = v.id;
    exception when others then
      update public.comercial_vendas set capi_reported_at = now() where id = v.id;
    end;
  end loop;
end;
$fn$;

-- Re-disparar a qualidade dos leads recentes com o match enriquecido (event_id
-- dedup evita duplicar daqui pra frente). Só leads com pixel ativo, últimos 7d.
update public.ai_crm_leads l set capi_quality_reported = null
where l.qualidade_lead in ('bom','medio','ruim')
  and l.created_at >= now() - interval '7 days'
  and exists (select 1 from public.meta_pixels p where p.user_id = l.user_id and p.is_active = true);
