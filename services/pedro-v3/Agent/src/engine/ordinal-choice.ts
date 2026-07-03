// ============================================================================
// ordinal-choice.ts - guard deterministico para referencia ordinal fora da lista.
// Se o lead pede "o terceiro" e a ultima lista renderizada so tem 1 item, o
// turno NAO vai para o LLM adivinhar nem para stock_search por numero/modelo.
// Fail-closed: explica o limite da lista atual e conduz para escolher/mais opcoes.
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { ProposedDecision } from "../domain/decision.ts";
import type { Id } from "../domain/types.ts";
import type { TurnOutput } from "./decision-engine.ts";
import { finalize } from "./finalizer.ts";
import { parseOrdinal } from "./ordinal.ts";

export type InvalidOrdinalChoice = {
  readonly requestedOrdinal: number;
  readonly itemCount: number;
};

export function detectInvalidOrdinalChoice(args: {
  readonly leadMessage: string;
  readonly state: ConversationState;
}): InvalidOrdinalChoice | null {
  const ord = parseOrdinal(args.leadMessage);
  if (!ord) return null;
  const itemCount = args.state.lastRenderedOfferContext?.items.length ?? 0;
  if (itemCount <= 0) return null;
  if (ord.value >= 1 && ord.value <= itemCount) return null;
  return { requestedOrdinal: ord.value, itemCount };
}

function optionWord(count: number): string {
  return count === 1 ? "opcao" : "opcoes";
}

export function buildInvalidOrdinalChoiceTurnOutput(intent: InvalidOrdinalChoice, turnId: Id): TurnOutput {
  const text = intent.itemCount === 1
    ? `Na lista atual eu te mostrei apenas 1 opcao, entao nao tenho item ${intent.requestedOrdinal} nela. Quer ver fotos dessa opcao ou prefere que eu busque mais opcoes?`
    : `Na lista atual eu te mostrei ${intent.itemCount} ${optionWord(intent.itemCount)}, entao nao tenho item ${intent.requestedOrdinal} nela. Quer escolher uma delas ou prefere que eu busque mais opcoes?`;

  const proposal: ProposedDecision = {
    proposedAction: "clarify",
    facts: [],
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }],
    responsePlan: { guidance: text },
    reasonCode: "ordinal_out_of_range",
    reasonSummary: "Lead pediu um item ordinal que nao existe na lista renderizada atual.",
    confidence: 1,
  };
  const decision = finalize(turnId, proposal, [{ policyId: "POL-ORDINAL-CHOICE", outcome: "allow" }], []);
  return {
    decision,
    composed: { draft: { parts: [{ type: "text", content: text }] }, text },
    facts: [],
    loopExhausted: false,
    terminalSafe: false,
    steps: 0,
  };
}
