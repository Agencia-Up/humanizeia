
-- Capture Forms table
CREATE TABLE public.capture_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  instance_id uuid REFERENCES public.wa_instances(id),
  welcome_message text DEFAULT 'Olá {nome}! 👋 Obrigado por se cadastrar!',
  auto_create_contact boolean DEFAULT true,
  auto_send_whatsapp boolean DEFAULT true,
  auto_add_to_crm boolean DEFAULT false,
  auto_fire_capi boolean DEFAULT false,
  tags text[] DEFAULT '{}',
  custom_fields jsonb DEFAULT '[]',
  redirect_url text,
  is_active boolean DEFAULT true,
  submission_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Form submissions table
CREATE TABLE public.capture_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.capture_forms(id) ON DELETE CASCADE,
  name text,
  email text,
  phone text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  custom_data jsonb DEFAULT '{}',
  ip_address text,
  user_agent text,
  status text DEFAULT 'pending',
  processed_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.capture_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capture_form_submissions ENABLE ROW LEVEL SECURITY;

-- Forms: owner CRUD
CREATE POLICY "Users can manage own forms" ON public.capture_forms
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Submissions: owner can read
CREATE POLICY "Users can read own form submissions" ON public.capture_form_submissions
  FOR SELECT TO authenticated
  USING (form_id IN (SELECT id FROM public.capture_forms WHERE user_id = auth.uid()));

-- Submissions: anyone can insert (webhook)
CREATE POLICY "Anyone can submit forms" ON public.capture_form_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Trigger to update updated_at
CREATE TRIGGER update_capture_forms_updated_at
  BEFORE UPDATE ON public.capture_forms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger to increment submission count
CREATE OR REPLACE FUNCTION public.increment_form_submissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.capture_forms SET submission_count = submission_count + 1 WHERE id = NEW.form_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_increment_form_submissions
  AFTER INSERT ON public.capture_form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.increment_form_submissions();
