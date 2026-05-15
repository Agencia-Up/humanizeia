-- ============================================================================
-- Migra status_crm legacy para os 3 níveis SDR + 'inativo' (novo)
-- ============================================================================
-- Antes: 10 valores diferentes (novo, pouco_qualificado, medio_qualificado,
--        qualificado, em_atendimento, negociacao, fechado, perdido,
--        interessado, encerrado).
-- Agora: novo + 3 níveis SDR (inativo, pouco_qualificado, qualificado) +
--        estágios manuais (em_atendimento, negociacao, fechado, perdido).
--
-- Mapeamentos:
--   'medio_qualificado' → 'pouco_qualificado'  (médio era ambíguo, simplifica)
--   'encerrado' → 'perdido'                     (mesma semântica, padroniza)
--   'interessado' → 'novo'                      (legacy, era inicial)
--
-- Idempotente: WHERE filtra apenas status afetados.
-- ============================================================================

UPDATE public.ai_crm_leads
SET status_crm = 'pouco_qualificado'
WHERE status_crm = 'medio_qualificado';

UPDATE public.ai_crm_leads
SET status_crm = 'perdido'
WHERE status_crm = 'encerrado';

UPDATE public.ai_crm_leads
SET status_crm = 'novo'
WHERE status_crm = 'interessado';
