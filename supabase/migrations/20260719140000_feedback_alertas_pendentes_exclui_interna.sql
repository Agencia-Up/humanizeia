-- ============================================================================
-- BLINDAGEM: feedback_alertas_pendentes nao filtrava conversas INTERNAS.
--
-- A versao 20260719121000 (retry de WhatsApp) manteve a selecao de casos sem o
-- filtro explicito de is_internal — uma conversa interna (vendedor<->gerente/
-- responsavel) analisada na janela de 2 dias PODERIA virar alerta de "cliente
-- bom em risco" no WhatsApp do gestor. Esta migration redefine a funcao
-- adicionando `AND coalesce(fc.is_internal, false) = false`, alinhando com o
-- mesmo filtro ja usado em feedback_relatorio_por_vendedor.
--
-- UNICA mudanca em relacao a versao anterior: o filtro de is_internal.
-- Nenhuma migration antiga foi editada.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.feedback_alertas_pendentes(p_tenant uuid)
 RETURNS TABLE(conversa_id uuid, lead_nome text, veiculo text, vendedor_nome text, telefone text, ultimo_contato text, tem_troca boolean, tem_entrada boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH inbox_ultimo AS (
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
      AND coalesce(fc.is_internal, false) = false   -- BLINDAGEM: nunca conversa interna
      AND fc.vendedor_id IS NOT NULL
      AND fc.analisado_em >= now() - interval '2 days'
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
  'Casos "bom cliente em risco" ainda nao ENTREGUES (enviado_em preenchido = entregue). Exclui conversa interna (is_internal). Registro de painel com enviado_em NULL nao bloqueia retry de WhatsApp.';
