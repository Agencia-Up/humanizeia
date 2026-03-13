
-- AI Agent configuration table for WhatsApp auto-reply
CREATE TABLE public.wa_ai_agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES public.wa_instances(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT 'Agente IA',
  system_prompt TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  model TEXT NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  temperature NUMERIC NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 500,
  reply_delay_ms INTEGER NOT NULL DEFAULT 3000,
  business_hours_only BOOLEAN NOT NULL DEFAULT false,
  business_hours_start TIME DEFAULT '08:00',
  business_hours_end TIME DEFAULT '18:00',
  blocked_categories TEXT[] DEFAULT '{"opt-out","spam"}',
  total_replies INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_ai_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own ai agents"
  ON public.wa_ai_agents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
