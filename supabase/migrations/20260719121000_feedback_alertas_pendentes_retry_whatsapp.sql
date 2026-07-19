-- ============================================================================
-- FIX idempotencia de alertas: a versao anterior considerava um caso "avisado"
-- se existisse QUALQUER linha em feedback_alertas para a conversa — inclusive
-- registro painel_flag gravado quando o envio de WhatsApp FALHOU. Resultado:
-- falha temporaria de WhatsApp "queimava" o alerta e nunca havia retry.
--
-- NOVA SEMANTICA (unica mudanca: o NOT EXISTS):
--   queimado  = existe registro com enviado_em IS NOT NULL (entrega efetivada
--               em canal final: whatsapp enviado OU painel quando painel e o
--               unico canal configurado — a edge grava enviado_em nesses casos)
--   pendente  = registro com enviado_em NULL (ex.: flag de painel gravada
--               enquanto o WhatsApp falhou) NAO bloqueia nova tentativa.
-- Anti-flood: entrega efetivada queima na hora; a edge nao duplica flag de
-- painel (insere painel_flag 1x por conversa) e teste (test_number) nao grava.
-- feedback_alertas esta vazia em producao no momento desta migration — sem
-- risco de reabertura em massa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.feedback_alertas_pendentes(p_tenant uuid)
 RETURNS TABLE(conversa_id uuid, lead_nome text, veiculo text, vendedor_nome text, telefone text, ultimo_contato text, tem_troca boolean, tem_entrada boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH inbox_ultimo AS (
    -- último contato por telefone nacional canônico (pré-computado 1x)
    SELECT z.fone, max(z.created_at) AS ultimo
    FROM (
      SELECT CASE WHEN length(w.g) > 11 AND left(w.g,2) = '55' THEN substr(w.g,3) ELSE w.g END AS fone,
             w.created_at
      FROM (
        SELECT regexp_replace(COALESCE(phone,''),'[^0-9]','','g') AS g, created_at
        FROM public.wa_inbox
        WHERE user_id = p_tenant
      ) w
      WHERE length(w.g) >= 10
    ) z
    GROUP BY z.fone
  ),
  c AS (
    SELECT fc.id,
      COALESCE(p.remote_jid,
        CASE WHEN COALESCE(m.phone,'') <> '' THEN regexp_replace(m.phone,'[^0-9]','','g') || '@s.whatsapp.net' END
      ) AS remote_jid,
      CASE WHEN length(g.gl) > 11 AND left(g.gl,2) = '55' THEN substr(g.gl,3) ELSE g.gl END AS lead_nac,
      COALESCE(NULLIF(trim(p.lead_name),''), NULLIF(trim(m.name),''), 'Cliente') AS lead_nome,
      left(COALESCE(NULLIF(trim(p.vehicle_interest),''), NULLIF(trim(m.vehicle_interest),''), NULLIF(trim(m.consignado_modelo),''), ''), 24) AS veiculo,
      nullif(trim(tm.name),'') AS vendedor_nome,
      fc.score_atendimento AS score,
      ((fc.resultado->>'houve_venda')='true' OR fc.veredito='venda_realizada') AS vendeu,
      CASE
        WHEN fc.qualidade_lead IN ('1_alto','2_medio') THEN true
        WHEN lower(coalesce(fc.resultado->>'potencial_compra','')) IN ('alto','medio') THEN true
        WHEN lower(coalesce(p.temperature,'')) = 'quente' THEN true
        ELSE false
      END AS bom,
      coalesce((fc.resultado->'sinais'->>'carro_na_troca')::boolean, false) AS troca,
      coalesce((fc.resultado->'sinais'->>'tem_entrada')::boolean, false) AS entrada
    FROM public.feedback_conversas fc
    LEFT JOIN public.ai_crm_leads p ON fc.lead_source = 'pedro' AND p.id = fc.lead_id
    LEFT JOIN public.crm_leads m ON fc.lead_source = 'marcos' AND m.id = fc.lead_id
    JOIN public.ai_team_members tm ON tm.id = fc.vendedor_id
    CROSS JOIN LATERAL (
      SELECT regexp_replace(COALESCE(CASE WHEN fc.lead_source='pedro' THEN split_part(p.remote_jid,'@',1) ELSE m.phone END,''),'[^0-9]','','g') AS gl
    ) g
    WHERE fc.tenant_id = p_tenant AND fc.status = 'concluido'
      AND fc.vendedor_id IS NOT NULL
      AND fc.analisado_em >= now() - interval '2 days'
      -- FIX: so considera "avisado" quando houve ENTREGA efetivada (enviado_em).
      -- Registro de painel gravado durante falha de WhatsApp NAO queima o retry.
      AND NOT EXISTS (
        SELECT 1 FROM public.feedback_alertas a
        WHERE a.feedback_conversa_id = fc.id
          AND a.enviado_em IS NOT NULL
      )
  )
  SELECT c.id,
    c.lead_nome,
    c.veiculo,
    c.vendedor_nome,
    regexp_replace(COALESCE(split_part(c.remote_jid,'@',1),''),'[^0-9]','','g') AS telefone,
    to_char(iu.ultimo AT TIME ZONE 'America/Sao_Paulo','HH24:MI') AS ultimo_contato,
    c.troca AS tem_troca,
    c.entrada AS tem_entrada
  FROM c
  LEFT JOIN inbox_ultimo iu ON iu.fone = c.lead_nac AND c.lead_nac <> ''
  WHERE c.bom AND NOT c.vendeu AND coalesce(c.score,0) < 45
  ORDER BY c.score ASC NULLS FIRST
  LIMIT 25;
$function$;

COMMENT ON FUNCTION public.feedback_alertas_pendentes(uuid) IS
  'Casos "bom cliente em risco" ainda nao ENTREGUES (enviado_em preenchido = entregue). Registro de painel com enviado_em NULL nao bloqueia retry de WhatsApp.';
