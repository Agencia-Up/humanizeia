// ============================================================================
// features.ts — Feature flags centralizadas
// ----------------------------------------------------------------------------
// Controla seções/itens que aparecem ou não no painel sem deletar código.
// Mudar uma flag de `false` pra `true` re-ativa a seção/item automaticamente.
//
// Decisão de produto (27/05/2026):
// Por enquanto só Pedro e Marcos estão liberados. Várias seções do painel
// (ações rápidas, campanhas, atalhos pra agentes não liberados) ficam
// desativadas até esses agentes/ferramentas estarem prontos.
//
// Pra reativar: mude a flag pra `true` neste arquivo, faça commit, deploy.
// Nenhuma outra alteração de código é necessária.
// ============================================================================

export const FEATURES = {
  // ── SEÇÕES INTEIRAS ─────────────────────────────────────────────────────

  /**
   * Seção "Ações rápidas" no AgentHub (`/agentes`).
   * Quando false: a seção inteira não é montada no DOM.
   * Quando true: a seção aparece, e cada item dentro dela ainda é filtrado
   * pelas flags individuais abaixo (googleAdsMetrics, socialMediaContent,
   * businessStrategy).
   */
  quickActions: false,

  /**
   * Seção de campanhas/anúncios no Dashboard:
   *   - "Status geral" (saúde campanhas / anomalies do José)
   *   - "Resultados desta semana" (números do Meta Ads)
   *   - Botão "Receber resumo no WhatsApp"
   * Quando false: nenhuma dessas seções renderiza.
   * Quando true: tudo volta a aparecer (depende de Meta conectado, etc).
   */
  campaignSection: false,

  // ── ITENS INDIVIDUAIS ───────────────────────────────────────────────────
  // Aplicam-se mesmo quando `quickActions: true`. Servem pra filtrar
  // itens específicos dentro de seções ativas.

  /** Banner "Ver resultados das campanhas" (rodapé do AgentHub). */
  campaignResults: false,

  /** Atalho "Resultados dos anúncios no Google Ads" / `/metrics`. */
  googleAdsMetrics: false,

  /** Atalho "Criar conteúdo para redes sociais" / `/davi`. */
  socialMediaContent: false,

  /** Atalho "Montar estratégia de negócio" / `/daniel`. */
  businessStrategy: false,
} as const;

export type FeatureFlag = keyof typeof FEATURES;

/**
 * Helper pra checar flag por nome. Type-safe.
 * Uso: `isFeatureEnabled('quickActions')`
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURES[flag] === true;
}
