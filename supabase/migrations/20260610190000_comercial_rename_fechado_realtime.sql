-- ============================================================================
-- Comercial: "Fechado" -> "Venda concluída" (Marcos) + realtime das vendas
-- ----------------------------------------------------------------------------
-- 1) Renomeia a etapa "Fechado" do CRM do Marcos para "Venda concluída"
--    (afeta TODOS os clientes que têm essa etapa). No Pedro o valor do status
--    continua 'fechado' (só o rótulo muda no front).
-- 2) Atualiza o gatilho do Marcos pra reconhecer a etapa pelo novo nome
--    ('venda conclu...') OU pelo antigo ('fechado') — assim nada quebra.
-- 3) Liga REALTIME nas tabelas comerciais (pra o painel/comercial atualizarem
--    na hora quando uma venda é criada por um fechamento).
-- ============================================================================

-- 1) Rename da etapa --------------------------------------------------------
-- Monta o 'i' acentuado via chr(237) (U+00ED) -> 100% ASCII no texto SQL.
-- Motivo: aplicada via API com pipe de texto que pode reinterpretar UTF-8 como
-- cp1252 no Windows, o caractere acentuado cru viraria mojibake. chr() evita isso
-- (o Postgres monta o byte UTF-8 correto 0xC3 0xAD server-side).
-- O WHERE tambem pega linhas ja renomeadas (self-healing/idempotente).
UPDATE public.crm_pipeline_stages
   SET name = 'Venda conclu' || chr(237) || 'da'
 WHERE lower(name) = 'fechado' OR lower(name) LIKE 'venda conclu%';

-- 2) Gatilho Marcos: reconhece 'fechado' OU 'venda conclu...' -----------------
CREATE OR REPLACE FUNCTION public.comercial_sync_venda_marcos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new text; v_old text; v_seller uuid;
  v_new_fech boolean; v_old_fech boolean;
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT lower(name) INTO v_new FROM crm_pipeline_stages WHERE id = NEW.stage_id;
    SELECT lower(name) INTO v_old FROM crm_pipeline_stages WHERE id = OLD.stage_id;
    v_new_fech := (v_new = 'fechado' OR v_new LIKE 'venda conclu%');
    v_old_fech := (COALESCE(v_old,'') = 'fechado' OR COALESCE(v_old,'') LIKE 'venda conclu%');

    IF v_new_fech AND NOT v_old_fech
       AND NEW.assigned_to IS NOT NULL AND NEW.assigned_to ~ '^[0-9a-fA-F-]{36}$' THEN
      v_seller := NEW.assigned_to::uuid;
      IF EXISTS (SELECT 1 FROM ai_team_members WHERE id = v_seller) THEN
        INSERT INTO comercial_vendas (user_id, seller_id, data_venda, valor, origem, veiculo, origem_lead_tipo, origem_lead_id)
        VALUES (NEW.user_id, v_seller, current_date, 0, map_origem_comercial(NEW.origem), NULL, 'marcos', NEW.id)
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

-- 3) Realtime nas tabelas comerciais (idempotente) ---------------------------
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.comercial_vendas;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.comercial_metas;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
