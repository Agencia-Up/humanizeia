-- ============================================================================
-- Comercial: corrige vendas do PEDRO que não chegaram em comercial_vendas
-- (Painel ao Vivo só mostrava Marcos).
-- ----------------------------------------------------------------------------
-- Causa: o gatilho trg_comercial_venda_pedro só disparava em
--   AFTER UPDATE OF status_crm — então NÃO criava a venda quando:
--     • o vendedor era atribuído DEPOIS do lead já estar 'fechado'; ou
--     • o lead virou 'fechado' ANTES do gatilho existir (10/jun); ou
--     • o lead foi criado já 'fechado' (INSERT, que o gatilho não cobria).
--
-- Correção em 2 partes:
--   1) BACKFILL: cria retroativamente a venda de todo lead do Pedro que está
--      'fechado' com vendedor válido e ainda não tem venda. Idempotente
--      (índice único uq_comercial_vendas_lead + NOT EXISTS).
--   2) BLINDAGEM: gatilho passa a cobrir INSERT e mudança de vendedor num lead
--      já fechado, além da transição de status. ON CONFLICT DO NOTHING garante
--      no máx. 1 venda por lead. EXCEPTION WHEN OTHERS mantido (nunca quebra o
--      arrastar-soltar do CRM).
-- ============================================================================

-- 1) BACKFILL --------------------------------------------------------------
INSERT INTO public.comercial_vendas
  (user_id, seller_id, data_venda, valor, origem, veiculo, origem_lead_tipo, origem_lead_id, lead_criado_em)
SELECT
  l.user_id,
  l.assigned_to_id,
  current_date,   -- ai_crm_leads não guarda data de fechamento; usa hoje (igual o gatilho)
  0,
  public.map_origem_comercial(l.origem),
  l.vehicle_interest,
  'pedro',
  l.id,
  COALESCE(l.arrived_at, l.created_at)::date
FROM public.ai_crm_leads l
WHERE l.status_crm = 'fechado'
  AND l.assigned_to_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.ai_team_members m WHERE m.id = l.assigned_to_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.comercial_vendas v
    WHERE v.origem_lead_tipo = 'pedro' AND v.origem_lead_id = l.id
  )
ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL DO NOTHING;

-- 2) BLINDAGEM do gatilho do Pedro -----------------------------------------
CREATE OR REPLACE FUNCTION public.comercial_sync_venda_pedro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SET LOCAL row_security = off;

  -- Lead fechado + vendedor válido => garante a venda (idempotente).
  IF NEW.status_crm = 'fechado' AND NEW.assigned_to_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM ai_team_members WHERE id = NEW.assigned_to_id) THEN
    -- só age quando algo relevante mudou: virou fechado, (re)atribuiu vendedor,
    -- ou é um INSERT já fechado.
    IF TG_OP = 'INSERT'
       OR COALESCE(OLD.status_crm,'') <> 'fechado'
       OR OLD.assigned_to_id IS DISTINCT FROM NEW.assigned_to_id THEN
      INSERT INTO comercial_vendas (user_id, seller_id, data_venda, valor, origem, veiculo, origem_lead_tipo, origem_lead_id, lead_criado_em)
      VALUES (NEW.user_id, NEW.assigned_to_id, current_date, 0,
              map_origem_comercial(NEW.origem), NEW.vehicle_interest, 'pedro', NEW.id,
              COALESCE(NEW.arrived_at, NEW.created_at)::date)
      ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL DO NOTHING;
    END IF;

  -- Lead SAIU de fechado => remove a venda derivada (reabrir = não-venda).
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.status_crm,'') = 'fechado'
        AND COALESCE(NEW.status_crm,'') <> 'fechado' THEN
    DELETE FROM comercial_vendas WHERE origem_lead_tipo = 'pedro' AND origem_lead_id = NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;   -- jamais quebra o update do CRM
END $$;

-- gatilho agora cobre INSERT + mudança de status_crm OU de assigned_to_id
DROP TRIGGER IF EXISTS trg_comercial_venda_pedro ON public.ai_crm_leads;
CREATE TRIGGER trg_comercial_venda_pedro
  AFTER INSERT OR UPDATE OF status_crm, assigned_to_id ON public.ai_crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.comercial_sync_venda_pedro();
