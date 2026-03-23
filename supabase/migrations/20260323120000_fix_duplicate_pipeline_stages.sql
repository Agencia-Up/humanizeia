-- Migration: add unique constraint on pipeline stages to prevent duplicate creation
-- This prevents race-condition duplicates from the seeding logic

ALTER TABLE crm_pipeline_stages
  DROP CONSTRAINT IF EXISTS crm_pipeline_stages_user_id_name_key;

ALTER TABLE crm_pipeline_stages
  ADD CONSTRAINT crm_pipeline_stages_user_id_name_key UNIQUE (user_id, name);

-- Clean up existing duplicates: keep the one with the lowest position for each name
DELETE FROM crm_pipeline_stages
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, lower(trim(name))
        ORDER BY position ASC, created_at ASC
      ) AS rn
    FROM crm_pipeline_stages
  ) ranked
  WHERE rn > 1
);
