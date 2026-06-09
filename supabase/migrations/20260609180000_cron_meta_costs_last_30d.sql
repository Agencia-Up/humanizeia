-- ============================================================================
-- Correção #1 — Custo por Lead por período (Painel ao Vivo)
-- ----------------------------------------------------------------------------
-- PROBLEMA: o cron horário cron_meta_lead_quality_hourly() sincronizava a verba
-- da Meta com date_preset='today', então a tabela campaign_costs só tinha o dia
-- atual. Resultado: períodos Ontem/7d/30d/Personalizado mostravam verba R$0 e
-- custo por lead zerado/errado no painel.
--
-- CORREÇÃO: trocar a janela para 'last_30d'. O sync já usa time_increment=1
-- (uma linha por dia), então passa a guardar 30 dias de histórico diário. O
-- upsert é idempotente (por user_id, entity_level, entity_id, date), então
-- re-sincronizar não duplica — só atualiza.
--
-- Após aplicar, rodar uma vez pra backfill imediato:
--   select public.cron_meta_lead_quality_hourly();
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_meta_lead_quality_hourly()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
        -- ANTES: 'today' (só o dia atual). AGORA: 30 dias de histórico diário.
        'date_preset', 'last_30d'
      )
    );
  end loop;
end;
$function$;
