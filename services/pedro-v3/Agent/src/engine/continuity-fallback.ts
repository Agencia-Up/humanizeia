// ============================================================================
// continuity-fallback.ts — F2.7.11 (P0). Duas garantias:
//
//  (Task 2) `buildContextualSdrReply(state)`: o texto que vai pro LEAD num fallback (terminal-safe
//    de validacao/grounding/erro) NUNCA pode ser a frase tecnica "Desculpe a lentidao...". E um
//    fallback de SDR conduzido pelo ESTADO (oferta recente / interesse conhecido / descoberta).
//    O `reason_code` interno do decision pode seguir terminal_safe (logs), mas o texto e comercial.
//
//  (Task 3) Guard de CONTINUIDADE: saudacao/ack/comentario curto SEM nova intencao comercial, em
//    conversa JA iniciada -> resposta deterministica que CONDUZ a partir do contexto, sem reiniciar,
//    sem reapresentar, sem ofertar ungrounded (que virava terminal-safe). Por CLASSE de termo, nao
//    por frase especifica.
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { ClaimExtractor, ProposedDecision } from "../domain/decision.ts";
import type { Id } from "../domain/types.ts";
import type { TurnOutput } from "./decision-engine.ts";
import { finalize } from "./finalizer.ts";
import { normalizeText } from "./catalog-utils.ts";
import { turnHasNewCommercialIntent } from "./explicit-search.ts";

const FALLBACK_MARKER = /desculpe a lentid/i; // fallback tecnico antigo: NUNCA reusar como "oferta"

// Houve oferta/lista REAL recente do agente? (R$ / item numerado / "separei…/disponivel"), ignorando o
// proprio fallback antigo. recentTurns e accepted-safe (populado mesmo com delivered bloqueado — issue C).
function recentAgentOffered(state: ConversationState): boolean {
  for (const turn of (state.recentTurns ?? []).slice(-8)) {
    if (turn.role !== "agent") continue;
    const t = turn.text ?? "";
    if (FALLBACK_MARKER.test(t)) continue;
    if (/R\$\s?\d/.test(t) || /(^|\n)\s*\d\.\s/.test(t) || /separei|dispon[ií]ve/i.test(t)) return true;
  }
  return false;
}

function alreadyIntroduced(state: ConversationState): boolean {
  return (state.recentTurns ?? []).some((t) => t.role === "agent") || (state.turnNumber ?? 1) > 1;
}

function knownInteresse(state: ConversationState): string | null {
  const s = (state.slots as any)?.interesse;
  return s && s.status === "known" && typeof s.value === "string" && s.value.trim() !== "" ? s.value : null;
}

// Fallback SDR conduzido pelo estado (Task 2). NUNCA mensagem de sistema.
export function buildContextualSdrReply(state: ConversationState): string {
  if (recentAgentOffered(state)) {
    return "Quer ver as fotos de algum desses modelos, ou prefere que eu filtre por valor, câmbio ou ano?";
  }
  const interesse = knownInteresse(state);
  if (interesse) {
    return `Sobre o que você comentou (${interesse}) — quer que eu te mostre as opções no estoque, veja as fotos, ou prefere já agendar uma visita?`;
  }
  return "Me conta o que você procura — um modelo específico, uma faixa de preço ou um tipo (SUV, hatch, sedan)? Aí já busco no nosso estoque.";
}

// Continuidade (Task 3): saudacao/ack/reacao curta. Por CLASSE (sem if por frase).
const CONTINUITY = /\b(bom dia|boa tarde|boa noite|ola|oi|opa|eai|e ai|ok|okay|certo|entendi|entendido|beleza|blz|show|massa|tranquil\w*|perfeito|isso|uhum|aham|valeu|obrigad\w*|fechou|combinado|bonit\w*|lind\w*|gostei|legal|interessante|bacana|maneiro|top|otim\w*|que bom|nossa|adorei|amei|curti|de boa)\b/;
// Sinais de NOVA intencao comercial -> NAO e continuidade (deixa handlers/LLM): foto, preco/estoque, agenda, tipo.
const COMMERCIAL_SIGNAL = /\bfotos?\b|\bimagens?\b|\bbarat|\bpopular|\bvendid|\bprocurad|\bpreco|\bvalor|\bquanto|\bparcel|\bfinanc|\btroca|\bfaixa|\bsuv\b|\bhatch\b|\bsedan\b|\bagendar|\bvisita|\bdetalhe/;

export function detectContinuityIntent(args: { readonly leadMessage: string; readonly state: ConversationState; readonly claimExtractor: ClaimExtractor }): boolean {
  const { leadMessage, state, claimExtractor } = args;
  if (!alreadyIntroduced(state)) return false; // 1o contato -> LLM faz a saudacao inicial (nao curto-circuita)
  if (turnHasNewCommercialIntent(leadMessage, claimExtractor)) return false; // F2.7.13: marca/modelo/tipo/faixa NAO e continuidade
  const norm = normalizeText(leadMessage);
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false; // continuidade = mensagem CURTA
  if (!CONTINUITY.test(norm)) return false;
  if (COMMERCIAL_SIGNAL.test(norm)) return false; // tem intencao comercial nova
  if (claimExtractor.extractClaims(leadMessage).some((c) => c.kind === "model" || c.kind === "brand_model")) return false; // nomeou veiculo
  return true;
}

export function buildContinuityTurnOutput(state: ConversationState, turnId: Id): TurnOutput {
  const text = buildContextualSdrReply(state);
  const proposal: ProposedDecision = {
    proposedAction: "reply",
    facts: [],
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }],
    responsePlan: { guidance: text },
    reasonCode: "continuity_conduct",
    reasonSummary: "Mensagem de continuidade — conduz a partir do contexto, sem reiniciar nem reapresentar.",
    confidence: 1,
  };
  const decision = finalize(turnId, proposal, [{ policyId: "POL-CONTINUITY", outcome: "allow" }], []);
  return {
    decision,
    composed: { draft: { parts: [{ type: "text", content: text }] }, text },
    facts: [],
    loopExhausted: false,
    terminalSafe: false,
    steps: 0,
  };
}
