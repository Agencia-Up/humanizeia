// ============================================================================
// InMemoryPersistence — adapter FAKE dos ports (F2.0). SEM I/O real, SEM rede.
// Simula as tabelas v3_* com Maps + UnitOfWork atômico (tudo-ou-nada) + CAS.
// Brain/07 §3/§4. Determinístico via FakeClock/FakeIdGen.
// ============================================================================
import type { Id, JsonValue } from "../../domain/types.ts";
import type { ConversationState } from "../../domain/conversation-state.ts";
import type { PersistedWorkingMemory } from "../../domain/agent-brain.ts";
import type { EffectResult, TurnDecision } from "../../domain/decision.ts";
import type { InboxRecord, OutboxRecord, TurnEventRecord } from "../../domain/effect-intent.ts";
import { isEffectSatisfiedForDependency, requiredReceiptFor } from "../../domain/effect-policy.ts";
import type {
  Clock, IdGen, Lease, InboxInsert, StateSnapshot, UnitOfWork, Persistence,
  ConversationRoutingStore, SettledConversation,
} from "../../domain/ports.ts";
import { isConversationSettled } from "../../engine/debounce-policy.ts";

// ── Determinismo (Codex F2.0 #8) ────────────────────────────────────────────
export class FakeClock implements Clock {
  private t: number;
  constructor(startIso = "2026-06-27T00:00:00.000Z") { this.t = Date.parse(startIso); }
  now(): string { return new Date(this.t).toISOString(); }
  advance(ms: number): void { this.t += ms; }
}

export class FakeIdGen implements IdGen {
  private n = 0;
  next(prefix = "id"): Id { this.n += 1; return `${prefix}-${this.n}`; }
}

type StagedCas = { conversationId: Id; expectedVersion: number; nextState: ConversationState };
type SyncCommitResult = { ok: true } | { ok: false; reason: string };
type SyncUnitOfWork = Omit<UnitOfWork, "commit"> & { commit(): SyncCommitResult };

// R13 Inc2/E (Codex): backing DURÁVEL injetável — simula a tabela v3_* que SOBREVIVE a um restart do processo.
// Um novo InMemoryPersistence + novo engine apontando p/ o MESMO backing = "restart" (memória recuperada do banco,
// nunca de estado global no processo). Sem backing => Maps próprios (comportamento anterior 100% preservado).
export type InMemoryBacking = {
  inbox: Map<Id, InboxRecord>;
  states: Map<Id, StateSnapshot>;
  history: { conversationId: Id; version: number; state: ConversationState }[];
  events: TurnEventRecord[];
  decisions: { conversationId: Id; decision: TurnDecision }[];
  outbox: Map<Id, OutboxRecord>;
  outboxIdem: Set<Id>;
  leases: Map<Id, Lease>;
  routing: Map<Id, { agentId: string; leadId: string | null; toAddr: string }>;
};
export function createInMemoryBacking(): InMemoryBacking {
  return { inbox: new Map(), states: new Map(), history: [], events: [], decisions: [], outbox: new Map(), outboxIdem: new Set(), leases: new Map(), routing: new Map() };
}

export class InMemoryPersistence implements Persistence, ConversationRoutingStore {
  private inbox = new Map<Id, InboxRecord>();
  private states = new Map<Id, StateSnapshot>();
  private history: { conversationId: Id; version: number; state: ConversationState }[] = [];
  private events: TurnEventRecord[] = [];
  private decisions: { conversationId: Id; decision: TurnDecision }[] = [];
  private outbox = new Map<Id, OutboxRecord>();   // por effectId
  private outboxIdem = new Set<Id>();             // idempotencyKey UNIQUE
  private leases = new Map<Id, Lease>();          // conversationId -> lease ativo
  private routing = new Map<Id, { agentId: string; leadId: string | null; toAddr: string }>(); // F2.7.6

  constructor(private clock: Clock, private idgen: IdGen, backing?: InMemoryBacking) {
    if (backing) {
      // Aponta os Maps INTERNOS p/ o backing durável (mesma referência) — o restart lê o que foi commitado antes.
      this.inbox = backing.inbox;
      this.states = backing.states;
      this.history = backing.history;
      this.events = backing.events;
      this.decisions = backing.decisions;
      this.outbox = backing.outbox;
      this.outboxIdem = backing.outboxIdem;
      this.leases = backing.leases;
      this.routing = backing.routing;
    }
  }

