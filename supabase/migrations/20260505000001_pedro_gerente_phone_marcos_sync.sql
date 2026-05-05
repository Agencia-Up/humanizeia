-- Add gerente_phone to wa_ai_agents for manager WhatsApp report notifications
ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS gerente_phone text;

-- Ensure wa_contacts has upsert support on (user_id, list_id, phone)
-- (add unique constraint if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wa_contacts_user_list_phone_key'
  ) THEN
    ALTER TABLE public.wa_contacts
      ADD CONSTRAINT wa_contacts_user_list_phone_key UNIQUE (user_id, list_id, phone);
  END IF;
END$$;
