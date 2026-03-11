ALTER TABLE public.automation_rules
  ALTER COLUMN apply_to_campaigns TYPE text[]
  USING apply_to_campaigns::text[];