  // ── ConversationRoutingStore (F2.7.6) ─────────────────────────────────────
  upsertRouting(conversationId: Id, agentId: string, leadId: string | null, toAddr: string): void {
    this.routing.set(conversationId, { agentId, leadId, toAddr });
  }
  findSettledConversations(nowIso: string, debounceMs: number, maxWaitMs: number, limit: number): SettledConversation[] {
    const nowMs = Date.parse(nowIso);
    const groups = new Map<Id, { count: number; oldest: number; newest: number }>();
    for (const r of this.inbox.values()) {
      if (r.status !== "pending") continue;
      const at = Date.parse(r.receivedAt);
      const g = groups.get(r.conversationId);
      if (!g) groups.set(r.conversationId, { count: 1, oldest: at, newest: at });
      else { g.count += 1; g.oldest = Math.min(g.oldest, at); g.newest = Math.max(g.newest, at); }
    }
    const ordered = [...groups.entries()].sort((a, b) => a[1].oldest - b[1].oldest);
    const out: SettledConversation[] = [];
    for (const [conversationId, g] of ordered) {
      if (out.length >= limit) break;
      if (!isConversationSettled({ nowMs, oldestPendingMs: g.oldest, newestPendingMs: g.newest, debounceMs, maxWaitMs })) continue;
      const route = this.routing.get(conversationId);
      if (!route) continue; // sem roteamento -> nao da p/ despachar async; ignora
      out.push({ conversationId, agentId: route.agentId, leadId: route.leadId, toAddr: route.toAddr, pendingCount: g.count });
    }
    return out;
  }

  // ── LeaseStore ────────────────────────────────────────────────────────────
  acquire(conversationId: Id, owner: string, ttlMs: number): Lease | null {
    const cur = this.leases.get(conversationId);
    const now = Date.parse(this.clock.now());
    if (cur && Date.parse(cur.expiresAt) > now) return null;   // travado e não expirado
    const acquiredAt = this.clock.now();
    const lease: Lease = {
      conversationId, owner, token: this.idgen.next("lease"),
      acquiredAt, expiresAt: new Date(now + ttlMs).toISOString(),
    };
    this.leases.set(conversationId, lease);
    return lease;
  }
  renew(lease: Lease, ttlMs: number): boolean {
    const cur = this.leases.get(lease.conversationId);
    if (!cur || cur.token !== lease.token) return false;
    cur.expiresAt = new Date(Date.parse(this.clock.now()) + ttlMs).toISOString();
    return true;
  }
  release(lease: Lease): void {
    const cur = this.leases.get(lease.conversationId);
    if (cur && cur.token === lease.token) this.leases.delete(lease.conversationId);
  }
  async withLease<T>(conversationId: Id, owner: string, ttlMs: number, fn: (lease: Lease) => T | Promise<T>): Promise<T> {
    const lease = this.acquire(conversationId, owner, ttlMs);
    if (!lease) throw new Error("lease unavailable");
    try { return await fn(lease); }    // AWAIT: o lease NÃO é liberado antes da Promise terminar (F2.0.1)
    finally { this.release(lease); }   // libera no resolve E no reject
  }

  // ── InboxStore ────────────────────────────────────────────────────────────
  tryInsert(rec: InboxInsert): boolean {
    if (this.inbox.has(rec.eventId)) return false;             // dedupe = o próprio insert (Codex F2.0 #1)
    this.inbox.set(rec.eventId, {
      eventId: rec.eventId, conversationId: rec.conversationId, raw: rec.raw,
      status: "pending", claimedBy: null, turnId: null, attempts: 0,
      nextRetryAt: null, receivedAt: rec.receivedAt, claimedAt: null,
    });
    return true;
  }
  claimBurst(conversationId: Id, cutoff: string, claimedBy: string, turnId: Id): Id[] {
    const cut = Date.parse(cutoff);
    const claimed: Id[] = [];
    for (const r of this.inbox.values()) {
      if (r.conversationId !== conversationId || r.status !== "pending") continue;
      if (Date.parse(r.receivedAt) > cut) continue;            // cutoff: msg nova fica p/ próximo turno (Codex F2.0 #3)
      r.status = "claimed"; r.claimedBy = claimedBy; r.turnId = turnId;
      r.claimedAt = this.clock.now(); r.attempts += 1;
      claimed.push(r.eventId);
    }
    return claimed;
  }
  releaseClaim(eventIds: Id[], claimedBy: string, turnId: Id): Id[] {
    const released: Id[] = [];
    for (const id of eventIds) {
      const r = this.inbox.get(id);
      if (!r || r.status !== "claimed") continue;
      if (r.claimedBy !== claimedBy || r.turnId !== turnId) continue;  // claim de outro worker/turno: NÃO libera
      r.status = "pending"; r.claimedBy = null; r.turnId = null; r.claimedAt = null;
      released.push(id);
    }
    return released;
  }
  get(eventId: Id): InboxRecord | null { return this.inbox.get(eventId) ?? null; }
  pendingCount(conversationId: Id): number {
    let c = 0; for (const r of this.inbox.values()) if (r.conversationId === conversationId && r.status === "pending") c += 1;
    return c;
  }

