-- ─────────────────────────────────────────────────────────────────────────────
-- Formulários de Captura + Sequências de Follow-up
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. capture_forms ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.capture_forms (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  title            text NOT NULL,
  description      text,
  primary_color    text NOT NULL DEFAULT '#6366f1',
  logo_url         text,
  cover_url        text,
  fields           jsonb NOT NULL DEFAULT '[]',
  success_message  text NOT NULL DEFAULT 'Obrigado! Entraremos em contato em breve.',
  redirect_url     text,
  instance_id      uuid REFERENCES public.wa_instances(id) ON DELETE SET NULL,
  is_active        boolean NOT NULL DEFAULT true,
  submission_count integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Adiciona colunas que podem estar faltando em instâncias existentes
ALTER TABLE public.capture_forms ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE public.capture_forms ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.capture_forms ADD COLUMN IF NOT EXISTS submission_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.capture_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own forms" ON public.capture_forms;
CREATE POLICY "Users manage own forms" ON public.capture_forms
  USING (auth.uid() = user_id);

-- trigger updated_at
DROP TRIGGER IF EXISTS trg_capture_forms_updated_at ON public.capture_forms;
CREATE TRIGGER trg_capture_forms_updated_at
  BEFORE UPDATE ON public.capture_forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. capture_form_submissions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.capture_form_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id      uuid NOT NULL REFERENCES public.capture_forms(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text,
  email        text,
  phone        text,
  custom_data  jsonb NOT NULL DEFAULT '{}',
  utm_source   text,
  utm_campaign text,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.capture_form_submissions ENABLE ROW LEVEL SECURITY;

-- proprietário do formulário pode ver as submissões
DROP POLICY IF EXISTS "Form owners can see submissions" ON public.capture_form_submissions;
CREATE POLICY "Form owners can see submissions" ON public.capture_form_submissions
  USING (auth.uid() = user_id);

-- qualquer um pode inserir submissão em formulário ativo
DROP POLICY IF EXISTS "Anyone can submit active forms" ON public.capture_form_submissions;
CREATE POLICY "Anyone can submit active forms" ON public.capture_form_submissions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.capture_forms cf
      WHERE cf.id = form_id AND cf.is_active = true
    )
  );

-- 3. followup_sequences ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.followup_sequences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  form_id     uuid NOT NULL REFERENCES public.capture_forms(id) ON DELETE CASCADE,
  name        text NOT NULL,
  instance_id uuid REFERENCES public.wa_instances(id) ON DELETE SET NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id)
);

ALTER TABLE public.followup_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own sequences" ON public.followup_sequences;
CREATE POLICY "Users manage own sequences" ON public.followup_sequences
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_followup_sequences_updated_at ON public.followup_sequences;
CREATE TRIGGER trg_followup_sequences_updated_at
  BEFORE UPDATE ON public.followup_sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. followup_sequence_steps ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.followup_sequence_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id  uuid NOT NULL REFERENCES public.followup_sequences(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_order   integer NOT NULL DEFAULT 1,
  delay_hours  integer NOT NULL DEFAULT 0,
  message_text text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.followup_sequence_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own steps" ON public.followup_sequence_steps;
CREATE POLICY "Users manage own steps" ON public.followup_sequence_steps
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_followup_steps_updated_at ON public.followup_sequence_steps;
CREATE TRIGGER trg_followup_steps_updated_at
  BEFORE UPDATE ON public.followup_sequence_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. followup_queue — garante colunas extras ──────────────────────────────────
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS submission_id uuid REFERENCES public.capture_form_submissions(id) ON DELETE SET NULL;
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS step_id      uuid REFERENCES public.followup_sequence_steps(id) ON DELETE SET NULL;
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS last_error   text;
ALTER TABLE public.followup_queue ADD COLUMN IF NOT EXISTS sent_at      timestamptz;

-- 6. Função RPC: incrementar contador de submissões ───────────────────────────
CREATE OR REPLACE FUNCTION public.increment_form_submissions(form_id_param uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.capture_forms
  SET submission_count = submission_count + 1
  WHERE id = form_id_param;
$$;
