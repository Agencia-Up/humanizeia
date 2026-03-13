
-- Phase 1: Failover Inteligente
ALTER TABLE public.wa_instances ADD COLUMN IF NOT EXISTS failover_status text DEFAULT NULL;
ALTER TABLE public.wa_contacts ADD COLUMN IF NOT EXISTS current_instance_id uuid DEFAULT NULL;

-- Audit logs table
CREATE TABLE IF NOT EXISTS public.wa_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  instance_id uuid DEFAULT NULL,
  contact_id uuid DEFAULT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own audit logs"
  ON public.wa_audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own audit logs"
  ON public.wa_audit_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Phase 2: CRM Tags
CREATE TABLE IF NOT EXISTS public.wa_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own tags"
  ON public.wa_tags FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS wa_tags_user_name_unique ON public.wa_tags (user_id, name);