  // ── StateStore / OutboxStore ──────────────────────────────────────────────
  load(conversationId: Id): StateSnapshot | null {
    const s = this.states.get(conversationId);
    return s ? { state: structuredClone(s.state), version: s.version } : null;
  }
  listOutbox(conversationId: Id): OutboxRecord[] {
    return [...this.outbox.values()].filter((r) => r.conversationId === conversationId).sort((a, b) => a.order - b.order);
  }

  claimOutbox(conversationId: Id, workerId: string, ttlMs: number, limit: number): OutboxRecord[] {
    if (ttlMs <= 0 || limit <= 0) return [];
    const all = this.listOutbox(conversationId);
    const claimed: OutboxRecord[] = [];
    const now = this.clock.now();
    const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();

    for (const record of all) {
      if (claimed.length >= limit || record.status !== "pending") continue;
      if (record.nextRetryAt && Date.parse(record.nextRetryAt) > Date.parse(now)) continue;

      const priors = all.filter((candidate) => (
        candidate.turnId === record.turnId && candidate.order < record.order
      ));
      if (priors.some((prior) => !isEffectSatisfiedForDependency(prior))) continue;

      const dependencies = record.dependsOn.map((planId) => (
        all.find((candidate) => candidate.turnId === record.turnId && candidate.planId === planId)
      ));
      if (dependencies.some((dependency) => !dependency || !isEffectSatisfiedForDependency(dependency))) continue;

      const next: OutboxRecord = {
        ...record,
        status: "processing",
        attempts: record.attempts + 1,
        dispatchedAt: record.dispatchedAt ?? now,
        processingBy: workerId,
        processingToken: this.idgen.next("outbox-claim"),
        processingExpiresAt: expiresAt,
        lastError: null,
      };
      this.outbox.set(next.effectId, structuredClone(next));
      claimed.push(structuredClone(next));
    }

    return claimed;
  }

  recordOutboxResult(
    record: OutboxRecord,
    result: EffectResult,
    nextRetryAt: string | null = null,
  ): { ok: true } | { ok: false; reason: string } {
    const current = this.outbox.get(record.effectId);
    if (!current) return { ok: false, reason: "outbox_effect_not_found" };
    if (result.effectId !== current.effectId) return { ok: false, reason: "effect_id_mismatch" };
    if (result.status === "succeeded" && result.receipt.effectId !== result.effectId) {
      return { ok: false, reason: "receipt_effect_id_mismatch" };
    }

    if (current.status === "succeeded" && result.status === "succeeded") {
      if (current.receiptLevel === "delivered") return { ok: true };
      if (current.receiptLevel === "accepted" && result.receipt.level === "accepted") return { ok: true };
    }

    const validTransition = (
      (current.status === "processing" && current.processingToken != null && current.processingToken === record.processingToken)
      || current.status === "outcome_uncertain"
      || (
        current.status === "succeeded"
        && current.receiptLevel === "accepted"
        && (
          (result.status === "succeeded" && result.receipt.level === "delivered")
          || result.status === "failed"
        )
      )
    );
    if (!validTransition) return { ok: false, reason: "outbox_result_transition_invalid" };

    const base: OutboxRecord = {
      ...current,
      processingBy: null,
      processingToken: null,
      processingExpiresAt: null,
    };

    if (result.status === "succeeded") {
      const next: OutboxRecord = {
        ...base,
        status: "succeeded",
        receiptLevel: result.receipt.level,
        providerReceipt: structuredClone(result.receipt) as unknown as JsonValue,
        nextRetryAt: null,
        lastError: null,
        terminalAt: requiredReceiptFor(current) === "accepted" ? result.receipt.at : null,
      };
      this.outbox.set(next.effectId, next);
      return { ok: true };
    }

    if (result.status === "failed") {
      const next: OutboxRecord = {
        ...base,
        status: "failed",
        lastError: result.error.message,
        nextRetryAt: result.error.retryable ? nextRetryAt : null,
        terminalAt: result.error.retryable ? null : this.clock.now(),
      };
      this.outbox.set(next.effectId, next);
      return { ok: true };
    }

    const next: OutboxRecord = {
      ...base,
      status: "outcome_uncertain",
      providerReceipt: structuredClone(result.metadata) as unknown as JsonValue,
      nextRetryAt,
      terminalAt: null,
    };
    this.outbox.set(next.effectId, next);
    return { ok: true };
  }

