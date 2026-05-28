-- ============================================================================
-- 20260528100000_marcos_fix_loja_origem.sql
-- ----------------------------------------------------------------------------
-- Correção do bug introduzido em 27/05/2026 22:00 BRT:
--
-- A spec original do usuário pedia explicitamente "Loja → Porta" no Painel
-- ao Vivo do Pedro. Eu (Claude) implementei errado: o mapeamento ficou como
-- 'loja' → 'outros' na função marcosOrigemSlugToCanonical() do PedroSDR.tsx.
-- Resultado: leads adicionados com origem "Loja" no form Marcos foram salvos
-- com crm_leads.source='loja' E crm_leads.origem='outros' — e depois que a
-- coluna "Outros" foi removida do Painel ao Vivo (commit ecdab12), esses
-- leads ficaram INVISÍVEIS no Painel.
--
-- Esta migration corrige RETROATIVAMENTE: leads que deveriam estar como
-- 'porta' mas estão como 'outros'. Idempotente. Aplica APENAS pra leads
-- onde a evidência é clara (source='loja' OU stage_id em coluna Porta/loja).
-- ============================================================================

-- ─── 1. Leads com source='loja' (criados via form Marcos com origem Loja) ──
-- Esses são o caso óbvio: o vendedor escolheu "Loja" no select, o frontend
-- salvou crm_leads.source='loja' MAS o mapeamento errado pôs origem='outros'.
UPDATE public.crm_leads
SET origem = 'porta'
WHERE origem = 'outros'
  AND source = 'loja';

-- ─── 2. Leads em coluna kanban "Porta/loja" com origem='outros' ───────────
-- Captura também leads históricos (antes do form atual) que estão na
-- coluna "Porta/loja" do kanban mas ficaram com origem='outros' (fallback
-- antigo). Como o Painel ao Vivo mapeia "Loja → Porta" semanticamente,
-- esses devem aparecer no card Porta.
UPDATE public.crm_leads
SET origem = 'porta'
WHERE origem = 'outros'
  AND stage_id IN (
    SELECT id FROM public.crm_pipeline_stages
    WHERE unaccent(LOWER(TRIM(name))) IN ('porta/loja','porta','porta loja')
  );

-- ─── 3. Relatório pós-update ──────────────────────────────────────────────
DO $$
DECLARE
  v_total_outros int;
  v_total_porta  int;
  v_atingidos    int;
BEGIN
  SELECT count(*) INTO v_total_outros FROM public.crm_leads WHERE origem = 'outros';
  SELECT count(*) INTO v_total_porta  FROM public.crm_leads WHERE origem = 'porta';
  SELECT count(*) INTO v_atingidos
    FROM public.crm_leads
    WHERE source = 'loja' AND origem = 'porta';

  RAISE NOTICE '[fix_loja_origem] leads com source=loja agora em origem=porta: %', v_atingidos;
  RAISE NOTICE '[fix_loja_origem] total leads origem=porta: %', v_total_porta;
  RAISE NOTICE '[fix_loja_origem] leads ainda com origem=outros: %', v_total_outros;
END $$;
