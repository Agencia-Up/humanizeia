// Helpers PUROS da tela de saude CAPI / Custom Conversions (sem IO, sem Supabase).
// Classificam o status exibido por evento a partir das contagens retornadas por
// capi_quality_status().por_evento — NAO alteram nada no envio CAPI.
//
// IMPORTANTE (Custom Conversions): LeadQualificado/LeadPoucoQualificado/LeadRuim/
// Purchase sao eventos CUSTOMIZADOS enviados ao Pixel via CAPI. Receber o evento
// NAO cria a Custom Conversion no Business Manager — o gestor cria manualmente
// (fluxo assistido/checklist). Nada aqui chama a Graph API.

export const CAPI_QUALITY_EVENTS = [
  'LeadQualificado',
  'LeadPoucoQualificado',
  'LeadRuim',
  'Purchase',
] as const;

export type CapiQualityEvent = typeof CAPI_QUALITY_EVENTS[number];

export type CapiEventCounts = { pending?: number; sent?: number; failed?: number } | null | undefined;

export type CapiEventStatus = 'sem_evento' | 'pendente' | 'enviado' | 'falhando';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Classifica o status do evento pelas contagens (heuristica determinística):
 *   - sem_evento: nunca houve registro do evento (tudo zero/ausente)
 *   - enviado:    ja houve pelo menos 1 envio com sucesso (falhas/pendencias
 *                 posteriores aparecem como detalhe, nao mudam o status base)
 *   - falhando:   houve tentativa(s) e NENHUMA chegou na Meta
 *   - pendente:   so ha registros aguardando envio
 */
export function classifyCapiEventStatus(counts: CapiEventCounts): CapiEventStatus {
  const pending = num(counts?.pending);
  const sent = num(counts?.sent);
  const failed = num(counts?.failed);
  if (pending + sent + failed === 0) return 'sem_evento';
  if (sent > 0) return 'enviado';
  if (failed > 0) return 'falhando';
  return 'pendente';
}

export const CAPI_EVENT_STATUS_LABEL: Record<CapiEventStatus, string> = {
  sem_evento: 'Sem evento',
  pendente: 'Pendente',
  enviado: 'Enviado',
  falhando: 'Falhando',
};

/** Instrucao curta do fluxo assistido (criacao MANUAL na Meta). */
export function customConversionInstruction(eventName: string): string {
  return `Crie uma conversão personalizada na Meta usando o evento ${String(eventName || '').trim()}`;
}
