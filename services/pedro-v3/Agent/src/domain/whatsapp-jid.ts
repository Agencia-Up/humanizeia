// ============================================================================
// whatsapp-jid.ts — normalização CANÔNICA do remote_jid do WhatsApp. PURO.
//
// A identidade do lead no CRM (ai_crm_leads) é (agent_id, remote_jid) com
// remote_jid = "<telefone>@s.whatsapp.net". Este helper é a ÚNICA fonte dessa
// forma canônica no v3 — lookup, insert e testes usam a MESMA função; nenhum
// telefone inválido pode virar filtro frouxo no banco (retorno null = fail-closed).
//
// Compatível por construção com a normalização do bridge (pedroV3Bridge.ts
// normalizePhone): 10/11 dígitos nacionais ganham prefixo 55; 12/13 dígitos já
// internacionais são preservados; qualquer outro tamanho é rejeitado.
// ============================================================================

const CANONICAL_SUFFIX = "@s.whatsapp.net";

// Sufixos que NUNCA identificam um lead 1:1 (grupo, broadcast, identidade @lid
// sem telefone resolvido): rejeitados — melhor nenhum CRM do que CRM errado.
const REJECTED_SUFFIX_RX = /@(g\.us|lid|broadcast|newsletter|call)$/i;

function normalizeDigits(raw: string): string | null {
  // Remove formatação humana comum (espaços, +, -, ., parênteses). Qualquer
  // outro caractere restante torna o valor malformado (fail-closed).
  const stripped = raw.replace(/[\s()+\-.]/g, "");
  if (stripped === "" || /\D/.test(stripped)) return null;
  if (stripped.length === 10 || stripped.length === 11) return `55${stripped}`;   // nacional -> +55
  if (stripped.length === 12 || stripped.length === 13) return stripped;          // já internacional
  return null;
}

// Telefone normalizado (do bridge/routing) OU jid já canônico -> jid canônico.
// null = entrada inválida (vazio, grupo, @lid, curto/longo demais, malformado).
export function canonicalWhatsappRemoteJid(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (raw === "") return null;
  if (raw.includes("@")) {
    if (REJECTED_SUFFIX_RX.test(raw)) return null;
    const at = raw.indexOf("@");
    const suffix = raw.slice(at).toLowerCase();
    if (suffix !== CANONICAL_SUFFIX) return null;
    const digits = normalizeDigits(raw.slice(0, at));
    return digits ? `${digits}${CANONICAL_SUFFIX}` : null;
  }
  const digits = normalizeDigits(raw);
  return digits ? `${digits}${CANONICAL_SUFFIX}` : null;
}
