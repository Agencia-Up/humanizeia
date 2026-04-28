-- Set REPLICA IDENTITY FULL on all tables that use filtered Realtime subscriptions.
-- Without this, column filters (user_id=eq.X) are silently ignored by the server
-- and NO events reach the client — breaking real-time inbox, notifications, and CRM.

ALTER TABLE public.wa_inbox          REPLICA IDENTITY FULL;
ALTER TABLE public.wa_contacts       REPLICA IDENTITY FULL;
ALTER TABLE public.wa_contact_lists  REPLICA IDENTITY FULL;
ALTER TABLE public.crm_leads         REPLICA IDENTITY FULL;
ALTER TABLE public.notifications     REPLICA IDENTITY FULL;
