// ============================================================================
// PORTS — interfaces de I/O puras (hexagonal). Brain/07 §1, 02 §3/§4/§5.
// NENHUMA implementação aqui. Os adapters (in-memory agora; Postgres depois,
// gated) implementam estas interfaces. SEM fetch/http/pg/supabase.
// ============================================================================
import type { Id, JsonValue, Redacted } from "./types.ts";
import type { ConversationState } from "./conversation-state.ts";
import type { EffectResult, TurnDecision } from "./decision.ts";
import type { InboxRecord, OutboxRecord, TurnEventRecord } from "./effect-intent.ts";

export type Awaitable<T> = T | Promise<T>;

// ── Determinismo (Codex F2.0 #8) ────────────────────────────────────────────
export interface Clock { now(): string; }              // ISO-8601
export interface IdGen { next(prefix?: string): Id; }

// ── Lease / CoordinationStore (lock por conversa) ───────────────────────────
export type Lease = { conversationId: Id; owner: string; token: Id; acquiredAt: string; expiresAt: string };
export interface LeaseStore {
  acquire(conversationId: Id, owner: string, ttlMs: number): Awaitable<Lease | null>;  // null = já travado
  renew(lease: Lease, ttlMs: number): Awaitable<boolean>;
  release(lease: Lease): Awaitable<void>;
}

// ── Inbox (ingestão atômica = dedupe; claim com cutoff) ─────────────────────
export type InboxInsert = { eventId: Id; conversationId: Id; raw: Redacted<{ [k: string]: JsonValue }>; receivedAt: string };
export interface InboxStore {
  // INSERT ... ON CONFLICT (eventId) DO NOTHING -> true = primeira vez; false = duplicado (no_op).
  tryInsert(rec: InboxInsert): Awaitable<boolean>;
  // claim ATÔMICO: pega 'pending' com receivedAt <= cutoff e marca 'claimed'. Retorna os eventIds claimados.
  claimBurst(conversationId: Id, cutoff: string, claimedBy: string, turnId: Id, lease?: Lease): Awaitable<Id[]>;
  // RECUPERAÇÃO (F2.0.1): turno falhou ANTES do commit -> devolve o claim p/ 'pending'. Só libera os
  // eventos claimados por ESTE claimedBy/turnId (claim de outro worker/turno não é liberado). Brain/02 §9.
  releaseClaim(eventIds: Id[], claimedBy: string, turnId: Id): Awaitable<Id[]>;   // retorna os realmente liberados
  get(eventId: Id): Awaitable<InboxRecord | null>;
  pendingCount(conversationId: Id): Awaitable<number>;
}

// ── State (snapshot versionado p/ CAS) ──────────────────────────────────────
export type StateSnapshot = { state: ConversationState; version: number };
export interface StateStore {
  load(conversationId: Id): Awaitable<StateSnapshot | null>;       // null = conversa nova (version 0)
}

// ── Outbox (somente leitura aqui; escrita é via UnitOfWork) ─────────────────
export type StoreOperationResult = { ok: true } | { ok: false; reason: string };
export type OutboxOutcomeResult =
  | { ok: true; stateVersion: number; applied: boolean }
  | { ok: false; reason: string };

export interface OutboxStore {
  listOutbox(conversationId: Id): Awaitable<OutboxRecord[]>;
  claimOutbox(conversationId: Id, workerId: string, ttlMs: number, limit: number): Awaitable<OutboxRecord[]>;
  recordOutboxResult(record: OutboxRecord, result: EffectResult, nextRetryAt?: string | null): Awaitable<StoreOperationResult>;
  requeueOutbox(record: OutboxRecord, nextRetryAt: string, reason: string): Awaitable<StoreOperationResult>;
  skipOutbox(record: OutboxRecord, reason: string, at: string): Awaitable<StoreOperationResult>;
  failOutbox(record: OutboxRecord, reason: string, at: string): Awaitable<StoreOperationResult>
  commitOutboxOutcome(
    conversationId: Id,
    effectId: Id,
    expectedVersion: number,
    nextState: ConversationState | null,
    at: string,
  ): Awaitable<OutboxOutcomeResult>;
}

// ── UnitOfWork: persistência ATÔMICA (tudo-ou-nada) com CAS (Brain/02 §3 #15) ─
// Estágios são bufferizados; commit() valida (CAS + unicidades) e aplica TUDO,
// ou rejeita sem aplicar NADA.
export interface UnitOfWork {
  casState(conversationId: Id, expectedVersion: number, nextState: ConversationState): void;
  appendEvents(events: TurnEventRecord[]): void;
  appendDecision(conversationId: Id, decision: TurnDecision): void;
  appendOutbox(records: OutboxRecord[]): void;          // idempotencyKey UNIQUE
  updateOutbox(record: OutboxRecord): void;             // F2.2: atualização de status do outbox record
  // F2.0.1: só aceita evento 'claimed' por ESTE claimedBy/turnId (commit rejeita se divergir).
  markInboxDone(eventIds: Id[], claimedBy: string, turnId: Id): void;
  commit(): Awaitable<{ ok: true } | { ok: false; reason: string }>;
}

export type UnitOfWorkContext = { lease?: Lease };

// ── Persistência agregada (o adapter implementa tudo) ───────────────────────
export interface Persistence extends InboxStore, StateStore, OutboxStore, LeaseStore {
  begin(context?: UnitOfWorkContext): UnitOfWork;
  // lock com finally: libera no sucesso E no erro/reject. NÃO libera antes de uma Promise pendente terminar
  // (F2.0.1). Lança "lease unavailable" se não adquirir.
  withLease<T>(conversationId: Id, owner: string, ttlMs: number, fn: (lease: Lease) => T | Promise<T>): Promise<T>;
}
