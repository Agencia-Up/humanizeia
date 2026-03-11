
-- Make phone_number nullable with default empty string
ALTER TABLE public.whatsapp_config ALTER COLUMN phone_number SET DEFAULT '';
ALTER TABLE public.whatsapp_config ALTER COLUMN phone_number DROP NOT NULL;
