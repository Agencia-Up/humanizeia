-- ============================================================================
-- Item 7 da auditoria: versiona no Git as RPCs do Cerebro de Feedback que ja
-- existiam em prod sem migration local. Capturadas via pg_get_functiondef do
-- projeto seyljsqmhlopkcauhlor (10/07/2026), reproduzidas SEM alterar comportamento.
-- Objetivo: um ambiente novo consegue subir essas funcoes. Em prod elas ja
-- existem — este arquivo e reproducao fiel (CREATE OR REPLACE idempotente).
-- Nota: feedback_relatorio_dados / feedback_relatorio_diario_dados /
-- feedback_alertas_pendentes / feedback_relatorio_por_vendedor ja estao
-- versionadas em migrations proprias.
-- ============================================================================

-- Leads pendentes de analise (batch do feedback-analista): leads do Pedro que
-- chegaram ao vendedor (existe conversa no wa_inbox), do mes atual, parados ha
-- p_horas, ainda nao concluidos, so em tenants com a flag 'analise'.
-- statement_timeout 60s: o EXISTS com regex sobre wa_inbox e pesado quando
-- chamado pelo cliente do edge (modo batch). O cron diario chama por-lead e nao
-- passa por aqui, mas o batch precisa desse folego pra nao dar timeout.
CREATE OR REPLACE FUNCTION public.feedback_leads_pendentes(p_limit integer DEFAULT 20, p_horas integer DEFAULT 6)
 RETURNS TABLE(lead_source text, lead_id uuid, tenant_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT 'pedro'::text, l.id, l.user_id
  FROM public.ai_crm_leads l
  JOIN public.feedback_config c
    ON c.tenant_id = l.user_id AND (c.feature_flags->>'analise')::boolean IS TRUE
  WHERE COALESCE(l.last_interaction_at, l.created_at) < now() - make_interval(hours => p_horas)
    AND COALESCE(l.last_interaction_at, l.created_at) >= date_trunc('month', now())
    AND EXISTS (
      SELECT 1 FROM public.wa_inbox w
      WHERE w.user_id = l.user_id
        AND right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 8)
          = right(regexp_replace(split_part(l.remote_jid, '@', 1), '[^0-9]', '', 'g'), 8)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.feedback_conversas f
      WHERE f.lead_source = 'pedro' AND f.lead_id = l.id
        AND f.versao_thread = 'v1' AND f.status IN ('concluido','processando')
    )
  ORDER BY COALESCE(l.last_interaction_at, l.created_at) DESC
  LIMIT GREATEST(p_limit, 1);
$function$;

