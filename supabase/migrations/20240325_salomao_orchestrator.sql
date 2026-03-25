-- 1. Client Briefings (Contexto do negócio do usuário)
CREATE TABLE IF NOT EXISTS public.client_briefings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    business_name TEXT,
    target_audience TEXT,
    offering_details TEXT,
    tone_of_voice TEXT,
    goals JSONB,
    custom_context JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Orchestrator Tasks (Tarefas geradas pelo Salomão)
CREATE TABLE IF NOT EXISTS public.orchestrator_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    type TEXT DEFAULT 'general', -- e.g., 'followup', 'analysis', 'outreach'
    metadata JSONB,
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Agent Executions (Logs de quando o Salomão aciona um sub-agente)
CREATE TABLE IF NOT EXISTS public.agent_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES public.orchestrator_tasks(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES public.wa_ai_agents(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    prompt_input TEXT,
    response_output TEXT,
    tokens_used INTEGER,
    status TEXT DEFAULT 'success',
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Follow-up Queue (Fila de SDR Inteligente)
CREATE TABLE IF NOT EXISTS public.followup_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID REFERENCES public.orchestrator_tasks(id) ON DELETE CASCADE,
    scheduled_for TIMESTAMPTZ NOT NULL,
    channel TEXT DEFAULT 'whatsapp',
    message_content TEXT,
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'paused')),
    attempt_count INTEGER DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS (Row Level Security)
ALTER TABLE public.client_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orchestrator_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_queue ENABLE ROW LEVEL SECURITY;

-- Polices (Básicas: usuário acessa o que é dele ou da organização dele)
-- Nota: Para simplificar, vou usar user_id. Se precisar de Org support completo, adicionaremos depois.

CREATE POLICY "Users can manage their own briefings" ON public.client_briefings
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own tasks" ON public.orchestrator_tasks
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own executions" ON public.agent_executions
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own followups" ON public.followup_queue
    FOR ALL USING (auth.uid() = user_id);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_client_briefings_updated_at BEFORE UPDATE ON public.client_briefings FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_orchestrator_tasks_updated_at BEFORE UPDATE ON public.orchestrator_tasks FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_followup_queue_updated_at BEFORE UPDATE ON public.followup_queue FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
