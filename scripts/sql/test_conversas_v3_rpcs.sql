-- =============================================================================
-- TESTES — Conversas nativas Pedro V3 (RPCs get_allowed_lead_*)
-- Executar em prod (read-only) via SQL editor / MCP. Cada bloco simula um papel
-- com SET LOCAL request.jwt.claims (padrão do projeto p/ testar RLS/RPC).
--
-- Atores usados na validação de 23/07/2026 (tenant Icom f49fd48a-...):
--   MASTER    sub = f49fd48a-4386-4009-95f3-26a5100b84f7
--   VENDEDOR A sub = fbbc1346-a200-4090-9df7-5fa21b6c2814 (member 0a03b499-...)
--   VENDEDOR B sub = f621e6e6-69e2-4f8b-a92c-ca9cd4b1a55c (member c498e93b-...)
--   lead v3 do A  = ec8c8ba2-c1a0-42b5-aaad-1c3ead679340
--   lead v3 do B  = 4c4a9265-5eef-49d1-837b-ebf73760e07e
--   nº interno    = 5512991501055 (ai_team_members do tenant)
--   nº órfão v3   = 5512988288047 (v3_conversation_state SEM lead no CRM)
-- Troque os literais ao re-rodar em outra base/época.
--
-- RESULTADO 23/07/2026 (todos os 12 critérios): VERDE
--   Master: lista 1698 (96/96 v3, todas com preview), inbox 1652 (96/96 v3;
--     antes 63/96 — +33 conversas v3 recuperadas), marcos 554 na lista,
--     timeline marcos 38 msgs, interno 0/0, órfão 0/0.
--   Vendedor A: 422 conversas (0 do B), timeline lead do B = 0, interno = 0,
--     timeline do próprio lead 28 msgs (14 cliente / 4 ia / 10 vendedor).
--   Vendedor B: 379 conversas (0 do A), recíproco ok.
-- =============================================================================

-- ── T1: VENDEDOR A — só vê o que é dele; fail-closed no resto ────────────────
BEGIN;
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"fbbc1346-a200-4090-9df7-5fa21b6c2814","role":"authenticated"}';
WITH lista AS (SELECT * FROM public.get_allowed_lead_conversations(NULL,NULL,true,100000)),
     inbox AS (SELECT * FROM public.get_allowed_lead_inbox(100000)),
     tlA AS (SELECT * FROM public.get_allowed_lead_messages(NULL,'ec8c8ba2-c1a0-42b5-aaad-1c3ead679340','pedro',NULL,2000))
SELECT
 (SELECT count(*) FROM lista) AS a_lista_total,                                     -- >0
 (SELECT count(*) FROM lista WHERE assigned_to_id = 'c498e93b-5607-426d-a0e0-c107f52eb999') AS a_lista_leads_do_b, -- 0
 (SELECT count(*) FROM lista WHERE lead_id = '4c4a9265-5eef-49d1-837b-ebf73760e07e') AS a_lista_tem_lead_b,       -- 0
 (SELECT count(*) FROM inbox WHERE lead_id = '4c4a9265-5eef-49d1-837b-ebf73760e07e') AS a_inbox_tem_lead_b,       -- 0
 (SELECT count(*) FROM tlA) AS a_timeline_lead_a,                                   -- >0
 (SELECT count(*) FILTER (WHERE actor='ia') FROM tlA) AS a_tl_ia,                   -- >0 (resposta da IA v3)
 (SELECT count(*) FILTER (WHERE actor='cliente') FROM tlA) AS a_tl_cliente,         -- >0 (inbound do lead)
 (SELECT count(*) FROM public.get_allowed_lead_messages(NULL,'4c4a9265-5eef-49d1-837b-ebf73760e07e','pedro',NULL,2000)) AS a_timeline_lead_b, -- 0
 (SELECT count(*) FROM public.get_allowed_lead_messages('5512991501055',NULL,NULL,NULL,2000)) AS a_timeline_interno; -- 0
COMMIT;

