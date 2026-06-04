-- ============================================================================
-- Isolamento do agente de IA por FINALIDADE do número (wa_instances.purpose)
-- ============================================================================
-- Cada número conectado passa a ter uma finalidade explícita:
--   agent       = número vinculado a um agente de IA (a IA só responde nele)
--   bulk_sender = número de disparo em massa (a IA NUNCA responde)
--   manual      = uso manual
--   test        = número de teste
--
-- O webhook do Pedro já isola por instance_ids (só responde se o número que
-- recebeu estiver na lista do agente). Este campo adiciona a finalidade
-- explícita + permite travar bulk_sender/test de virarem agente, e dá uma
-- segunda camada de guarda no webhook.
--
-- Aditivo e idempotente. Não altera nenhum número já corretamente vinculado.
-- ============================================================================

ALTER TABLE public.wa_instances
  ADD COLUMN IF NOT EXISTS purpose text;

ALTER TABLE public.wa_instances
  DROP CONSTRAINT IF EXISTS wa_instances_purpose_check;

ALTER TABLE public.wa_instances
  ADD CONSTRAINT wa_instances_purpose_check
  CHECK (purpose IS NULL OR purpose IN ('agent', 'bulk_sender', 'manual', 'test'));

-- Backfill conservador: número que JÁ está na lista instance_ids de um agente
-- ATIVO é, de fato, número de agente. Os demais ficam NULL (não chutamos
-- bulk_sender pra não rotular errado — a classificação dos novos vem do fluxo).
UPDATE public.wa_instances i
SET purpose = 'agent'
WHERE i.purpose IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.wa_ai_agents a
    WHERE a.is_active = true
      AND a.instance_ids @> ARRAY[i.id]
  );

CREATE INDEX IF NOT EXISTS idx_wa_instances_purpose
  ON public.wa_instances (purpose)
  WHERE purpose IS NOT NULL;
