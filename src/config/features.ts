// ============================================================================
// features.ts — Feature flags centralizadas
// ----------------------------------------------------------------------------
// Controla seções/itens que aparecem ou não no painel sem deletar código.
// Mudar uma flag de `false` pra `true` re-ativa a seção/item automaticamente.
//
// Decisão de produto (27/05/2026):
// Por enquanto só Pedro e Marcos estão liberados. Várias seções do painel
// (campanhas/anúncios, atalhos pra agentes não liberados) ficam desativadas
// até esses agentes/ferramentas estarem prontos.
//
// Pra reativar: mude a flag pra `true` neste arquivo, faça commit, deploy.
// Nenhuma outra alteração de código é necessária.
// ============================================================================

export const FEATURES = {
  // ── SEÇÕES INTEIRAS ─────────────────────────────────────────────────────

  /**
   * Seção de campanhas/anúncios no Dashboard:
   *   - "Status geral" (saúde campanhas / anomalies do José)
   *   - "Resultados desta semana" (números do Meta Ads)
   *   - Botão "Receber resumo no WhatsApp"
   * Quando false: nenhuma dessas seções renderiza.
   * Quando true: tudo volta a aparecer (depende de Meta conectado, etc).
   */
  campaignSection: false,

  // ── ITENS INDIVIDUAIS DENTRO DE "AÇÕES RÁPIDAS" (AgentHub) ──────────────
  // A seção "Ações rápidas" do AgentHub (/agentes) NÃO tem flag externa pra
  // ocultar a seção inteira porque tem 3 atalhos PERMANENTES que sempre
  // devem aparecer (decisão de produto 27/05/2026):
  //   - /copywriter (Criar texto/anúncio)
  //   - /whatsapp/broadcast (Disparo em massa no WhatsApp)
  //   - /marcos (Ver leads e pipeline de vendas)
  // As 3 flags abaixo filtram individualmente os 3 atalhos não liberados
  // (Google Ads / Davi / Daniel) que ficam dentro do mesmo array.

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
 * Uso: `isFeatureEnabled('campaignSection')`
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURES[flag] === true;
}