-- ── T2: VENDEDOR B — recíproco ───────────────────────────────────────────────
BEGIN;
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"f621e6e6-69e2-4f8b-a92c-ca9cd4b1a55c","role":"authenticated"}';
WITH lista AS (SELECT * FROM public.get_allowed_lead_conversations(NULL,NULL,true,100000))
SELECT
 (SELECT count(*) FROM lista) AS b_lista_total,                                     -- >0
 (SELECT count(*) FROM lista WHERE lead_id = 'ec8c8ba2-c1a0-42b5-aaad-1c3ead679340') AS b_lista_tem_lead_a, -- 0
 (SELECT count(*) FROM public.get_allowed_lead_messages(NULL,'ec8c8ba2-c1a0-42b5-aaad-1c3ead679340','pedro',NULL,2000)) AS b_timeline_lead_a, -- 0
 (SELECT count(*) FROM public.get_allowed_lead_messages(NULL,'4c4a9265-5eef-49d1-837b-ebf73760e07e','pedro',NULL,2000)) AS b_timeline_lead_b; -- >0
COMMIT;

-- ── T3: MASTER — v3 completo; interno e órfão FORA; Marcos intacto ───────────
BEGIN;
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"f49fd48a-4386-4009-95f3-26a5100b84f7","role":"authenticated"}';
WITH lista AS (SELECT * FROM public.get_allowed_lead_conversations(NULL,NULL,true,100000)),
     inbox AS (SELECT * FROM public.get_allowed_lead_inbox(100000)),
     v3l AS (SELECT DISTINCT cs.lead_id::uuid AS lead_uuid
             FROM public.v3_conversation_state cs
             JOIN public.ai_crm_leads l ON l.id::text = cs.lead_id
             WHERE cs.tenant_id = 'f49fd48a-4386-4009-95f3-26a5100b84f7'),
     mlead AS (SELECT lead_id FROM lista WHERE source='marcos' AND last_message IS NOT NULL LIMIT 1)
SELECT
 (SELECT count(*) FROM lista) AS m_lista_total,
 (SELECT count(*) FROM inbox) AS m_inbox_total,
 (SELECT count(*) FROM v3l) AS v3_leads_crm,
 (SELECT count(*) FROM v3l WHERE lead_uuid IN (SELECT lead_id FROM lista)) AS v3_na_lista,   -- = v3_leads_crm
 (SELECT count(*) FROM v3l WHERE lead_uuid IN (SELECT lead_id FROM inbox)) AS v3_no_inbox,   -- = v3_leads_crm
 (SELECT count(*) FROM lista WHERE has_v3_activity) AS lista_flag_v3,                        -- = v3_leads_crm
 (SELECT count(*) FROM lista WHERE last_message IS NOT NULL) AS lista_com_preview,           -- = m_lista_total
 (SELECT count(*) FROM lista WHERE source='marcos') AS marcos_na_lista,                      -- >0 (compat)
 (SELECT count(*) FROM public.get_allowed_lead_messages(NULL,(SELECT lead_id FROM mlead),'marcos',NULL,500)) AS timeline_marcos, -- >0
 (SELECT count(*) FROM lista WHERE lead_key = public.logos_phone_key('5512991501055')) AS interno_na_lista,  -- 0
 (SELECT count(*) FROM public.get_allowed_lead_messages('5512991501055',NULL,NULL,NULL,500)) AS interno_timeline, -- 0
 (SELECT count(*) FROM lista WHERE lead_key = public.logos_phone_key('5512988288047')) AS orfao_na_lista,    -- 0
 (SELECT count(*) FROM inbox WHERE public.logos_phone_key(phone) = public.logos_phone_key('5512988288047')) AS orfao_no_inbox, -- 0
 (SELECT count(*) FILTER (WHERE actor='vendedor') FROM public.get_allowed_lead_messages(NULL,'ec8c8ba2-c1a0-42b5-aaad-1c3ead679340','pedro',NULL,2000)) AS tl_pos_transferencia_vendedor, -- >0
 (SELECT count(*) FILTER (WHERE actor='ia' AND source='v3') FROM public.get_allowed_lead_messages(NULL,'ec8c8ba2-c1a0-42b5-aaad-1c3ead679340','pedro',NULL,2000)) AS tl_ia_v3; -- >0
COMMIT;