  requeueOutbox(
    record: OutboxRecord,
    nextRetryAt: string,
    reason: string,
  ): { ok: true } | { ok: false; reason: string } {
    const current = this.outbox.get(record.effectId);
    if (!current) return { ok: false, reason: "outbox_effect_not_found" };
    if (current.status !== record.status || current.receiptLevel !== record.receiptLevel) {
      return { ok: false, reason: "outbox_requeue_stale_record" };
    }
    if (current.status === "processing" && current.processingToken !== record.processingToken) {
      return { ok: false, reason: "outbox_requeue_claim_mismatch" };
    }
    if (!["failed", "outcome_uncertain", "processing"].includes(current.status)) {
      return { ok: false, reason: "outbox_requeue_transition_invalid" };
    }
    if ((current.status !== "failed" && current.providerCapability === "none") || current.outcomeAppliedAt != null || current.terminalAt != null) {
      return { ok: false, reason: "outbox_requeue_not_safe" };
    }
    this.outbox.set(current.effectId, {
      ...current,
      status: "pending",
      nextRetryAt,
      lastError: reason,
      terminalAt: null,
      processingBy: null,
      processingToken: null,
      processingExpiresAt: null,
    });
    return { ok: true };
  }

  skipOutbox(
    record: OutboxRecord,
    reason: string,
    at: string,
  ): { ok: true } | { ok: false; reason: string } {
    const current = this.outbox.get(record.effectId);
    if (!current) return { ok: false, reason: "outbox_effect_not_found" };
    if (current.status !== record.status || current.receiptLevel !== record.receiptLevel) {
      return { ok: false, reason: "outbox_skip_stale_record" };
    }
    if (current.status === "processing" && current.processingToken !== record.processingToken) {
      return { ok: false, reason: "outbox_skip_claim_mismatch" };
    }
    if (!["pending", "processing"].includes(current.status) || current.outcomeAppliedAt != null) {
      return { ok: false, reason: "outbox_skip_transition_invalid" };
    }
    this.outbox.set(current.effectId, {
      ...current,
      status: "skipped",
      lastError: reason,
      terminalAt: at,
      outcomeAppliedAt: null,
      processingBy: null,
      processingToken: null,
      processingExpiresAt: null,
    });
    return { ok: true };
  }

  failOutbox(
    record: OutboxRecord,
    reason: string,
    at: string,
  ): { ok: true } | { ok: false; reason: string } {
    const current = this.outbox.get(record.effectId);
    if (!current) return { ok: false, reason: "outbox_effect_not_found" };
    if (current.status !== record.status || current.receiptLevel !== record.receiptLevel) {
      return { ok: false, reason: "outbox_fail_stale_record" };
    }
    if (current.status === "processing" && current.processingToken !== record.processingToken) {
      return { ok: false, reason: "outbox_fail_claim_mismatch" };
    }
    if (current.outcomeAppliedAt != null || current.terminalAt != null || !["failed", "processing", "outcome_uncertain", "succeeded"].includes(current.status)) {
      return { ok: false, reason: "outbox_fail_transition_invalid" };
    }
    this.outbox.set(current.effectId, {
      ...current,
      status: "failed",
      lastError: reason,
      terminalAt: at,
      outcomeAppliedAt: null,
      processingBy: null,
      processingToken: null,
      processingExpiresAt: null,
    });
    return { ok: true };
  }

