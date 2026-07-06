// ============================================================================
// lead-intent.ts — P0 (Fase 4): DESINTERESSE / parada de venda. PURO, sem I/O.
// Detecta desengajamento do lead para o engine SUPRIMIR busca/funil/lista e responder CURTO (nunca empurrar venda).
// Não decide a resposta nem escreve por handler — só CLASSIFICA o sinal; o engine (ou o cérebro, prompt-first) usa.
//   - not_interested: firme ("não solicitei", "não me interessa", "não quero nada", "me tira da lista").
//   - low_intent: leve/ambíguo ("obrigado", "só olhando", "vou pensar") -> resposta leve, porta aberta.
// ============================================================================
import { normalizeText } from "./catalog-utils.ts";

export type LeadEngagement = "not_interested" | "low_intent";

const NOT_INTERESTED_RX = /\bnao\s+(?:solicitei|pedi|chamei|procurei|contratei|pedi\s+nada)\b|\bnao\s+(?:tenho|to\s+com|estou\s+com)\s+interesse\b|\bnao\s+me\s+interessa\b|\bnao\s+quero\s+(?:nada|comprar)\b|\bnada\s+ok\b|\bpar[ae]\s+de\s+(?:mandar|enviar|me\s+mandar)\b|\bnao\s+(?:me\s+)?enche\b|\bme\s+tira\s+(?:da\s+lista|dessa)\b|\bsai\s+fora\b/;
const LOW_INTENT_RX = /\bso\s+(?:olhando|dando\s+uma\s+olhada|pesquisando|de\s+olho|por\s+curiosidade)\b|\bobrigad[oa]\b|\bvaleu\b|\bnada\s+(?:por\s+enquanto|no\s+momento)\b|\bdepois\s+(?:eu\s+)?(?:vejo|volto|penso|te\s+chamo)\b|\bvou\s+pensar\b|\bvou\s+ver\b/;

export function detectDisengagement(block: string): LeadEngagement | null {
  const norm = normalizeText(block);
  if (NOT_INTERESTED_RX.test(norm)) return "not_interested";
  if (LOW_INTENT_RX.test(norm)) return "low_intent";
  return null;
}
