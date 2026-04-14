-- 1. Team Members table
CREATE TABLE IF NOT EXISTS public.ai_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid NULL,
  name text NOT NULL,
  whatsapp_number text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  total_leads_received integer NOT NULL DEFAULT 0,
  last_lead_received_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own team members"
  ON public.ai_team_members FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. CRM Leads table
CREATE TABLE IF NOT EXISTS public.ai_crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  remote_jid text NOT NULL,
  lead_name text,
  agent_id uuid REFERENCES public.wa_ai_agents(id) ON DELETE SET NULL,
  instance_id uuid NULL,
  status text NOT NULL DEFAULT 'novo',
  summary text,
  sentiment text DEFAULT 'neutral',
  message_count integer NOT NULL DEFAULT 0,
  assigned_to_member_id uuid REFERENCES public.ai_team_members(id) ON DELETE SET NULL,
  transferred_at timestamptz NULL,
  transfer_reason text,
  last_interaction_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, remote_jid, agent_id)
);

ALTER TABLE public.ai_crm_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own crm leads"
  ON public.ai_crm_leads FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Lead Transfers history table
CREATE TABLE IF NOT EXISTS public.ai_lead_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.ai_crm_leads(id) ON DELETE CASCADE,
  from_agent_id uuid REFERENCES public.wa_ai_agents(id) ON DELETE SET NULL,
  to_member_id uuid NOT NULL REFERENCES public.ai_team_members(id) ON DELETE CASCADE,
  transfer_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_lead_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own lead transfers"
  ON public.ai_lead_transfers FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_ai_crm_leads_user_status ON public.ai_crm_leads(user_id, status);
CREATE INDEX idx_ai_crm_leads_agent ON public.ai_crm_leads(agent_id);
CREATE INDEX idx_ai_crm_leads_assigned ON public.ai_crm_leads(assigned_to_member_id);
CREATE INDEX idx_ai_lead_transfers_user ON public.ai_lead_transfers(user_id, created_at DESC);
CREATE INDEX idx_ai_lead_transfers_member ON public.ai_lead_transfers(to_member_id, created_at DESC);
CREATE INDEX idx_ai_team_members_agent ON public.ai_team_members(agent_id);

-- Enable realtime for CRM leads
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_crm_leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_lead_transfers;