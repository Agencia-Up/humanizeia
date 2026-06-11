-- ============================================================================
-- Comercial: lead movido para "Fechado" no CRM => +1 venda do vendedor.
-- ----------------------------------------------------------------------------
-- Quando um lead entra na etapa "Fechado":
--   • Pedro  (ai_crm_leads.status_crm = 'fechado')
--   • Marcos (crm_leads -> etapa cujo nome é 'Fechado')
-- cria UMA venda em comercial_vendas, atribuída ao vendedor do lead
-- (assigned_to_id / assigned_to), valor 0 (conta na QUANTIDADE e na % meta;
-- faturamento/ticket continuam vindo dos lançamentos manuais com valor).
-- Se o lead SAI de "Fechado", a venda derivada é removida (reabrir = não-venda).
-- Dedup: 1 venda por lead (origem_lead_tipo, origem_lead_id).
--
-- SEGURANÇA: gatilhos AFTER UPDATE (não tocam o INSERT) + EXCEPTION WHEN OTHERS
-- que sempre retorna NEW — ou seja, NUNCA quebram o arrastar-soltar do CRM.
-- ============================================================================

-- 1) Vínculo com o lead de origem (pra dedup + reverter) ----------------------
ALTER TABLE public.comercial_vendas
  ADD COLUMN IF NOT EXISTS origem_lead_tipo text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS origem_lead_id   uuid;

DO $$ BEGIN
  ALTER TABLE public.comercial_vendas
    ADD CONSTRAINT comercial_vendas_origem_lead_tipo_ck
    CHECK (origem_lead_tipo IN ('pedro','marcos','manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_comercial_vendas_lead
  ON public.comercial_vendas(origem_lead_tipo, origem_lead_id)
  WHERE origem_lead_id IS NOT NULL;

-- 2) Mapa origem do CRM -> origem comercial (4 valores) -----------------------
CREATE OR REPLACE FUNCTION public.map_origem_comercial(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IN ('trafico_pago','trafego')        THEN 'trafego'
    WHEN p IN ('marketplace','portais','portal') THEN 'portais'
    WHEN p = 'porta'                             THEN 'porta'
    ELSE 'particular'
  END;
$$;

-- 3) Pedro: status_crm = 'fechado' -------------------------------------------
CREATE OR REPLACE FUNCTION public.comercial_sync_venda_pedro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SET LOCAL row_security = off;
  IF NEW.status_crm = 'fechado' AND COALESCE(OLD.status_crm,'') <> 'fechado'
     AND NEW.assigned_to_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM ai_team_members WHERE id = NEW.assigned_to_id) THEN
      INSERT INTO comercial_vendas (user_id, seller_id, data_venda, valor, origem, veiculo, origem_lead_tipo, origem_lead_id)
      VALUES (NEW.user_id, NEW.assigned_to_id, current_date, 0,
              map_origem_comercial(NEW.origem), NEW.vehicle_interest, 'pedro', NEW.id)
      ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL DO NOTHING;
    END IF;
  ELSIF COALESCE(OLD.status_crm,'') = 'fechado' AND COALESCE(NEW.status_crm,'') <> 'fechado' THEN
    DELETE FROM comercial_vendas WHERE origem_lead_tipo = 'pedro' AND origem_lead_id = NEW.id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;   -- jamais quebra o update do CRM
END $$;

DROP TRIGGER IF EXISTS trg_comercial_venda_pedro ON public.ai_crm_leads;
CREATE TRIGGER trg_comercial_venda_pedro
  AFTER UPDATE OF status_crm ON public.ai_crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.comercial_sync_venda_pedro();

-- 4) Marcos: etapa de nome 'Fechado' -----------------------------------------
CREATE OR REPLACE FUNCTION public.comercial_sync_venda_marcos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new text; v_old text; v_seller uuid;
BEGIN
  SET LOCAL row_security = off;
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT lower(name) INTO v_new FROM crm_pipeline_stages WHERE id = NEW.stage_id;
    SELECT lower(name) INTO v_old FROM crm_pipeline_stages WHERE id = OLD.stage_id;
    IF v_new = 'fechado' AND COALESCE(v_old,'') <> 'fechado'
       AND NEW.assigned_to IS NOT NULL AND NEW.assigned_to ~ '^[0-9a-fA-F-]{36}$' THEN
      v_seller := NEW.assigned_to::uuid;
      IF EXISTS (SELECT 1 FROM ai_team_members WHERE id = v_seller) THEN
        INSERT INTO comercial_vendas (user_id, seller_id, data_venda, valor, origem, veiculo, origem_lead_tipo, origem_lead_id)
        VALUES (NEW.user_id, v_seller, current_date, 0, map_origem_comercial(NEW.origem), NULL, 'marcos', NEW.id)
        ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL DO NOTHING;
      END IF;
    ELSIF COALESCE(v_old,'') = 'fechado' AND COALESCE(v_new,'') <> 'fechado' THEN
      DELETE FROM comercial_vendas WHERE origem_lead_tipo = 'marcos' AND origem_lead_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_comercial_venda_marcos ON public.crm_leads;
CREATE TRIGGER trg_comercial_venda_marcos
  AFTER UPDATE OF stage_id ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.comercial_sync_venda_marcos();
