
-- Create wa_automations table for post-response automation rules
CREATE TABLE IF NOT EXISTS public.wa_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  trigger_event text NOT NULL,
  action_type text NOT NULL,
  action_config jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  trigger_count integer DEFAULT 0,
  last_triggered_at timestamptz DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.wa_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own automations"
  ON public.wa_automations
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
