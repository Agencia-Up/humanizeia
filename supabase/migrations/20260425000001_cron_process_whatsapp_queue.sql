-- Cria o job pg_cron para processar a fila de disparo em massa (wa_queue)
-- Roda a cada 1 minuto — garante que mensagens enfileiradas pelo enqueue-campaign sejam enviadas
SELECT cron.schedule(
  'process-whatsapp-queue',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/process-whatsapp-queue',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNleWxqc3FtaGxvcGtjYXVobG9yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMDEyNywiZXhwIjoyMDg5NTA2MTI3fQ.b5oaiDazO1ncJYdwlHJo-tnOx88UBjeIwCf175eBrJM"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
