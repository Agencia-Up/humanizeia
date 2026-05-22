-- =============================================================================
-- Item 2: data agendada da visita como timestamptz + alerta "VISITA HOJE"
-- =============================================================================
-- Existem hoje colunas TEXT visit_scheduled (texto livre) em ai_crm_leads (Pedro)
-- e crm_leads (Marcos). Frontend salvava ali strings como "22/05/2026 14h".
-- Pra ativar banner "VISITA HOJE" precisa comparar com data real → adiciona
-- coluna timestamptz paralela. Texto antigo permanece (compat + leitura humana).

-- 1. Adiciona coluna timestamptz (idempotente)
ALTER TABLE public.ai_crm_leads
  ADD COLUMN IF NOT EXISTS visit_scheduled_at timestamptz NULL;

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS visit_scheduled_at timestamptz NULL;

-- 2. Backfill: tenta parsear texto existente como timestamp.
--    Aceita formatos ISO (2026-05-22 14:00) E pt-BR (22/05/2026 14:00).
--    Strings não-parseáveis (ex: "amanhã às 14h") ficam NULL — frontend
--    continua mostrando o texto bruto na badge emerald, sem banner laranja.
DO $$
DECLARE v_pedro int := 0;
DECLARE v_marcos int := 0;
BEGIN
  -- Pedro: ai_crm_leads
  UPDATE public.ai_crm_leads
  SET visit_scheduled_at = (
    CASE
      -- Formato ISO YYYY-MM-DD HH:MM (com ou sem espaço/T) — tenta direto
      WHEN visit_scheduled ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}' THEN
        to_timestamp(substring(visit_scheduled FROM '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}'), 'YYYY-MM-DD HH24:MI')
      WHEN visit_scheduled ~ '^\d{4}-\d{2}-\d{2}' THEN
        to_timestamp(substring(visit_scheduled FROM '^\d{4}-\d{2}-\d{2}'), 'YYYY-MM-DD')
      -- Formato pt-BR DD/MM/YYYY com hora opcional
      WHEN visit_scheduled ~ '^\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}[:h]\d{2}' THEN
        to_timestamp(regexp_replace(substring(visit_scheduled FROM '^\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}[:h]\d{2}'), 'h', ':', 'g'), 'DD/MM/YYYY HH24:MI')
      WHEN visit_scheduled ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
        to_timestamp(substring(visit_scheduled FROM '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY')
      ELSE NULL
    END
  )
  WHERE visit_scheduled IS NOT NULL
    AND visit_scheduled_at IS NULL;
  GET DIAGNOSTICS v_pedro = ROW_COUNT;

  -- Marcos: crm_leads (mesma lógica)
  UPDATE public.crm_leads
  SET visit_scheduled_at = (
    CASE
      WHEN visit_scheduled ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}' THEN
        to_timestamp(substring(visit_scheduled FROM '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}'), 'YYYY-MM-DD HH24:MI')
      WHEN visit_scheduled ~ '^\d{4}-\d{2}-\d{2}' THEN
        to_timestamp(substring(visit_scheduled FROM '^\d{4}-\d{2}-\d{2}'), 'YYYY-MM-DD')
      WHEN visit_scheduled ~ '^\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}[:h]\d{2}' THEN
        to_timestamp(regexp_replace(substring(visit_scheduled FROM '^\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}[:h]\d{2}'), 'h', ':', 'g'), 'DD/MM/YYYY HH24:MI')
      WHEN visit_scheduled ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
        to_timestamp(substring(visit_scheduled FROM '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY')
      ELSE NULL
    END
  )
  WHERE visit_scheduled IS NOT NULL
    AND visit_scheduled_at IS NULL;
  GET DIAGNOSTICS v_marcos = ROW_COUNT;

  RAISE NOTICE '[Item2] Pedro backfilled: %, Marcos backfilled: %', v_pedro, v_marcos;
END $$;

-- 3. Index pra queries de "visitas hoje" (filtra por data)
CREATE INDEX IF NOT EXISTS idx_ai_crm_leads_visit_today
  ON public.ai_crm_leads (visit_scheduled_at)
  WHERE visit_scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_leads_visit_today
  ON public.crm_leads (visit_scheduled_at)
  WHERE visit_scheduled_at IS NOT NULL;
