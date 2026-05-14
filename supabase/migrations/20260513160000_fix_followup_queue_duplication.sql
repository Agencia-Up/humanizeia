-- Fix: mensagens de follow-up sendo enviadas duplicadas (2 mensagens ao mesmo tempo)
-- Causa: a edge function process-followup-queue faz SELECT scheduled e depois
-- UPDATE para 'sent', sem lock entre as duas operacoes. Se duas execucoes rodam
-- concorrentes, ambas selecionam os mesmos items e enviam 2x.

-- Solucao: funcao atomica que reivindica (UPDATE..RETURNING + SKIP LOCKED) os
-- items antes de processar. Garante que cada item seja pego por SOMENTE UM worker.

CREATE OR REPLACE FUNCTION public.claim_followup_messages(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  phone TEXT,
  message_content TEXT,
  instance_id UUID,
  scheduled_for TIMESTAMPTZ,
  attempt_count INTEGER,
  api_url TEXT,
  api_key_encrypted TEXT,
  instance_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Recupera items presos em 'processing' por mais de 5 minutos (crash recovery)
  UPDATE public.followup_queue
  SET status = 'scheduled', updated_at = now()
  WHERE status = 'processing'
    AND updated_at < now() - INTERVAL '5 minutes';

  -- 2. Reivindica atomicamente os proximos items para processar
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.followup_queue q
    SET status = 'processing', updated_at = now()
    WHERE q.id IN (
      SELECT inner_q.id
      FROM public.followup_queue inner_q
      WHERE inner_q.status = 'scheduled'
        AND inner_q.channel = 'whatsapp'
        AND inner_q.scheduled_for <= now()
        AND inner_q.phone IS NOT NULL
        AND inner_q.instance_id IS NOT NULL
      ORDER BY inner_q.scheduled_for ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING q.*
  )
  SELECT
    c.id, c.user_id, c.phone, c.message_content, c.instance_id,
    c.scheduled_for, c.attempt_count,
    i.api_url, i.api_key_encrypted, i.instance_name
  FROM claimed c
  LEFT JOIN public.wa_instances i ON i.id = c.instance_id;
END;
$$;

COMMENT ON FUNCTION public.claim_followup_messages IS
  'Reivindica atomicamente ate N items da followup_queue para processamento, marcando como status=processing. Evita duplicacao em execucoes concorrentes via FOR UPDATE SKIP LOCKED. Recupera items presos > 5min em processing.';
