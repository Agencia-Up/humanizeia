// TurnContext — entrada imutável de um turno para o motor de decisão/política. PURO.
import type { Id, Iso } from "./types.ts";
import type { ConversationState } from "./conversation-state.ts";

import type { TurnInterpretation, TenantCatalog, ClaimExtractor } from "./decision.ts";

export type TurnContext = {
  state: ConversationState;
  turnId: Id;
  leadMessage: string; // burst já agregado num texto (no Kernel, simplificado)
  now: Iso;
  interpretation: TurnInterpretation; // OBRIGATÓRIO — vem pronto dos adapters/orchestrator (N8N-like)
  tenantCatalog: TenantCatalog;
  claimExtractor: ClaimExtractor; // INJETADO — detecta alegações automotivas em texto livre
};

export type QueryLoopLimits = {
  maxSteps: number;
  totalTimeoutMs: number;
  proposeTimeoutMs?: number;
  queryTimeoutMs?: number;
  composeTimeoutMs?: number;
};
export type TurnContextPreparation = Pick<TurnContext, "interpretation" | "tenantCatalog" | "claimExtractor">;

export interface TurnContextPreparer {
  prepare(args: {
    readonly state: ConversationState;
    readonly turnId: Id;
    readonly leadMessage: string;
    readonly now: Iso;
  }): Promise<TurnContextPreparation>;
}
