ALTER TABLE public.wa_ai_agents ADD COLUMN IF NOT EXISTS instance_ids uuid[] DEFAULT '{}';

UPDATE public.wa_ai_agents 
SET instance_ids = ARRAY[instance_id] 
WHERE instance_id IS NOT NULL AND (instance_ids IS NULL OR instance_ids = '{}');