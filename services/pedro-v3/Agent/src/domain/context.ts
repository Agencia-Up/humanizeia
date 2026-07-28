// TurnContext — entrada imutável de um turno para o motor de decisão/política. PURO.
import type { Id, Iso } from "./types.ts";
import type { ConversationState } from "./conversation-state.ts";

import type { TurnInterpretation, TenantCatalog, ClaimExtractor } from "./decision.ts";
import type { PrimaryIntent } from "./agent-brain.ts";

/**
 * Identity declared by a trusted, structured conversation source.
 *
 * `label` is the source statement and is sufficient to authorize only the
 * natural mention of that identity. Optional parsed brand/model fields are
 * enrichment, never a prerequisite: a paid ad must not become unmentionable
 * merely because its vehicle is absent from a finite market taxonomy.
 */
export type DeclaredVehicleIdentity = {
  readonly source: "paid_ad";
  readonly label: string;
  readonly brand?: string | null;
  readonly model?: string | null;
};

export type TurnContext = {
  state: ConversationState;
  turnId: Id;
  leadMessage: string; // burst já agregado num texto (no Kernel, simplificado)
  now: Iso;
  interpretation: TurnInterpretation; // OBRIGATÓRIO — vem pronto dos adapters/orchestrator (N8N-like)
  tenantCatalog: TenantCatalog;
  claimExtractor: ClaimExtractor; // INJETADO — detecta alegações automotivas em texto livre
  // ⭐P0-B (opcional): PrimaryIntent ACEITO do TurnUnderstanding CONFIÁVEL da LLM (validado, com evidência do bloco atual).
  // É a AUTORIDADE de mudança de assunto na policy: POL-TRACK-001 só se abstém quando === "search_stock". NUNCA vem de um
  // detector heurístico (deriveCurrentTurnIntent). Ausente = legado (kernel/v2/replay) -> policy mantém o comportamento antigo.
  acceptedPrimaryIntent?: PrimaryIntent;
  /**
   * Vehicle identities explicitly declared by a structured conversation source.
   * This authorizes only naming the identity in natural text. It never proves
   * inventory availability, a vehicleKey, price, mileage or any other attribute.
   */
  declaredVehicleIdentities?: readonly DeclaredVehicleIdentity[];
};

export type QueryLoopLimits = {
  maxSteps: number;
  totalTimeoutMs: number;
  proposeTimeoutMs?: number;
  queryTimeoutMs?: number;
  composeTimeoutMs?: number;
};
// catalogDegraded (opcional): o snapshot do catálogo FALHOU no prepare (fail-closed p/ vazio) — o engine loga em
// decision_final (observável, nunca silencioso) e as policies seguem aceitando fatos frescos das tools do turno.
export type TurnContextPreparation = Pick<TurnContext, "interpretation" | "tenantCatalog" | "claimExtractor"> & { readonly catalogDegraded?: boolean };

export interface TurnContextPreparer {
  prepare(args: {
    readonly state: ConversationState;
    readonly turnId: Id;
    readonly leadMessage: string;
    readonly now: Iso;
  }): Promise<TurnContextPreparation>;
}