-- Gate de custo: bloqueia se estourou cap de analises/dia OU cap de custo/mes do
-- tenant; senao incrementa o contador de analises do dia. Cap global do tenant.
CREATE OR REPLACE FUNCTION public.feedback_cost_gate(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cap_analises  int;
  v_cap_custo     numeric;
  v_dia           date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_analises_hoje int;
  v_custo_mes     numeric;
BEGIN
  SELECT cap_analises_dia, cap_custo_mes_usd INTO v_cap_analises, v_cap_custo
  FROM public.feedback_config
  WHERE (tenant_id = p_tenant OR tenant_id IS NULL)
  ORDER BY (tenant_id IS NOT NULL) DESC, created_at ASC LIMIT 1;
  v_cap_analises := COALESCE(v_cap_analises, 300);
  v_cap_custo    := COALESCE(v_cap_custo, 30);

  SELECT COALESCE(analises,0) INTO v_analises_hoje
  FROM public.feedback_uso_custo WHERE tenant_id=p_tenant AND dia_ref=v_dia;
  v_analises_hoje := COALESCE(v_analises_hoje, 0);
  SELECT COALESCE(sum(custo_usd),0) INTO v_custo_mes
  FROM public.feedback_uso_custo
  WHERE tenant_id=p_tenant AND date_trunc('month', dia_ref) = date_trunc('month', v_dia);

  IF v_analises_hoje >= v_cap_analises THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cap_analises_dia', 'analises_hoje', v_analises_hoje);
  END IF;
  IF v_custo_mes >= v_cap_custo THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cap_custo_mes_usd', 'custo_mes', v_custo_mes);
  END IF;

  INSERT INTO public.feedback_uso_custo (tenant_id, dia_ref, analises)
  VALUES (p_tenant, v_dia, 1)
  ON CONFLICT (tenant_id, dia_ref) DO UPDATE SET analises = feedback_uso_custo.analises + 1, updated_at = now();

  RETURN jsonb_build_object('allowed', true);
END;
$function$;

-- Registra consumo (tokens/custo) da analise no acumulado do dia.
CREATE OR REPLACE FUNCTION public.feedback_cost_record(p_tenant uuid, p_tokens integer, p_custo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_dia date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  INSERT INTO public.feedback_uso_custo (tenant_id, dia_ref, tokens, custo_usd)
  VALUES (p_tenant, v_dia, COALESCE(p_tokens,0), COALESCE(p_custo,0))
  ON CONFLICT (tenant_id, dia_ref) DO UPDATE
    SET tokens = feedback_uso_custo.tokens + COALESCE(p_tokens,0),
        custo_usd = feedback_uso_custo.custo_usd + COALESCE(p_custo,0),
        updated_at = now();
END;
$function$;

-- Instancia da IA (nunca numero de vendedor) para disparo de relatorio/alerta.
CREATE OR REPLACE FUNCTION public.feedback_instancia_ia(p_tenant uuid)
 RETURNS TABLE(instance_id uuid, phone text, api_url text, provider text, token text, purpose text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id, phone_number, api_url, provider, api_key_encrypted, purpose
  from public.wa_instances
  where user_id = p_tenant
    and seller_member_id is null      -- trava dura: nunca numero de vendedor
    and status = 'connected'
    and coalesce(is_active, true)
  order by (purpose = 'agent') desc, last_message_at desc nulls last
  limit 1;
$function$;

-- Motor de regras: classifica a qualidade do lead (1-4) lendo
-- feedback_regras_qualidade (dados, nao if hard-coded). Regras do tenant
-- sobrescrevem as globais. Suporta criterios de igualdade, _min/_max e qualquer_de.
CREATE OR REPLACE FUNCTION public.feedback_classificar_qualidade(p_tenant uuid, p_nicho text, p_signals jsonb)
 RETURNS feedback_qualidade_lead
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r            record;
  k            text;
  v            jsonb;
  ok           boolean;
  base         text;
  arr          text[];
  hit          boolean;
  v_use_tenant boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.feedback_regras_qualidade
    WHERE nicho = p_nicho AND ativo AND tenant_id = p_tenant
  ) INTO v_use_tenant;

  FOR r IN
    SELECT nivel, criterios
    FROM public.feedback_regras_qualidade
    WHERE nicho = p_nicho AND ativo
      AND ((v_use_tenant AND tenant_id = p_tenant) OR (NOT v_use_tenant AND tenant_id IS NULL))
    ORDER BY prioridade ASC
  LOOP
    ok := true;
    FOR k, v IN SELECT key, value FROM jsonb_each(r.criterios) LOOP
      IF k = 'qualquer_de' THEN
        SELECT array_agg(x) INTO arr FROM jsonb_array_elements_text(v) x;
        hit := false;
        IF arr IS NOT NULL THEN
          FOR base IN SELECT unnest(arr) LOOP
            IF (p_signals->>base) = 'true' THEN hit := true; EXIT; END IF;
          END LOOP;
        END IF;
        IF NOT hit THEN ok := false; EXIT; END IF;
      ELSIF k LIKE '%\_min' THEN
        base := left(k, length(k)-4);
        IF p_signals->>base IS NULL OR (p_signals->>base)::numeric < (v#>>'{}')::numeric THEN ok := false; EXIT; END IF;
      ELSIF k LIKE '%\_max' THEN
        base := left(k, length(k)-4);
        IF p_signals->>base IS NULL OR (p_signals->>base)::numeric > (v#>>'{}')::numeric THEN ok := false; EXIT; END IF;
      ELSE
        IF (p_signals->>k) IS DISTINCT FROM (v#>>'{}') THEN ok := false; EXIT; END IF;
      END IF;
    END LOOP;
    IF ok THEN RETURN r.nivel; END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;
