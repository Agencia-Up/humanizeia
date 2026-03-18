
-- 1. Create crm_pipelines table
CREATE TABLE public.crm_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT '#6366f1',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own pipelines"
  ON public.crm_pipelines FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. Add pipeline_id to crm_pipeline_stages
ALTER TABLE public.crm_pipeline_stages
  ADD COLUMN pipeline_id uuid REFERENCES public.crm_pipelines(id) ON DELETE CASCADE;

-- 3. For each user that has stages, create a default pipeline and link their stages
DO $$
DECLARE
  r RECORD;
  new_pipeline_id uuid;
BEGIN
  FOR r IN (SELECT DISTINCT user_id FROM public.crm_pipeline_stages) LOOP
    INSERT INTO public.crm_pipelines (user_id, name, color, is_default)
    VALUES (r.user_id, 'Pipeline Principal', '#6366f1', true)
    RETURNING id INTO new_pipeline_id;

    UPDATE public.crm_pipeline_stages
    SET pipeline_id = new_pipeline_id
    WHERE user_id = r.user_id AND pipeline_id IS NULL;
  END LOOP;
END $$;

-- 4. Add updated_at trigger
CREATE TRIGGER update_crm_pipelines_updated_at
  BEFORE UPDATE ON public.crm_pipelines
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
