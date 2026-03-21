-- Add WhatsApp daily report fields to apollo_cron_config
ALTER TABLE public.apollo_cron_config
  ADD COLUMN IF NOT EXISTS send_daily_report boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_report_number text DEFAULT null;
