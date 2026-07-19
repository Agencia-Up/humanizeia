// Testa os helpers PUROS de mapeamento de qualidade (base multi-nicho).
// A cadeia precisa ser IDENTICA ao comportamento automotivo em producao:
//   1_alto -> high -> bom -> LeadQualificado
//   2_medio -> medium -> medio -> LeadPoucoQualificado
//   3_baixo -> low -> ruim -> LeadRuim
//   4_nao_lead -> not_lead -> ruim -> LeadRuim
import { describe, it, expect } from 'vitest';
import {
  feedbackQualityToUniversal,
  universalQualityToCrm,
  crmQualityToMetaEvent,
  PURCHASE_EVENT,
} from '../../supabase/functions/_shared/feedback/qualityMapping';

describe('qualityMapping (cadeia automotiva padrao)', () => {
  it('feedback -> universal', () => {
    expect(feedbackQualityToUniversal('1_alto')).toBe('high');
    expect(feedbackQualityToUniversal('2_medio')).toBe('medium');
    expect(feedbackQualityToUniversal('3_baixo')).toBe('low');
    expect(feedbackQualityToUniversal('4_nao_lead')).toBe('not_lead');
  });

  it('universal -> CRM', () => {
    expect(universalQualityToCrm('high')).toBe('bom');
    expect(universalQualityToCrm('medium')).toBe('medio');
    expect(universalQualityToCrm('low')).toBe('ruim');
    expect(universalQualityToCrm('not_lead')).toBe('ruim');
    expect(universalQualityToCrm('unknown')).toBeNull();
  });

  it('CRM -> evento CAPI (nomes atuais preservados)', () => {
    expect(crmQualityToMetaEvent('bom')).toBe('LeadQualificado');
    expect(crmQualityToMetaEvent('medio')).toBe('LeadPoucoQualificado');
    expect(crmQualityToMetaEvent('ruim')).toBe('LeadRuim');
    expect(PURCHASE_EVENT).toBe('Purchase');
  });

  it('cadeia completa fim-a-fim', () => {
    const cadeia = (fb: string) => crmQualityToMetaEvent(universalQualityToCrm(feedbackQualityToUniversal(fb)));
    expect(cadeia('1_alto')).toBe('LeadQualificado');
    expect(cadeia('2_medio')).toBe('LeadPoucoQualificado');
    expect(cadeia('3_baixo')).toBe('LeadRuim');
    expect(cadeia('4_nao_lead')).toBe('LeadRuim');
  });

  it('entradas invalidas -> fallback seguro (nunca inventa qualidade/evento)', () => {
    expect(feedbackQualityToUniversal(null)).toBe('unknown');
    expect(feedbackQualityToUniversal(undefined)).toBe('unknown');
    expect(feedbackQualityToUniversal('  ')).toBe('unknown');
    expect(feedbackQualityToUniversal('qualquer')).toBe('unknown');
    expect(universalQualityToCrm(null)).toBeNull();
    expect(universalQualityToCrm('xpto')).toBeNull();
    expect(crmQualityToMetaEvent(null)).toBeNull();
    expect(crmQualityToMetaEvent('otimo')).toBeNull();
    // com espacos (normalizacao)
    expect(feedbackQualityToUniversal(' 1_alto ')).toBe('high');
    expect(crmQualityToMetaEvent(' bom ')).toBe('LeadQualificado');
  });
});
