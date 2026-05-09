-- Cria job pg_cron para disparar follow-ups agendados automaticamente
-- Roda a cada 1 minuto — verifica pedro_followup_schedules com status='pending'
-- e scheduled_at <= now(), enviando as mensagens via UazAPI
SELECT cron.schedule(
  'pedro-trigger-followup',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-trigger-followup',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNleWxqc3FtaGxvcGtjYXVobG9yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMDEyNywiZXhwIjoyMDg5NTA2MTI3fQ.b5oaiDazO1ncJYdwlHJo-tnOx88UBjeIwCf175eBrJM"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
