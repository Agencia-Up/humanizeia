// Helper único de telefone (BR). Regra de ouro: NUNCA casar/localizar/vincular
// pessoa pelos últimos 8 dígitos — dois números com final igual e DDD diferente
// são pessoas diferentes. Sempre usar o número nacional COMPLETO (DDD + número),
// canonizado com DDI 55, como chave de comparação.

export function onlyDigits(s?: string | null): string {
  return String(s || '').replace(/\D/g, '');
}

// Canoniza para 55 + DDD + número (só dígitos). Remove o DDI 55 duplicado quando
// já vem no valor (nacional tem 10 dígitos p/ fixo ou 11 p/ celular; com DDI 12/13).
// Retorna '' quando não há dígitos. Serve como chave de agrupamento/comparação —
// dois valores só colidem se o número nacional inteiro for igual.
export function normalizePhoneBR(raw?: string | null): string {
  const d = onlyDigits(raw);
  if (!d) return '';
  const nat = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
  return nat ? '55' + nat : '';
}