  commitOutboxOutcome(
    conversationId: Id,
    effectId: Id,
    expectedVersion: number,
    nextState: ConversationState | null,
    at: string,
  ): { ok: true; stateVersion: number; applied: boolean } | { ok: false; reason: string } {
    const record = this.outbox.get(effectId);
    if (!record || record.conversationId !== conversationId) {
      return { ok: false, reason: "outbox_effect_not_found" };
    }
    const snapshot = this.states.get(conversationId);
    if (!snapshot) return { ok: false, reason: "conversation_state_not_found" };
    if (record.outcomeAppliedAt != null) {
      return { ok: true, stateVersion: snapshot.version, applied: false };
    }
    // F2.7.4: aplica o outcome quando o receipt atinge o nivel EXIGIDO pelo record (accepted-safe -> accepted;
    // resto -> delivered). Alinhado com requiredReceiptFor / effect-outcome-commit.
    const requiredLevel = requiredReceiptFor(record);
    const levelMeets = requiredLevel === "accepted"
      ? (record.receiptLevel === "accepted" || record.receiptLevel === "delivered")
      : record.receiptLevel === "delivered";
    if (record.status !== "succeeded" || !levelMeets) {
      return { ok: false, reason: `outcome_requires_${requiredLevel}_success` };
    }
    if (snapshot.version !== expectedVersion) return { ok: false, reason: "outcome_cas_conflict" };

    let stateVersion = expectedVersion;
    if (record.onSuccess.length > 0) {
      if (!nextState) return { ok: false, reason: "outcome_next_state_required" };
      stateVersion = expectedVersion + 1;
      const persisted = structuredClone(nextState);
      persisted.version = stateVersion;
      persisted.updatedAt = at;
      this.states.set(conversationId, { state: persisted, version: stateVersion });
      this.history.push({ conversationId, version: stateVersion, state: structuredClone(persisted) });
    }

    this.outbox.set(effectId, {
      ...record,
      outcomeAppliedAt: at,
      terminalAt: at,
    });
    return { ok: true, stateVersion, applied: true };
  }

  // ── R13-D/1 (audit Codex): promoção accepted-safe da WorkingMemory. Recebe SÓ a WorkingMemory; carrega o estado
  //    ATUAL e atualiza SÓ workingMemory + appliedAcceptedEffectIds + version + updatedAt (preserva o resto).
  //    Idempotente (duplicado -> applied=false); conflito de versão -> applied=false. Ligado a send_media real.
  commitWorkingMemoryOutcome(conversationId: Id, effectId: Id, expectedVersion: number, nextWorkingMemory: PersistedWorkingMemory, at: string): { ok: true; applied: boolean; version: number } | { ok: false; reason: string } {
    const snapshot = this.states.get(conversationId);
    if (!snapshot) return { ok: false, reason: "wm_state_not_found" };
    const effect = this.outbox.get(effectId);
    if (!effect || effect.conversationId !== conversationId) return { ok: false, reason: "wm_effect_not_found" };
    if (effect.kind !== "send_media") return { ok: false, reason: "wm_effect_kind_invalid" };
    if (effect.status !== "succeeded" || (effect.receiptLevel !== "accepted" && effect.receiptLevel !== "delivered")) return { ok: false, reason: "wm_effect_not_accepted" };
    const current = snapshot.state;
    const applied = current.appliedAcceptedEffectIds ?? [];
    if (applied.includes(effectId)) return { ok: true, applied: false, version: snapshot.version };   // duplicado -> no-op
    if (snapshot.version !== expectedVersion) return { ok: true, applied: false, version: snapshot.version };  // CAS
    const version = expectedVersion + 1;
    const state = structuredClone(current);                                 // preserva byte-a-byte o resto do estado
    state.workingMemory = structuredClone(nextWorkingMemory);
    state.appliedAcceptedEffectIds = [...applied, effectId];
    state.version = version;
    state.updatedAt = at;
    this.states.set(conversationId, { state, version });
    this.history.push({ conversationId, version, state: structuredClone(state) });
    return { ok: true, applied: true, version };
  }

