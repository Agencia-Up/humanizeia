// ============================================================================
// phoneKey.ts — Deduplicação de vendedores por telefone
// ----------------------------------------------------------------------------
// Helper compartilhado entre edge functions e frontend (lógica idêntica).
//
// Contexto: um vendedor pode ter MÚLTIPLOS rows em ai_team_members (um por
// agent_id que ele cobre). Sem dedupe, o mesmo vendedor aparece N vezes na
// fila de rodízio → backend só atualiza last_lead_received_at em 1 row → as
// outras N-1 rows ficam com timestamp antigo permanente e dominam a fila.
//
// A função normaliza o whatsapp_number pra comparação: tira o código do país
// (55) quando aplicável, garantindo que "+5511987654321" e "11987654321" e
// "5511987654321" todos virem a mesma chave.
//
// Originalmente em uazapi-webhook/index.ts:660-678. Centralizado aqui pra
// que manual-transfer, bulk-transfer-leads, transfer-timeout-checker,
// CrmAoVivo (UI) e outros usem a MESMA lógica e não divirjam.
// ============================================================================

export interface SellerLike {
  id?: string;
  whatsapp_number?: string | null;
}

/**
 * Retorna a "chave de telefone" normalizada do vendedor.
 * - Strip de caracteres não-numéricos.
 * - Remove código do país 55 quando aplicável (números BR com 12 ou 13 dígitos).
 * - Retorna string vazia se whatsapp_number estiver null/undefined/vazio.
 */
export function sellerPhoneKey(seller: SellerLike | null | undefined): string {
  const digits = String(seller?.whatsapp_number || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;
}

/**
 * Deduplica lista de vendedores pelo telefone. Mantém a PRIMEIRA ocorrência
 * de cada telefone (importante: ordem da lista de entrada determina qual row
 * é preservada — geralmente a com last_lead_received_at mais antigo).
 *
 * Vendedor sem whatsapp_number é deduplicado pelo seu id (não some).
 */
export function uniqueSellersByPhone<T extends SellerLike>(sellers: T[] = []): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const seller of sellers || []) {
    const key = sellerPhoneKey(seller) || String(seller?.id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(seller);
  }
  return result;
}
