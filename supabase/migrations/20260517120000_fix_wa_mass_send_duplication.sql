-- Fix: evita duplicacao no disparo em massa (wa_queue).
--
-- Causas cobertas:
-- 1. Execucoes concorrentes do process-whatsapp-queue pegando o mesmo item.
-- 2. Campanhas iniciadas mais de uma vez antes de a fila/status estabilizar.
-- 3. Filas antigas com duplicidade por telefone dentro da mesma campanha.

-- Limpa duplicidades historicas por campanha + telefone, mantendo o registro mais antigo.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY campaign_id, regexp_replace(coalesce(phone, ''), '\D', '', 'g')
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.wa_queue
  WHERE campaign_id IS NOT NULL
    AND phone IS NOT NULL
    AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') <> ''
)
DELETE FROM public.wa_queue q
USING ranked r
WHERE q.id = r.id
  AND r.rn > 1;

-- Protecao extra: uma campanha nao pode ter duas filas para o mesmo telefone.
CREATE UNIQUE INDEX IF NOT EXISTS ux_wa_queue_campaign_phone_norm
  ON public.wa_queue (
    campaign_id,
    regexp_replace(coalesce(phone, ''), '\D', '', 'g')
  )
  WHERE campaign_id IS NOT NULL
    AND phone IS NOT NULL
    AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') <> '';

-- Reivindica atomicamente itens prontos para envio.
-- O UPDATE ... FOR UPDATE SKIP LOCKED garante que dois workers nao processem
-- o mesmo item, mesmo com cron ou cliques concorrentes.
CREATE OR REPLACE FUNCTION public.claim_wa_queue_items(
  p_limit INTEGER DEFAULT 1,
  p_stale_after INTERVAL DEFAULT INTERVAL '10 minutes'
)
RETURNS SETOF public.wa_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Recupera locks presos por timeout/crash. O processador usa scheduled_for
  -- como timestamp do lock quando o item entra em processing.
  UPDATE public.wa_queue
  SET status = 'pending',
      scheduled_for = now()
  WHERE status = 'processing'
    AND scheduled_for < now() - p_stale_after;

  RETURN QUERY
  WITH claimed AS (
    UPDATE public.wa_queue q
    SET status = 'processing',
        scheduled_for = now()
    WHERE q.id IN (
      SELECT inner_q.id
      FROM public.wa_queue inner_q
      LEFT JOIN public.wa_campaigns c ON c.id = inner_q.campaign_id
      WHERE inner_q.status = 'pending'
        AND inner_q.scheduled_for <= now()
        AND (
          inner_q.campaign_id IS NULL
          OR c.status NOT IN ('paused', 'cancelled', 'completed')
        )
      ORDER BY inner_q.scheduled_for ASC, inner_q.created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING q.*
  )
  SELECT * FROM claimed;
END;
$$;

COMMENT ON FUNCTION public.claim_wa_queue_items IS
  'Reivindica atomicamente itens da wa_queue para evitar envio duplicado em execucoes concorrentes.';
