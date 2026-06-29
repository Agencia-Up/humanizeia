import type { TurnContext } from "./context.ts";
import type { DecisionStep, QueryResult, TurnDecision, ResponseDraft } from "./decision.ts";

export interface DecisionLlm {
  // PROPÕE: mais uma QueryCall OU finalizar (Brain/02 §2.5).
  proposeNextQueryOrFinal(ctx: TurnContext, facts: QueryResult[]): Promise<DecisionStep>;
  // COMPÕE: rascunho de resposta estruturado (não muda ação).
  compose(decision: TurnDecision, facts: QueryResult[], ctx: TurnContext): Promise<ResponseDraft>;
}
