-- Corrige leads do Pedro que ficaram inconsistentes:
-- ai_lead_transfers confirmado, mas ai_crm_leads.assigned_to_id ainda NULL.
-- Isso fazia o mesmo contato voltar como sem vendedor/novo e permitia reenvio.

WITH latest_confirmed AS (
  SELECT DISTINCT ON (lead_id)
    lead_id,
    to_member_id,
    COALESCE(confirmed_at, created_at) AS fixed_at
  FROM public.ai_lead_transfers
  WHERE transfer_status = 'confirmed'
    AND is_confirmed = true
    AND lead_id IS NOT NULL
    AND to_member_id IS NOT NULL
  ORDER BY lead_id, COALESCE(confirmed_at, created_at) DESC, created_at DESC
)
UPDATE public.ai_crm_leads l
SET
  assigned_to_id = c.to_member_id,
  status = 'em_atendimento',
  origem = COALESCE(l.origem, 'trafico_pago'),
  last_interaction_at = GREATEST(
    COALESCE(l.last_interaction_at, 'epoch'::timestamptz),
    COALESCE(c.fixed_at, now())
  )
FROM latest_confirmed c
WHERE l.id = c.lead_id
  AND l.assigned_to_id IS NULL
  AND l.status = 'transferido';
