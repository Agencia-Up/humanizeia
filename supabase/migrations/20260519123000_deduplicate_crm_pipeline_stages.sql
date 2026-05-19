-- Remove duplicated Marcos CRM stages without losing leads.
-- Leads assigned to a duplicate stage are moved to the first matching stage by name.

WITH ranked_stages AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(trim(name))
      ORDER BY position ASC, created_at ASC, id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(trim(name))
      ORDER BY position ASC, created_at ASC, id ASC
    ) AS row_number
  FROM public.crm_pipeline_stages
  WHERE user_id IS NOT NULL
),
duplicate_stages AS (
  SELECT id, keep_id
  FROM ranked_stages
  WHERE row_number > 1
),
updated_leads AS (
  UPDATE public.crm_leads lead
  SET stage_id = duplicate_stages.keep_id
  FROM duplicate_stages
  WHERE lead.stage_id = duplicate_stages.id
  RETURNING lead.id
)
DELETE FROM public.crm_pipeline_stages stage
USING duplicate_stages
WHERE stage.id = duplicate_stages.id;

CREATE UNIQUE INDEX IF NOT EXISTS crm_pipeline_stages_user_id_name_unique
ON public.crm_pipeline_stages (user_id, name);
