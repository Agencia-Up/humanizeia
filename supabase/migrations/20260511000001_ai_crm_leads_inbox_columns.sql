-- Keep the production ai_crm_leads table compatible with the AI inbox/manual takeover flow.
-- Older environments created ai_crm_leads before these columns existed, so the
-- CREATE TABLE IF NOT EXISTS migration never added them.
ALTER TABLE public.ai_crm_leads
  ADD COLUMN IF NOT EXISTS instance_id uuid REFERENCES public.wa_instances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ai_crm_leads_instance_id
  ON public.ai_crm_leads(instance_id);

UPDATE public.ai_crm_leads AS lead
SET instance_id = agent.instance_id
FROM public.wa_ai_agents AS agent
WHERE lead.agent_id = agent.id
  AND lead.instance_id IS NULL
  AND agent.instance_id IS NOT NULL;

UPDATE public.ai_crm_leads AS lead
SET message_count = counts.total
FROM (
  SELECT agent_id, remote_jid, COUNT(*)::integer AS total
  FROM public.wa_chat_history
  GROUP BY agent_id, remote_jid
) AS counts
WHERE lead.agent_id = counts.agent_id
  AND lead.remote_jid = counts.remote_jid
  AND lead.message_count = 0;
