-- Recurso: qual PRODUTO (carro, no nicho auto) traz os leads mais qualificados.
-- Genérico (não só carro). NÃO toca em transferência/CRM/follow-up.
-- Consumido pela aba "Por produto" da área de Feedbacks (FeedbackPorProdutoTab.tsx).
-- Aplicada em prod via MCP (10/07); este arquivo é a versão fiel em Git.

ALTER TABLE public.feedback_conversas ADD COLUMN IF NOT EXISTS produto_interesse text;
CREATE INDEX IF NOT EXISTS idx_feedback_conversas_produto
  ON public.feedback_conversas (tenant_id, produto_interesse);

-- Backfill: usa o produto que o Pedro já identificou na conversa (ai_crm_leads.vehicle_interest).
UPDATE public.feedback_conversas fc
   SET produto_interesse = nullif(trim(l.vehicle_interest), '')
  FROM public.ai_crm_leads l
 WHERE fc.lead_id = l.id AND fc.lead_source = 'pedro'
   AND fc.produto_interesse IS NULL
   AND nullif(trim(l.vehicle_interest), '') IS NOT NULL;

-- Agregação por produto × qualidade do lead (últimos p_dias). Escopo do tenant
-- (resolve_billing_owner_user_id do auth.uid()), igual aos outros relatórios de feedback.
-- qualidade: 1_alto=qualificado, 2_medio=pouco, 3_baixo=ruim, 4_nao_lead=nem-é-lead.
CREATE OR REPLACE FUNCTION public.feedback_produtos_qualidade(p_dias int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid; v_res jsonb; v_ini date;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_tenant := public.resolve_billing_owner_user_id(auth.uid());
  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_ini := ((now() AT TIME ZONE 'America/Sao_Paulo')::date) - greatest(coalesce(p_dias, 30), 1) + 1;

  WITH base AS (
    SELECT
      coalesce(fc.qualidade_lead::text, fc.resultado->>'qualidade_lead') AS q,
      lower(trim(coalesce(nullif(trim(fc.produto_interesse), ''), nullif(trim(l.vehicle_interest), '')))) AS pkey,
      coalesce(nullif(trim(fc.produto_interesse), ''), nullif(trim(l.vehicle_interest), '')) AS plabel
    FROM public.feedback_conversas fc
    LEFT JOIN public.ai_crm_leads l ON l.id = fc.lead_id
    WHERE fc.tenant_id = v_tenant AND fc.status = 'concluido'
      AND coalesce(fc.analisado_em, fc.created_at)::date >= v_ini
  ),
  agg AS (
    SELECT coalesce(pkey, '(nao identificado)') AS pkey,
      coalesce(max(plabel), '(não identificado)') AS produto,
      count(*) AS total,
      count(*) FILTER (WHERE q = '1_alto') AS qualificados,
      count(*) FILTER (WHERE q = '2_medio') AS pouco,
      count(*) FILTER (WHERE q = '3_baixo') AS ruins,
      count(*) FILTER (WHERE q = '4_nao_lead') AS nao_lead,
      count(*) FILTER (WHERE q IS NULL) AS sem_classe
    FROM base GROUP BY coalesce(pkey, '(nao identificado)')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'produto', produto, 'total', total,
    'qualificados', qualificados, 'pouco_qualificados', pouco, 'ruins', ruins,
    'nao_lead', nao_lead, 'sem_classe', sem_classe,
    'pct_qualificado', CASE WHEN total > 0 THEN round(100.0 * qualificados / total) ELSE 0 END
  ) ORDER BY total DESC, qualificados DESC), '[]'::jsonb)
  INTO v_res FROM agg;
  RETURN v_res;
END; $$;
REVOKE ALL ON FUNCTION public.feedback_produtos_qualidade(int) FROM public;
GRANT EXECUTE ON FUNCTION public.feedback_produtos_qualidade(int) TO authenticated;
