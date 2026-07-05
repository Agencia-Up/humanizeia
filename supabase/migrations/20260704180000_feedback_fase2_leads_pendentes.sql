-- Fase 2 do Cérebro de Feedback: seletor de leads a analisar (para o cron/lote).
-- Retorna leads "concluídos e não analisados" APENAS dos tenants que ligaram a
-- feature flag 'analise'. Gate por flag => se ninguém ligou, retorna vazio
-- (nada roda, custo zero). O cron chama feedback-analista {batch:true} com isso.
CREATE OR REPLACE FUNCTION public.feedback_leads_pendentes(p_limit int DEFAULT 20, p_horas int DEFAULT 6)
RETURNS TABLE(lead_source text, lead_id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'pedro'::text, l.id, l.user_id
  FROM public.ai_crm_leads l
  JOIN public.feedback_config c
    ON c.tenant_id = l.user_id AND (c.feature_flags->>'analise')::boolean IS TRUE
  WHERE COALESCE(l.last_interaction_at, l.created_at) < now() - make_interval(hours => p_horas)
    AND NOT EXISTS (
      SELECT 1 FROM public.feedback_conversas f
      WHERE f.lead_source = 'pedro' AND f.lead_id = l.id
        AND f.versao_thread = 'v1' AND f.status IN ('concluido','processando')
    )
  ORDER BY COALESCE(l.last_interaction_at, l.created_at) ASC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.feedback_leads_pendentes(int,int) FROM public;
GRANT EXECUTE ON FUNCTION public.feedback_leads_pendentes(int,int) TO service_role;
