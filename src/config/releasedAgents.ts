// ============================================================================
// releasedAgents.ts — Lista centralizada de agentes liberados pra produção
// ----------------------------------------------------------------------------
// Decisão de produto (27/05/2026):
// Por enquanto, SOMENTE Pedro e Marcos estão liberados pra TODAS as contas
// (novas e existentes), independente do plano. Os demais ficam visíveis no
// painel com badge "Em breve" e bloqueados (não clicáveis, opacidade
// reduzida, cursor not-allowed).
//
// Pra liberar um novo agente futuramente:
// 1. Adicionar o slug aqui no array RELEASED_AGENTS.
// 2. Garantir que a página dele esteja pronta em src/pages/.
// 3. Garantir que a rota esteja registrada em src/App.tsx.
//
// Use o helper isAgentReleased(name) — case-insensitive, aceita variações
// (ex: "Pedro SDR" → true, "Marcos" → true, "José" → false).
// ============================================================================

/** Slugs (lowercase) dos agentes liberados pra produção. */
export const RELEASED_AGENTS: ReadonlyArray<string> = ['pedro', 'marcos'];

/**
 * Verifica se um agente está liberado pra uso. Case-insensitive, aceita
 * variações comuns ("Pedro SDR" → true, "Marcos" → true, "José" → false,
 * "Pedro" → true). Match por PREFIXO do primeiro token do nome.
 */
export function isAgentReleased(name: string | null | undefined): boolean {
  if (!name) return false;
  const firstToken = String(name).trim().toLowerCase().split(/\s+/)[0];
  return RELEASED_AGENTS.includes(firstToken);
}

/** Label do badge mostrado em agentes não liberados. */
export const COMING_SOON_LABEL = 'Em breve';
