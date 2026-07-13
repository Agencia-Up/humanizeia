-- Check operacional do Feedback Diario.
--
-- Objetivo: provar que feedback_relatorio_diario_dados conta os leads reais
-- que chegaram no CRM, e nao apenas as conversas ja analisadas em
-- feedback_conversas.
--
-- Uso no SQL editor/psql antes de executar:
--   set app.feedback_check_tenant = '<uuid da conta master>';
--   set app.feedback_check_ref_date = '2026-07-12';
--   \i supabase/checks/feedback_relatorio_leads_reais.sql
--
-- Se a RPC divergir do CRM real, este check gera exception.

DO $$
DECLARE
  v_tenant uuid := NULLIF(current_setting('app.feedback_check_tenant', true), '')::uuid;
  v_ref date := COALESCE(
    NULLIF(current_setting('app.feedback_check_ref_date', true), '')::date,
    ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1)
  );
  v_payload jsonb;
  v_rpc_ontem int;
  v_rpc_funil int;
  v_real_ontem int;
  v_real_funil int;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Defina app.feedback_check_tenant antes de rodar este check';
  END IF;

  SELECT public.feedback_relatorio_diario_dados(v_tenant, 7, v_ref)
  INTO v_payload;

  v_rpc_ontem := COALESCE((v_payload->'ontem'->>'chegaram')::int, -1);
  v_rpc_funil := COALESCE((v_payload->'funil'->>'chegaram')::int, -1);

  WITH crm AS (
    SELECT
      COALESCE(l.arrived_at::timestamptz, l.created_at) AS chegada
    FROM public.ai_crm_leads l
    WHERE l.user_id = v_tenant

    UNION ALL

    SELECT
      COALESCE(m.arrived_at::timestamptz, m.created_at) AS chegada
    FROM public.crm_leads m
    WHERE m.user_id = v_tenant
  )
  SELECT
    count(*) FILTER (WHERE (chegada AT TIME ZONE 'America/Sao_Paulo')::date = v_ref),
    count(*) FILTER (
      WHERE (chegada AT TIME ZONE 'America/Sao_Paulo')::date > v_ref - 7
        AND (chegada AT TIME ZONE 'America/Sao_Paulo')::date <= v_ref
    )
  INTO v_real_ontem, v_real_funil
  FROM crm;

  IF v_rpc_ontem <> v_real_ontem THEN
    RAISE EXCEPTION
      'Feedback diario inconsistente em ontem.chegaram: rpc=%, crm_real=%, tenant=%, ref=%',
      v_rpc_ontem, v_real_ontem, v_tenant, v_ref;
  END IF;

  IF v_rpc_funil <> v_real_funil THEN
    RAISE EXCEPTION
      'Feedback diario inconsistente em funil.chegaram: rpc=%, crm_real=%, tenant=%, ref=%',
      v_rpc_funil, v_real_funil, v_tenant, v_ref;
  END IF;

  RAISE NOTICE
    'OK feedback_relatorio_leads_reais tenant=% ref=% ontem=% funil_7d=% payload=%',
    v_tenant, v_ref, v_real_ontem, v_real_funil, v_payload;
END $$;
