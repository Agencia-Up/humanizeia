-- =============================================================================
-- TESTES — Ingestor do Feedback lendo o CLIENTE do Pedro V3 (v3_inbox)
-- Read-only. Simula EXATAMENTE as consultas que o buildLeadThread novo faz
-- (supabase/functions/_shared/feedback/ingestor.ts, 23/07/2026):
--   * conversas do lead via v3_conversation_routing (tenant_id + lead_id);
--   * v3_inbox extraindo SÓ campos seguros (raw->>'text' e
--     mediaContext.kind/text/summary — raw inteiro e raw.sensitive nunca saem);
--   * IA continua vindo de v3_effect_outbox (send_message + dispatched_at),
--     caminho INALTERADO.
-- Rodar no SQL editor / MCP do prod (seyljsqmhlopkcauhlor).
--
-- RESULTADO 23/07/2026:
--   T1 (lead puro fbeb7da6-...): cliente_msgs_novo_bloco=2 (antes: 0),
--      ia_msgs_contexto=5, linhas_puladas=0, colisoes_dedupe=0.
--   T2 (agregado, 100 leads v3 com CRM): 100/100 ganham cliente (375 msgs);
--      63 leads SEM nenhum incoming em wa_inbox — todos resgatados; 0 ficam
--      sem fala de cliente. Colisões v3×wa_inbox medidas antes: 0/384.
-- =============================================================================

-- ── T1: um lead v3 PURO (sem wa_inbox/wa_chat_history) — thread deixa de ficar
--        sem a fala do cliente; IA (contexto) inalterada; nada é pulado. ──────
WITH puro AS (
  SELECT l.id AS lead_id, l.user_id AS tenant
  FROM v3_conversation_state cs
  JOIN ai_crm_leads l ON l.id::text = cs.lead_id
  WHERE NOT EXISTS (SELECT 1 FROM wa_inbox i WHERE i.user_id = l.user_id
                    AND public.logos_phone_key(i.phone) = public.logos_phone_key(split_part(l.remote_jid,'@',1)))
    AND NOT EXISTS (SELECT 1 FROM wa_chat_history h WHERE h.user_id = l.user_id
                    AND public.logos_phone_key(split_part(h.remote_jid,'@',1)) = public.logos_phone_key(split_part(l.remote_jid,'@',1)))
  LIMIT 1
), rotas AS (
  SELECT DISTINCT r.conversation_id FROM v3_conversation_routing r, puro p
  WHERE r.tenant_id = p.tenant AND r.lead_id = p.lead_id::text
), cli AS (
  SELECT vi.event_id,
         nullif(vi.raw->>'text','') AS texto,
         nullif(vi.raw #>> '{mediaContext,kind}','') AS mc_kind,
         nullif(vi.raw #>> '{mediaContext,text}','') AS mc_text,
         nullif(vi.raw #>> '{mediaContext,summary}','') AS mc_summary,
         coalesce(vi.received_at, vi.created_at) AS at
  FROM v3_inbox vi, puro p
  WHERE vi.tenant_id = p.tenant AND vi.conversation_id IN (SELECT conversation_id FROM rotas)
), ia AS (
  SELECT eo.effect_id FROM v3_effect_outbox eo, puro p
  WHERE eo.tenant_id = p.tenant AND eo.conversation_id IN (SELECT conversation_id FROM rotas)
    AND eo.kind='send_message' AND eo.dispatched_at IS NOT NULL
    AND coalesce(eo.payload->>'text','') <> ''
)
SELECT
 (SELECT lead_id FROM puro) AS lead_v3_puro,
 (SELECT count(*) FROM rotas) AS conversas,
 (SELECT count(*) FROM cli WHERE texto IS NOT NULL OR mc_kind IS NOT NULL) AS cliente_msgs_novo_bloco, -- >0
 (SELECT count(*) FROM cli WHERE mc_kind='audio') AS cliente_audios,
 (SELECT count(*) FROM cli WHERE mc_kind='image') AS cliente_imagens,
 (SELECT count(*) FROM ia) AS ia_msgs_contexto,                                                        -- >0 (inalterado)
 (SELECT count(*) FROM cli WHERE texto IS NULL AND mc_kind IS NULL) AS linhas_puladas,
 (SELECT count(*) FROM cli c, puro p WHERE EXISTS (
    SELECT 1 FROM wa_inbox i WHERE i.user_id=p.tenant AND i.direction='incoming'
      AND lower(regexp_replace(coalesce(i.content,''),'\s+',' ','g')) = lower(regexp_replace(coalesce(c.texto,''),'\s+',' ','g'))
      AND abs(extract(epoch FROM (i.created_at - c.at))) < 120)) AS colisoes_dedupe;                   -- 0

-- ── T2: agregado — quantos leads v3 passam a ter a fala do cliente ───────────
WITH v3l AS (
  SELECT DISTINCT l.id AS lead_id, l.user_id AS tenant,
         public.logos_phone_key(split_part(l.remote_jid,'@',1)) AS k
  FROM v3_conversation_state cs
  JOIN ai_crm_leads l ON l.id::text = cs.lead_id
), per AS (
  SELECT v.lead_id, v.tenant, v.k,
    (SELECT count(*) FROM v3_inbox vi
      WHERE vi.tenant_id = v.tenant
        AND vi.conversation_id IN (SELECT r.conversation_id FROM v3_conversation_routing r
                                   WHERE r.tenant_id = v.tenant AND r.lead_id = v.lead_id::text)
        AND (coalesce(vi.raw->>'text','') <> '' OR vi.raw #>> '{mediaContext,kind}' IS NOT NULL)) AS cli_v3,
    EXISTS (SELECT 1 FROM wa_inbox i WHERE i.user_id = v.tenant AND i.direction='incoming'
            AND public.logos_phone_key(i.phone) = v.k) AS tem_wa_incoming
  FROM v3l v
)
SELECT count(*) AS leads_v3,
 count(*) FILTER (WHERE cli_v3 > 0) AS leads_ganham_cliente_v3,          -- esperado: todos
 count(*) FILTER (WHERE NOT tem_wa_incoming) AS leads_sem_cliente_wa,
 count(*) FILTER (WHERE NOT tem_wa_incoming AND cli_v3 > 0) AS puros_resgatados,
 count(*) FILTER (WHERE NOT tem_wa_incoming AND cli_v3 = 0) AS puros_ainda_sem_cliente, -- esperado: 0
 sum(cli_v3) AS total_msgs_cliente_v3
FROM per;

-- ── T3 (regressão): Marcos e wa_inbox — o ingestor NÃO mudou nenhuma consulta
-- dessas fontes (crm_leads/wa_inbox/wa_chat_history intactas; o dedupe só é
-- aplicado às mensagens VINDAS do V3). Conferência = diff do commit.
