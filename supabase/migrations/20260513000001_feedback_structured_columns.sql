-- Add structured feedback columns to pedro_manager_feedback
-- city: cidade do cliente
-- reason: motivo da não-compra
-- observations: observações adicionais do vendedor

ALTER TABLE public.pedro_manager_feedback
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS observations TEXT;

-- Index for analytics: reason is the most likely filter
CREATE INDEX IF NOT EXISTS pedro_feedback_reason_idx
  ON public.pedro_manager_feedback (reason)
  WHERE reason IS NOT NULL;

CREATE INDEX IF NOT EXISTS pedro_feedback_city_idx
  ON public.pedro_manager_feedback (city)
  WHERE city IS NOT NULL;
