// ============================================================================
// lead-intent.ts — P0 (Fase 4): DESINTERESSE / parada de venda. PURO, sem I/O.
// Detecta desengajamento do lead para o engine SUPRIMIR busca/funil/lista e responder CURTO (nunca empurrar venda).
// Não decide a resposta nem escreve por handler — só CLASSIFICA o sinal; o engine (ou o cérebro, prompt-first) usa.
//   - not_interested: firme ("não solicitei", "não me interessa", "não quero nada", "me tira da lista").
//   - low_intent: leve/ambíguo ("obrigado", "só olhando", "vou pensar") -> resposta leve, porta aberta.
// ============================================================================
import { normalizeText } from "./catalog-utils.ts";

export type LeadEngagement = "not_interested" | "low_intent";

const NOT_INTERESTED_RX = /\bnao\s+(?:solicitei|pedi|chamei|procurei|contratei|pedi\s+nada)\b|\bnao\s+(?:tenho|to\s+com|estou\s+com)\s+interesse\b|\bnao\s+me\s+interessa\b|\bnao\s+quero\s+(?:nada|comprar)\b|\bnao\s+gostei\s+de\s+(?:nenhum|nenhuma)\b|\bnenhum(?:a)?\s+(?:das\s+)?op(?:cao|coes)\b|\bnada\s+ok\b|\bpar[ae]\s+de\s+(?:mandar|enviar|me\s+mandar)\b|\bnao\s+(?:me\s+)?enche\b|\bme\s+tira\s+(?:da\s+lista|dessa)\b|\bsai\s+fora\b/;
const LOW_INTENT_RX = /\bso\s+(?:olhando|dando\s+uma\s+olhada|pesquisando|de\s+olho|por\s+curiosidade)\b|\bobrigad[oa]\b|\bvaleu\b|\bnada\s+(?:por\s+enquanto|no\s+momento)\b|\bdepois\s+(?:eu\s+)?(?:vejo|volto|penso|te\s+chamo)\b|\bvou\s+pensar\b|\bvou\s+ver\b/;

export function detectDisengagement(block: string): LeadEngagement | null {
  const norm = normalizeText(block);
  if (NOT_INTERESTED_RX.test(norm)) return "not_interested";
  if (LOW_INTENT_RX.test(norm)) return "low_intent";
  return null;
}

// ============================================================================
// R8.1 (Codex 2026-07-15) — OPT-OUT GLOBAL OPERACIONAL, INEQUÍVOCO. Detector DEDICADO (separado de detectDisengagement,
// que também captura low_intent e rejeição de UM carro). Autoriza o FATO durável `optedOutAt` que PARA o follow-up.
// Regras: valida SOMENTE pedido inequívoco de PARAR o contato/as mensagens — NUNCA rejeição de veículo com pedido de
// alternativa ("não me interessa esse carro, tem outro?"). NÃO é roteador comercial: não decide assunto, não escolhe carro.
// STRONG: pedido explícito de parar (sempre opt-out, mesmo com filtro comercial no bloco — "me tira da lista do SUV até 50 mil").
const GLOBAL_LIST_OR_CONTACT_RX = /\bme\s+tir\w*\s+(?:da|dessa|desta)\s+lista\b|\btir\w*\s+(?:o\s+)?(?:meu\s+)?(?:numero|contato)\s+(?:da|dessa)\s+lista\b|\bencerr\w*\s+(?:o\s+)?contato\b|\bnao\s+quero\s+mais\s+nada\b|\bnao\s+(?:me\s+)?enche\b|\bsai\s+fora\b/;
const GLOBAL_MESSAGE_RX = /\b(?:pode\s+)?par[ae]r?\s+de\s+(?:me\s+)?(?:mandar|enviar)\s+(?:mais\s+)?mensag\w*\b|\b(?:pode\s+)?par[ae]r?\s+de\s+(?:me\s+)?chamar\b|\bnao\s+me\s+(?:manda|mande|mandem|envie|envia|chame|chama)\s+mais\s+(?:mensag\w*|contato)\b|\bnao\s+quero\s+(?:mais\s+)?receber\s+(?:mais\s+)?(?:mensag\w*|contato)\b/;
const SCOPED_STOP_RX = /\b(?:nao\s+me\s+(?:manda|mande|mandem|envie|envia|chame|chama)\s+mais|nao\s+quero\s+(?:mais\s+)?receber\s+mais?|(?:pode\s+)?par[ae]r?\s+de\s+(?:me\s+)?(?:mandar|enviar))\s+(?:fotos?|imagens?|ofertas?|opcoes?|carros?|veiculos?|o\s+\w+|a\s+\w+|um\s+\w+|uma\s+\w+)\b|\b(?:mensag\w*|contato)\s+(?:sobre|desse|deste|dessa|desta|nesse|neste|nessa|nesta|do|da|de|para|pra)\s+\w+/;
const GLOBAL_BARE_STOP_RX = /\b(?:pode\s+)?par[ae]r?\s+de\s+(?:me\s+)?(?:mandar|enviar)\b(?!\s+(?:fotos?|imagens?|ofertas?|opcoes?|carros?|veiculos?|o\s+\w+|a\s+\w+|um\s+\w+|uma\s+\w+))/;
const SCOPED_REJECTION_RX = /\bsai\s+fora\s+(?:desse|deste|dessa|desta|do|da|o|a|um|uma)\s+\w+/;
// SOFT: desinteresse global genérico ("não me interessa" / "não quero comprar") — só é opt-out se NÃO estiver pedindo
// uma ALTERNATIVA (aí é rejeição de veículo, não opt-out).
const SOFT_OPTOUT_RX = /\bnao\s+me\s+interessa\b|\bnao\s+tenho\s+interesse\b|\bnao\s+quero\s+comprar\b/;
// ALTERNATIVA: o lead está REJEITANDO um item e pedindo OUTRO — NÃO é opt-out global.
const SEEKS_ALTERNATIVE_RX = /\boutr[oa]s?\b|\bum[a]?\s+(?:sedan|suv|hatch|picape|pickup|carro|modelo|veiculo)\b|\b(?:esse|este|desse|deste|nesse|essa|esta|dessa)\s+\w+/;

export function detectExplicitOptOut(block: string): boolean {
  const n = normalizeText(block);
  if (SCOPED_REJECTION_RX.test(n)) return false;                      // rejeição de um item não cancela o contato
  if (GLOBAL_LIST_OR_CONTACT_RX.test(n)) return true;                 // pedido global explícito vence contexto comercial
  if (SCOPED_STOP_RX.test(n)) return false;                            // recusa escopada não cancela o contato
  if (GLOBAL_MESSAGE_RX.test(n)) return true;
  if (GLOBAL_BARE_STOP_RX.test(n)) return true;                        // "pode parar de mandar" sem objeto = contato global
  if (SOFT_OPTOUT_RX.test(n) && !SEEKS_ALTERNATIVE_RX.test(n)) return true;
  return false;
}
