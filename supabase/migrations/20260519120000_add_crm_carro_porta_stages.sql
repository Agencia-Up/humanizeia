-- Add the new manual CRM stages to existing Marcos pipelines.
-- Pedro uses a fixed frontend status list; Marcos stores columns in crm_pipeline_stages.

WITH stage_owners AS (
  SELECT DISTINCT user_id
  FROM public.crm_pipeline_stages
  WHERE user_id IS NOT NULL
  UNION
  SELECT DISTINCT user_id
  FROM public.crm_leads
  WHERE user_id IS NOT NULL
),
desired_stages AS (
  SELECT *
  FROM (VALUES
    ('Carro não disponível'::text, '#f43f5e'::text, 1),
    ('Porta'::text, '#14b8a6'::text, 2)
  ) AS v(name, color, position_offset)
),
base_positions AS (
  SELECT
    o.user_id,
    COALESCE(MAX(s.position), -1) AS max_position
  FROM stage_owners o
  LEFT JOIN public.crm_pipeline_stages s ON s.user_id = o.user_id
  GROUP BY o.user_id
)
INSERT INTO public.crm_pipeline_stages (user_id, name, color, position, is_default)
SELECT
  bp.user_id,
  ds.name,
  ds.color,
  bp.max_position + ds.position_offset,
  false
FROM base_positions bp
CROSS JOIN desired_stages ds
WHERE NOT EXISTS (
  SELECT 1
  FROM public.crm_pipeline_stages existing
  WHERE existing.user_id = bp.user_id
    AND lower(trim(existing.name)) = lower(trim(ds.name))
);
