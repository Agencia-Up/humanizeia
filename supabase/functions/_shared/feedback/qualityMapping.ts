// ============================================================================
// qualityMapping — helpers PUROS de mapeamento de qualidade de lead.
//
// Cadeia padrao (AUTOMOTIVO, identica ao comportamento atual em producao):
//   feedback_conversas.qualidade_lead  ->  universal  ->  ai_crm_leads.qualidade_lead  ->  evento CAPI
//   1_alto                             ->  high       ->  bom                          ->  LeadQualificado
//   2_medio                            ->  medium     ->  medio                        ->  LeadPoucoQualificado
//   3_baixo                            ->  low        ->  ruim                         ->  LeadRuim
//   4_nao_lead                         ->  not_lead   ->  ruim                         ->  LeadRuim
//
// Estas funcoes NAO estao plugadas em nenhum fluxo de producao nesta fase —
// sao a base testavel para o multi-nicho futuro (niche_profiles.quality_mapping
// e event_mapping poderao sobrescrever a cadeia por nicho). O enfileiramento
// real dos eventos CAPI continua na funcao SQL de 20260711190000_capi_lead_quality
// (trigger por ai_crm_leads.qualidade_lead), sem mudanca.
//
// NOTA (Custom Conversions): LeadQualificado / LeadPoucoQualificado / LeadRuim
// sao EVENTOS CUSTOMIZADOS enviados ao Pixel via Conversions API. Enviar o
// evento NAO cria automaticamente uma Custom Conversion no Business Manager —
// o gestor precisa cria-la manualmente hoje. Criacao automatica via Graph API
// (/customconversions) fica para fase futura, fora desta entrega.
// ============================================================================

export type UniversalQuality = 'high' | 'medium' | 'low' | 'not_lead' | 'unknown';
export type CrmQuality = 'bom' | 'medio' | 'ruim';
export type MetaQualityEvent = 'LeadQualificado' | 'LeadPoucoQualificado' | 'LeadRuim';

const FEEDBACK_TO_UNIVERSAL: Record<string, UniversalQuality> = {
  '1_alto': 'high',
  '2_medio': 'medium',
  '3_baixo': 'low',
  '4_nao_lead': 'not_lead',
};

const UNIVERSAL_TO_CRM: Record<UniversalQuality, CrmQuality | null> = {
  high: 'bom',
  medium: 'medio',
  low: 'ruim',
  not_lead: 'ruim',
  unknown: null,
};

const CRM_TO_META_EVENT: Record<CrmQuality, MetaQualityEvent> = {
  bom: 'LeadQualificado',
  medio: 'LeadPoucoQualificado',
  ruim: 'LeadRuim',
};

/** Evento CAPI de venda (inalterado; aqui apenas como constante documentada). */
export const PURCHASE_EVENT = 'Purchase' as const;

/** `feedback_conversas.qualidade_lead` -> qualidade universal. Desconhecido/vazio -> 'unknown'. */
export function feedbackQualityToUniversal(value: string | null | undefined): UniversalQuality {
  if (typeof value !== 'string') return 'unknown';
  return FEEDBACK_TO_UNIVERSAL[value.trim()] ?? 'unknown';
}

/** Qualidade universal -> `ai_crm_leads.qualidade_lead`. 'unknown'/invalido -> null (nao carimba). */
export function universalQualityToCrm(value: string | null | undefined): CrmQuality | null {
  if (typeof value !== 'string') return null;
  const v = value.trim() as UniversalQuality;
  return (v in UNIVERSAL_TO_CRM) ? UNIVERSAL_TO_CRM[v] : null;
}

/** `ai_crm_leads.qualidade_lead` -> nome do evento CAPI. Invalido/vazio -> null (nao envia). */
export function crmQualityToMetaEvent(value: string | null | undefined): MetaQualityEvent | null {
  if (typeof value !== 'string') return null;
  const v = value.trim() as CrmQuality;
  return (v in CRM_TO_META_EVENT) ? CRM_TO_META_EVENT[v] : null;
}
