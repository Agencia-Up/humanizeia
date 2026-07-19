// Testa a logica PURA de status por evento CAPI (tela de saude / Custom Conversions).
import { describe, it, expect } from 'vitest';
import {
  CAPI_QUALITY_EVENTS,
  classifyCapiEventStatus,
  CAPI_EVENT_STATUS_LABEL,
  customConversionInstruction,
} from '../lib/capiEventStatus';

describe('capiEventStatus (logica pura da tela de saude CAPI)', () => {
  it('lista fixa dos 4 eventos de qualidade', () => {
    expect(CAPI_QUALITY_EVENTS).toEqual([
      'LeadQualificado', 'LeadPoucoQualificado', 'LeadRuim', 'Purchase',
    ]);
  });

  it('sem registros -> sem_evento', () => {
    expect(classifyCapiEventStatus(undefined)).toBe('sem_evento');
    expect(classifyCapiEventStatus(null)).toBe('sem_evento');
    expect(classifyCapiEventStatus({})).toBe('sem_evento');
    expect(classifyCapiEventStatus({ pending: 0, sent: 0, failed: 0 })).toBe('sem_evento');
  });

  it('qualquer envio com sucesso -> enviado (falha posterior nao rebaixa)', () => {
    expect(classifyCapiEventStatus({ sent: 1 })).toBe('enviado');
    expect(classifyCapiEventStatus({ pending: 2, sent: 10, failed: 3 })).toBe('enviado');
  });

  it('so falhas (nunca chegou na Meta) -> falhando', () => {
    expect(classifyCapiEventStatus({ failed: 1 })).toBe('falhando');
    expect(classifyCapiEventStatus({ pending: 2, failed: 5 })).toBe('falhando');
  });

  it('so pendentes -> pendente', () => {
    expect(classifyCapiEventStatus({ pending: 3 })).toBe('pendente');
  });

  it('entradas invalidas viram zero (fallback seguro)', () => {
    expect(classifyCapiEventStatus({ pending: -1 as any, sent: NaN as any, failed: 'x' as any })).toBe('sem_evento');
  });

  it('labels e instrucao curta', () => {
    expect(CAPI_EVENT_STATUS_LABEL.sem_evento).toBe('Sem evento');
    expect(CAPI_EVENT_STATUS_LABEL.falhando).toBe('Falhando');
    expect(customConversionInstruction('LeadQualificado'))
      .toBe('Crie uma conversão personalizada na Meta usando o evento LeadQualificado');
  });
});
