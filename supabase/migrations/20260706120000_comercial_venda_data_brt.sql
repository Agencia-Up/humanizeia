-- ============================================================================
-- Fix de fuso: data_venda do gatilho automático em BRT (não UTC)
-- ----------------------------------------------------------------------------
-- Bug: comercial_sync_venda_marcos/pedro gravavam data_venda = current_date. O
-- Postgres roda em UTC, então venda fechada entre 21h–24h (BRT) caía no DIA
-- SEGUINTE no Painel Geral. Troca current_date -> (now() AT TIME ZONE
-- 'America/Sao_Paulo')::date e o lead_criado_em idem. Só corrige o gatilho
-- (dados novos); histórico fica pra revisão à parte. CREATE OR REPLACE, seguro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.comercial_sync_venda_marcos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new text; v_old text; v_seller uuid;
  v_new_fech boolean; v_old_fech boolean;
BEGIN
  SET LOCAL row_security = off;
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT lower(name) INTO v_new FROM crm_pipeline_stages WHERE id = NEW.stage_id;
    SELECT lower(name) INTO v_old FROM crm_pipeline_stages WHERE id = OLD.stage_id;
    v_new_fech := (v_new = 'fechado' OR v_new LIKE 'venda conclu%');
    v_old_fech := (COALESCE(v_old,'') = 'fechado' OR COALESCE(v_old,'') LIKE 'venda conclu%');

    IF v_new_fech AND NOT v_old_fech
       AND NEW.assigned_to IS NOT NULL AND NEW.assigned_to ~ '^[0-9a-fA-F-]{36}$' THEN
      v_seller := NEW.assigned_to::uuid;
      IF EXISTS (SELECT 1 FROM ai_team_members WHERE id = v_seller) THEN
        INSERT INTO comercial_vendas (user_id, seller_id, data_venda, valor, origem, veiculo, origem_lead_tipo, origem_lead_id, lead_criado_em)
        VALUES (NEW.user_id, v_seller, (now() AT TIME ZONE 'America/Sao_Paulo')::date, 0, map_origem_comercial(NEW.origem), NEW.vehicle_interest, 'marcos', NEW.id,
                (COALESCE(NEW.arrived_at, NEW.created_at) AT TIME ZONE 'America/Sao_Paulo')::date)
        ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL DO NOTHING;
      END IF;
    ELSIF v_old_fech AND NOT v_new_fech THEN
      DELETE FROM comercial_vendas WHERE origem_lead_tipo = 'marcos' AND origem_lead_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.comercial_sync_venda_pedro()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  SET LOCAL row_security = off;
  IF NEW.status_crm = 'fechado' AND NEW.assigned_to_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM ai_team_members WHERE id = NEW.assigned_to_id) THEN
    IF TG_OP = 'INSERT'
       OR COALESCE(OLD.status_crm,'') <> 'fechado'
       OR OLD.assigned_to_id IS DISTINCT FROM NEW.assigned_to_id THEN
      INSERT INTO comercial_vendas (user_id, seller_id, data_venda, valor, origem, veiculo, origem_lead_tipo, origem_lead_id, lead_criado_em)
      VALUES (NEW.user_id, NEW.assigned_to_id, (now() AT TIME ZONE 'America/Sao_Paulo')::date, 0,
              map_origem_comercial(NEW.origem), NEW.vehicle_interest, 'pedro', NEW.id,
              (COALESCE(NEW.arrived_at, NEW.created_at) AT TIME ZONE 'America/Sao_Paulo')::date)
      ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL DO NOTHING;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.status_crm,'') = 'fechado'
        AND COALESCE(NEW.status_crm,'') <> 'fechado' THEN
    DELETE FROM comercial_vendas WHERE origem_lead_tipo = 'pedro' AND origem_lead_id = NEW.id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $function$;
