// Provider-agnostic contracts for the prompt-bound conversational model.
// The provider adapter is still offline in F2.5.4B: these requests are consumed
// by deterministic fakes until a real model transport is explicitly authorized.

import type { ConversationState } from "./conversation-state.ts";
import type {
  DecisionStep,
  QueryResult,
  ResponseDraft,
  TenantCatalog,
  TurnDecision,
  TurnInterpretation,
} from "./decision.ts";
import type { TenantRuntimeConfig } from "./read-ports.ts";

export type ModelBinding = {
  readonly tenantId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly companyName: string | null;
  readonly systemPrompt: string;
  readonly promptSource: TenantRuntimeConfig["promptSource"];
  readonly promptVersion: string;
  readonly model: string | null;
  readonly temperature: number | null;
};

// F2.7.4 (E) — Contexto explicito derivado do estado/historico, surfacado ao modelo
// a cada turno (em vez do state cru). Tipos vivem no dominio; o DERIVADOR puro fica
// em engine/model-context-view.ts (deriveModelContext). Mantem o dominio sem depender de engine.
export type ModelTranscriptTurn = { readonly role: "lead" | "agent"; readonly text: string };

export type ModelConversationContext = {
  readonly recentTranscript: readonly ModelTranscriptTurn[];
  readonly lastAgentMessage: string | null;
  readonly alreadyIntroduced: boolean;
  readonly conversationFacts: readonly string[];
  readonly currentObjective: { readonly type: string; readonly slot: string | null; readonly status: string } | null;
  readonly lastCommercialInterest: { readonly model: string | null; readonly tipo: string | null; readonly precoMax: number | null } | null;
};

export type ModelTurnSnapshot = {
  readonly turnId: string;
  readonly now: string;
  readonly leadMessage: string;
  readonly state: ConversationState;
  readonly tenantCatalog: TenantCatalog;
  readonly interpretation?: TurnInterpretation;
  readonly context: ModelConversationContext;
};

export type InterpretModelRequest = {
  readonly operation: "interpret";
  readonly binding: ModelBinding;
  // interpret roda ANTES de existir interpretacao/contexto derivado deste turno.
  readonly turn: Omit<ModelTurnSnapshot, "interpretation" | "context">;
};

export type ProposeModelRequest = {
  readonly operation: "propose";
  readonly binding: ModelBinding;
  readonly turn: ModelTurnSnapshot;
  readonly facts: readonly QueryResult[];
};

export type ComposeModelRequest = {
  readonly operation: "compose";
  readonly binding: ModelBinding;
  readonly turn: ModelTurnSnapshot;
  readonly facts: readonly QueryResult[];
  readonly decision: TurnDecision;
};

// Returns unknown deliberately: the prompt-bound adapter owns runtime decoding.
// A provider SDK can never smuggle an unchecked object into the kernel.
export interface StructuredConversationModel {
  interpret(request: InterpretModelRequest): Promise<unknown>;
  propose(request: ProposeModelRequest): Promise<unknown>;
  compose(request: ComposeModelRequest): Promise<unknown>;
}

export interface TurnUnderstanding {
  interpret(args: {
    readonly state: ConversationState;
    readonly turnId: string;
    readonly now: string;
    readonly leadMessage: string;
    readonly tenantCatalog: TenantCatalog;
  }): Promise<TurnInterpretation>;
}

// Compile-time anchors for provider adapters and tests.
export type StructuredModelOutputs = {
  readonly interpret: TurnInterpretation;
  readonly propose: DecisionStep;
  readonly compose: ResponseDraft;
};
