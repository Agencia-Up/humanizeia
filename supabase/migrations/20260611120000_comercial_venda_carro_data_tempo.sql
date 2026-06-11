-- ============================================================================
-- Comercial: venda com carro + data preenchidos pelo vendedor (popup) e
-- métrica de TEMPO ATÉ A VENDA (data de entrada do lead -> data da venda).
-- ----------------------------------------------------------------------------
-- 1) Coluna lead_criado_em em comercial_vendas: guarda a data de chegada/criação
--    do lead NO MOMENTO da venda (denormalizado p/ a métrica não depender de
--    join cross-table e sobreviver se o lead for excluído depois).
-- 2) Política de UPDATE pro vendedor: o popup grava carro/data/valor na própria
--    venda (hoje o vendedor só tinha INSERT/SELECT).
-- 3) Gatilhos Pedro/Marcos passam a gravar lead_criado_em (e o Marcos passa a
--    aproveitar o vehicle_interest do lead como carro inicial).
-- Tudo aditivo + EXCEPTION WHEN OTHERS nos gatilhos = nunca quebra o CRM.
-- ============================================================================

-- 1) Coluna -----------------------------------------------------------------
ALTER TABLE public.comercial_vendas
  ADD COLUMN IF NOT EXISTS lead_criado_em date;

-- 2) Vendedor pode ATUALIZAR a própria venda (preencher carro/data/valor) -----
DO $$ BEGIN
  CREATE POLICY comercial_vendas_seller_update ON public.comercial_vendas
    FOR UPDATE
    USING (user_id = get_seller_master_user_id() AND (seller_id)::text = ANY (get_seller_member_ids_text()))
    WITH CHECK (user_id = get_seller_master_user_id() AND (seller_id)::text = ANY (get_seller_member_ids_text()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3a) Gatilho Pedro: grava lead_criado_em -----------------------------------
CREATE OR REPLACE FUNCTION public.comercial_sync_venda_pedro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SET LOCAL row_security = off;
  IF NEW.status_crm = 'fechado' AND COALESCE(OLD.status_crm,'') <> 'fechado'
     AND NEW.assigned_to_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM ai_team_members WHERE id = NEW.assigned_to_id) THEN
      INSERT INTO comercial_vendas (user_id, seller_id, data_venda, valor, origem, veiculo, origem_lead_tipo, origem_lead_id, lead_criado_em)
      VALUES (NEW.user_id, NEW.assigned_to_id, current_date, 0,
              map_origem_comercial(NEW.origem), NEW.vehicle_interest, 'pedro', NEW.id,
              COALESCE(NEW.arrived_at, NEW.created_at)::date)
      ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL DO NOTHING;
    END IF;
  ELSIF COALESCE(OLD.status_crm,'') = 'fechado' AND COALESCE(NEW.status_crm,'') <> 'fechado' THEN
    DELETE FROM comercial_vendas WHERE origem_lead_tipo = 'pedro' AND origem_lead_id = NEW.id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

-- 3b) Gatilho Marcos: grava lead_criado_em + veiculo do lead -----------------
CREATE OR REPLACE FUNCTION public.comercial_sync_venda_marcos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
        VALUES (NEW.user_id, v_seller, current_date, 0, map_origem_comercial(NEW.origem), NEW.vehicle_interest, 'marcos', NEW.id,
                COALESCE(NEW.arrived_at, NEW.created_at)::date)
        ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL DO NOTHING;
      END IF;
    ELSIF v_old_fech AND NOT v_new_fech THEN
      DELETE FROM comercial_vendas WHERE origem_lead_tipo = 'marcos' AND origem_lead_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;
