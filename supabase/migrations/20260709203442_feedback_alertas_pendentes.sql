-- Casos do ALERTA em tempo real "bom cliente em risco" (estado FINAL do dia,
-- consolida v1+v2): o cerebro considera o cliente BOM (interesse real) mas ele
-- foi mal atendido (score<45) e nao vendeu. So leads COM vendedor atribuido (o
-- alerta e sobre o vendedor deixar cair um bom cliente; lead sem vendedor e da
-- fila/repasse). Mesma regua 'pot' e mesmo limiar (score<45) do relatorio ->
-- alerta e relatorio nunca divergem. Idempotente (exclui quem ja tem linha em
-- feedback_alertas). Janela 2d pra nao blastar backlog ao ligar a flag.
CREATE OR REPLACE FUNCTION public.feedback_alertas_pendentes(p_tenant uuid)
RETURNS TABLE(conversa_id uuid, lead_nome text, veiculo text, vendedor_nome text, motivo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH c AS (
    SELECT fc.id,
      coalesce(nullif(trim(l.lead_name),''),'Cliente') AS lead_nome,
      left(coalesce(l.vehicle_interest,''),24) AS veiculo,
      nullif(trim(tm.name),'') AS vendedor_nome,
      fc.score_atendimento AS score,
      ((fc.resultado->>'houve_venda')='true' OR fc.veredito='venda_realizada') AS vendeu,
      CASE
        WHEN fc.qualidade_lead IN ('1_alto','2_medio') THEN true
        WHEN lower(coalesce(fc.resultado->>'potencial_compra','')) IN ('alto','medio') THEN true
        WHEN lower(coalesce(l.temperature,''))='quente' THEN true
        ELSE false
      END AS bom,
      coalesce((fc.resultado->'sinais'->>'carro_na_troca')::boolean,false) AS troca,
      coalesce((fc.resultado->'sinais'->>'tem_entrada')::boolean,false) AS entrada
    FROM feedback_conversas fc
    LEFT JOIN ai_crm_leads l ON l.id = fc.lead_id
    JOIN ai_team_members tm ON tm.id = fc.vendedor_id
    WHERE fc.tenant_id = p_tenant AND fc.status='concluido'
      AND fc.vendedor_id IS NOT NULL
      AND fc.analisado_em >= now() - interval '2 days'
      AND NOT EXISTS (SELECT 1 FROM feedback_alertas a WHERE a.feedback_conversa_id = fc.id)
  )
  SELECT id, lead_nome, veiculo, vendedor_nome,
    CASE
      WHEN troca AND entrada THEN 'tinha carro na troca e falou de entrada, mas foi mal atendido'
      WHEN troca THEN 'tinha carro na troca, mas foi mal atendido'
      WHEN entrada THEN 'falou de entrada, mas foi mal atendido'
      ELSE 'demonstrou interesse real de compra, mas foi mal atendido'
    END AS motivo
  FROM c
  WHERE bom AND NOT vendeu AND coalesce(score,0) < 45
  ORDER BY score ASC NULLS FIRST
  LIMIT 25;
$function$;
