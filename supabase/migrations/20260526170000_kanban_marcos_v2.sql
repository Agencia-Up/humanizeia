-- ============================================================================
-- Kanban Marcos v2 — Reorganização das colunas
-- ============================================================================
-- Mudanças a pedido do usuário (2026-05-26):
--
-- ANTES (10 stages padrão do Item 3):
--   Novo Lead → Marketing Place → Agendamento → Proposta → Negociação →
--   Fechado → Perdido → Lead Inativo → Carro não disponível → Porta
--
-- DEPOIS (7 stages, nova ordem):
--   Leads Inativos → Marketing Place → Porta/loja → Não tem no Estoque →
--   Agendamento → Negociação → Fechado
--
-- Mudanças por stage:
--   ❌ REMOVE: Novo Lead, Proposta, Perdido (leads migram pra "Leads Inativos")
--   🔄 RENOMEIA: Lead Inativo → Leads Inativos (plural)
--                Porta → Porta/loja
--                Carro não disponível → Não tem no Estoque
--   ✅ MANTÉM: Marketing Place, Agendamento, Negociação, Fechado
--   📍 REORDENA: Leads Inativos=0, Marketing Place=1, Porta/loja=2,
--                Não tem no Estoque=3, Agendamento=4, Negociação=5, Fechado=6
--
-- ESCOPO SEGURO: aplica APENAS a users com o set padrão EXATO de 10 stages.
-- Users que customizaram ficam intocados (ajustam manualmente via nova UI
-- em Settings → Kanban Marcos).
--
-- Idempotente: re-rodar não muda nada.
-- ============================================================================

DO $$
DECLARE
  rec RECORD;
  v_novo_id uuid;
  v_proposta_id uuid;
  v_perdido_id uuid;
  v_inativo_id uuid;
  v_processados int := 0;
BEGIN
  -- Itera só sobre users com EXATAMENTE 10 stages padrão (set do Item 3)
  FOR rec IN
    SELECT user_id
    FROM crm_pipeline_stages
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) = 10
       AND ARRAY_AGG(unaccent(LOWER(TRIM(name))) ORDER BY position) = ARRAY[
         'novo lead', 'marketing place', 'agendamento', 'proposta',
         'negociacao', 'fechado', 'perdido', 'lead inativo',
         'carro nao disponivel', 'porta'
       ]
  LOOP
    -- 1. Pega IDs das stages que vão ser removidas + destino
    SELECT id INTO v_novo_id      FROM crm_pipeline_stages WHERE user_id=rec.user_id AND unaccent(LOWER(TRIM(name)))='novo lead';
    SELECT id INTO v_proposta_id  FROM crm_pipeline_stages WHERE user_id=rec.user_id AND unaccent(LOWER(TRIM(name)))='proposta';
    SELECT id INTO v_perdido_id   FROM crm_pipeline_stages WHERE user_id=rec.user_id AND unaccent(LOWER(TRIM(name)))='perdido';
    SELECT id INTO v_inativo_id   FROM crm_pipeline_stages WHERE user_id=rec.user_id AND unaccent(LOWER(TRIM(name)))='lead inativo';

    -- 2. Migra leads das stages removidas pra Leads Inativos
    IF v_inativo_id IS NOT NULL THEN
      IF v_novo_id IS NOT NULL THEN
        UPDATE crm_leads SET stage_id = v_inativo_id WHERE stage_id = v_novo_id;
      END IF;
      IF v_proposta_id IS NOT NULL THEN
        UPDATE crm_leads SET stage_id = v_inativo_id WHERE stage_id = v_proposta_id;
      END IF;
      IF v_perdido_id IS NOT NULL THEN
        UPDATE crm_leads SET stage_id = v_inativo_id WHERE stage_id = v_perdido_id;
      END IF;
    END IF;

    -- 3. Remove as 3 stages
    DELETE FROM crm_pipeline_stages WHERE id IN (v_novo_id, v_proposta_id, v_perdido_id) AND id IS NOT NULL;

    -- 4. Renomeia 3 stages
    UPDATE crm_pipeline_stages SET name='Leads Inativos'
      WHERE user_id=rec.user_id AND unaccent(LOWER(TRIM(name)))='lead inativo';
    UPDATE crm_pipeline_stages SET name='Porta/loja'
      WHERE user_id=rec.user_id AND unaccent(LOWER(TRIM(name)))='porta';
    UPDATE crm_pipeline_stages SET name='Não tem no Estoque'
      WHERE user_id=rec.user_id AND unaccent(LOWER(TRIM(name)))='carro nao disponivel';

    -- 5. Reordena as 7 stages finais
    UPDATE crm_pipeline_stages SET position = CASE unaccent(LOWER(TRIM(name)))
      WHEN 'leads inativos'      THEN 0
      WHEN 'marketing place'     THEN 1
      WHEN 'porta/loja'          THEN 2
      WHEN 'nao tem no estoque'  THEN 3
      WHEN 'agendamento'         THEN 4
      WHEN 'negociacao'          THEN 5
      WHEN 'fechado'             THEN 6
      ELSE position
    END
    WHERE user_id = rec.user_id;

    v_processados := v_processados + 1;
  END LOOP;

  RAISE NOTICE '[KanbanMarcosV2] masters processados: %', v_processados;
END $$;
