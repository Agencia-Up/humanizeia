-- v4 do alerta "bom cliente em risco": devolve tem_troca/tem_entrada separados
-- (pro checklist do novo formato de alerta) em vez do 'motivo' composto.
-- Gatilho/regua inalterados (bom cliente + score<45 + sem venda + com vendedor).
-- DROP+CREATE (mudou o retorno).
DROP FUNCTION IF EXISTS public.feedback_alertas_pendentes(uuid);
CREATE FUNCTION public.feedback_alertas_pendentes(p_tenant uuid)
RETURNS TABLE(conversa_id uuid, lead_nome text, veiculo text, vendedor_nome text,
             telefone text, ultimo_contato text, tem_troca boolean, tem_entrada boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH c AS (
    SELECT fc.id, l.remote_jid,
      right(regexp_replace(coalesce(split_part(l.remote_jid,'@',1),''),'[^0-9]','','g'),8) AS tail8,
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
    regexp_replace(coalesce(split_part(remote_jid,'@',1),''),'[^0-9]','','g') AS telefone,
    (SELECT to_char(max(w.created_at) AT TIME ZONE 'America/Sao_Paulo','HH24:MI')
     FROM wa_inbox w WHERE w.user_id = p_tenant AND tail8 <> ''
       AND right(regexp_replace(coalesce(w.phone,''),'[^0-9]','','g'),8) = tail8) AS ultimo_contato,
    troca AS tem_troca, entrada AS tem_entrada
  FROM c
  WHERE bom AND NOT vendeu AND coalesce(score,0) < 45
  ORDER BY score ASC NULLS FIRST
  LIMIT 25;
$function$;
