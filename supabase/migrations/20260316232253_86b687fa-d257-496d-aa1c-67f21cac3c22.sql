ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS company_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS services text DEFAULT '',
  ADD COLUMN IF NOT EXISTS address text DEFAULT '',
  ADD COLUMN IF NOT EXISTS human_whatsapp text DEFAULT '',
  ADD COLUMN IF NOT EXISTS n8n_webhook_url text DEFAULT '',
  ADD COLUMN IF NOT EXISTS agent_type text DEFAULT 'generic' NOT NULL;