  // ── UnitOfWork (atômico, CAS) ─────────────────────────────────────────────
  begin(): SyncUnitOfWork {
    const store = this;
    let cas: StagedCas | null = null;
    const stEvents: TurnEventRecord[] = [];
    const stDecisions: { conversationId: Id; decision: TurnDecision }[] = [];
    const stOutbox: OutboxRecord[] = [];
    const stOutboxUpdates: OutboxRecord[] = [];
    const stInboxDone: Id[] = [];
    let stInboxDoneOwner: { claimedBy: string; turnId: Id } | null = null;
    let done = false;

    return {
      casState(conversationId, expectedVersion, nextState) { cas = { conversationId, expectedVersion, nextState }; },
      appendEvents(e) { stEvents.push(...e); },
      appendDecision(conversationId, decision) { stDecisions.push({ conversationId, decision }); },
      appendOutbox(records) { stOutbox.push(...records); },
      updateOutbox(record) { stOutboxUpdates.push(record); },
      markInboxDone(ids, claimedBy, turnId) { stInboxDone.push(...ids); stInboxDoneOwner = { claimedBy, turnId }; },
      commit() {
        if (done) return { ok: false, reason: "unit of work já commitado" };
        // ── VALIDAÇÃO (sem mutar): se algo falha, NADA é aplicado (tudo-ou-nada, Codex F2.0 #6) ──
        if (cas) {
          const existing = store.states.get(cas.conversationId);
          if (existing == null) { if (cas.expectedVersion !== 0) return { ok: false, reason: "CAS: estado novo exige expectedVersion=0" }; }
          else if (existing.version !== cas.expectedVersion) return { ok: false, reason: `CAS conflito: esperado ${cas.expectedVersion}, atual ${existing.version}` };
        }
        const idemSeen = new Set<Id>();
        for (const r of stOutbox) {
          if (store.outboxIdem.has(r.idempotencyKey) || idemSeen.has(r.idempotencyKey)) return { ok: false, reason: `idempotencyKey duplicado: ${r.idempotencyKey}` };
          idemSeen.add(r.idempotencyKey);
        }
        for (const id of stInboxDone) {
          const r = store.inbox.get(id);
          if (!r) return { ok: false, reason: `inbox inexistente: ${id}` };
          if (r.status !== "claimed") return { ok: false, reason: `inbox ${id} não está claimed (status ${r.status})` };
          if (stInboxDoneOwner && (r.claimedBy !== stInboxDoneOwner.claimedBy || r.turnId !== stInboxDoneOwner.turnId)) return { ok: false, reason: `inbox ${id} claimed por outro worker/turno` };
        }
        for (const r of stOutboxUpdates) {
          const original = store.outbox.get(r.effectId);
          if (!original) return { ok: false, reason: `updateOutbox: record com effectId ${r.effectId} não existe no outbox` };
          if (
            r.effectId !== original.effectId ||
            r.idempotencyKey !== original.idempotencyKey ||
            r.conversationId !== original.conversationId ||
            r.turnId !== original.turnId ||
            r.planId !== original.planId ||
            r.kind !== original.kind
          ) {
            return { ok: false, reason: `updateOutbox: tentativa de alterar campo imutável no record ${r.effectId}` };
          }
        }

        // ── APLICAÇÃO (só após tudo validar) ──
        if (cas) {
          const existing = store.states.get(cas.conversationId);
          const newVersion = (existing ? cas.expectedVersion : 0) + 1;
          const state = structuredClone(cas.nextState); (state as any).version = newVersion;
          store.states.set(cas.conversationId, { state, version: newVersion });
          store.history.push({ conversationId: cas.conversationId, version: newVersion, state: structuredClone(state) });
        }
        store.events.push(...stEvents);
        store.decisions.push(...stDecisions);
        for (const r of stOutbox) { store.outbox.set(r.effectId, r); store.outboxIdem.add(r.idempotencyKey); }
        for (const r of stOutboxUpdates) { store.outbox.set(r.effectId, structuredClone(r)); }
        for (const id of stInboxDone) { const r = store.inbox.get(id)!; r.status = "done"; }
        done = true;
        return { ok: true };
      },
    };
  }

  // ── acessores p/ teste (debug puro) ───────────────────────────────────────
  counts() {
    return { inbox: this.inbox.size, events: this.events.length, decisions: this.decisions.length, outbox: this.outbox.size, history: this.history.length, leases: this.leases.size };
  }
}
