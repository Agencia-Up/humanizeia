-- Supabase Realtime column filters (e.g. user_id=eq.X) require
-- REPLICA IDENTITY FULL on the table. Without it the server-side
-- filter cannot inspect non-PK columns and the channel receives
-- no events, breaking the live CRM alert bell.

ALTER TABLE public.ai_crm_leads      REPLICA IDENTITY FULL;
ALTER TABLE public.ai_lead_transfers REPLICA IDENTITY FULL;

-- Ensure both tables are in the realtime publication
-- (IF NOT EXISTS is not supported for ALTER PUBLICATION, so we use
--  DO blocks to guard against duplicate additions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'ai_crm_leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_crm_leads;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'ai_lead_transfers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_lead_transfers;
  END IF;
END $$;
