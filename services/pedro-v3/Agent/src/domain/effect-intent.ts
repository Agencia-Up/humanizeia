// ============================================================================
// Tipos de PERSISTÊNCIA da Fase 2 (aditivos — NÃO alteram o kernel).
// Brain/02 §4/§6 + ADR-002. Em F2.0 só importa o SHAPE (sem dispatch real).
// ============================================================================
import type { Id, JsonValue, Redacted } from "./types.ts";
import type { EffectKind, EffectOutcomeMutation } from "./decision.ts";

// ── status / capability (Brain/02 §4/§6) ────────────────────────────────────
export type EffectStatus =
  | "pending" | "processing" | "succeeded" | "failed" | "outcome_uncertain" | "skipped";
export type ProviderCapability = "idempotent" | "queryable" | "none";
export type ReceiptLevel = "accepted" | "delivered";

// helper de redaction por construção (Codex #8): nenhum payload cru persiste.
export function redact<T extends object>(o: T): Redacted<T> {
  return { ...o, __redacted: true } as Redacted<T>;
}

// ── EffectIntent: efeito MATERIALIZADO (payload do provider). A materialização
//    (decisão -> intent) é F2.1; aqui é só o shape persistido no outbox. ──────
export type EffectIntent = {
  effectId: Id;            // determinístico = turnId:planId
  conversationId: Id;
  turnId: Id;
  planId: Id;
  kind: EffectKind;
  idempotencyKey: Id;      // = effectId
  order: number;
  dependsOn: Id[];
  payload: Redacted<{ [k: string]: JsonValue }>;
  onSuccess: EffectOutcomeMutation[];  // o que aplicar no estado após receipt
};

// ── OutboxRecord: linha de `v3_effect_outbox`. status inicial 'pending'. ─────
export type OutboxRecord = EffectIntent & {
  status: EffectStatus;
  providerCapability: ProviderCapability;
  receiptLevel: ReceiptLevel | null;
  attempts: number;
  nextRetryAt: string | null;
  providerReceipt: JsonValue | null;
  outcomeAppliedAt: string | null;   // idempotência do EffectOutcomeCommit (Codex r3 #2)
  lastError: string | null;
  terminalAt?: string | null;
  processingBy?: string | null;
  processingToken?: string | null;
  processingExpiresAt?: string | null;
  createdAt: string;
  dispatchedAt: string | null;
};

// ── InboxRecord: linha de `v3_inbox`. dedupe pelo próprio INSERT (Codex #1). ─
export type InboxStatus = "pending" | "claimed" | "done" | "error";
export type InboxRecord = {
  eventId: Id;             // UNIQUE -> ON CONFLICT DO NOTHING é o dedupe
  conversationId: Id;
  raw: Redacted<{ [k: string]: JsonValue }>;
  status: InboxStatus;
  claimedBy: string | null;
  turnId: Id | null;
  attempts: number;
  nextRetryAt: string | null;
  receivedAt: string;      // ISO; usado no cutoff do burst
  claimedAt: string | null;
};

// ── TurnEventRecord / DecisionRecord: replay (`v3_turn_events`/`v3_decisions`). ─
export type TurnEventRecord = {
  eventId: Id;
  conversationId: Id;
  turnId: Id;
  type: string;
  payloadSchemaVersion: number;
  payload: Redacted<{ [k: string]: JsonValue }>;
  at: string;
};
