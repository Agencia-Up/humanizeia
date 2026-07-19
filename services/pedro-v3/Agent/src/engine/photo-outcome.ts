// ============================================================================
// photo-outcome.ts — promoção/reconciliação accepted-safe da mídia.
//
// Este módulo é deliberadamente separado do loop central: o efeito de mídia já
// foi decidido e despachado. Aqui só promovemos um receipt aceito para a
// WorkingMemory, com CAS e idempotência. Não há decisão comercial nem texto.
// ============================================================================
import type { Persistence, WorkingMemoryOutcomeStore } from "../domain/ports.ts";
import type { EffectResult } from "../domain/decision.ts";
import type { PersistedWorkingMemory } from "../domain/agent-brain.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import {
  applyEffectOutcomeToWorkingMemory,
  loadPersistedWorkingMemory,
} from "./working-memory.ts";

// B item 2 — Outcome ACCEPTED da ação de foto: promove
// pendingPhotoActions[effectId] -> WorkingMemory.lastPhotoAction.
// accepted/delivered atualiza lastPhotoAction; não toca photoLedger, que é
// responsabilidade do commitEffectOutcome no nível delivered.
export async function applyAcceptedPhotoActionOutcome(args: {
  readonly persistence: Persistence;
  readonly conversationId: string;
  readonly effectId: string;
  readonly result: EffectResult;
  readonly maxCasRetries?: number;
}): Promise<{ ok: true; applied: boolean } | { ok: false; reason: string }> {
  const { persistence, conversationId, effectId, result } = args;
  if (result.effectId !== effectId) return { ok: false, reason: `effectId mismatch (${result.effectId} != ${effectId})` };
  if (result.status !== "succeeded") return { ok: true, applied: false };
  if (result.receipt.level !== "accepted" && result.receipt.level !== "delivered") return { ok: true, applied: false };
  const retries = args.maxCasRetries ?? 3;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const snapshot = await persistence.load(conversationId);
    if (!snapshot) return { ok: false, reason: "state_not_found" };
    const state = snapshot.state;
    const alreadyApplied = state.appliedAcceptedEffectIds ?? [];
    if (alreadyApplied.includes(effectId)) return { ok: true, applied: false };
    const draft = state.pendingPhotoActions?.[effectId];
    if (!draft) return { ok: true, applied: false };
    const persisted: PersistedWorkingMemory = loadPersistedWorkingMemory(state.workingMemory).memory;
    const red = applyEffectOutcomeToWorkingMemory(persisted, { op: "mark_photo_action_accepted", action: draft }, result);
    if (!red.ok) return { ok: false, reason: red.rejected.map((r) => r.reason).join("; ") };

    // Fail closed: a receipt promotion must update only WorkingMemory through
    // the dedicated persistence capability, never overwrite ConversationState.
    const wmStore = persistence as Partial<WorkingMemoryOutcomeStore>;
    if (typeof wmStore.commitWorkingMemoryOutcome !== "function") return { ok: false, reason: "persistence_missing_working_memory_outcome" };
    const c = await wmStore.commitWorkingMemoryOutcome(conversationId, effectId, snapshot.version, red.next, result.receipt.at);
    if (c.ok && c.applied) return { ok: true, applied: true };
    if (!c.ok) return { ok: false, reason: c.reason };
    // applied=false: duplicate or version conflict. Reload and retry; the
    // already-applied marker makes the operation idempotent.
  }
  return { ok: false, reason: "cas_retries_exhausted" };
}

// R13-D/4 — reconciliação durável da promoção accepted-safe. Reprocessa apenas
// send_media já sucedido, não promovido e com pendingPhotoAction rastreada.
export async function reconcileAcceptedPhotoOutcomes(args: {
  readonly persistence: Persistence;
  readonly conversationId: string;
}): Promise<{ reconciled: number; failed: number; pending: number }> {
  const { persistence, conversationId } = args;
  const snapshot = await persistence.load(conversationId);
  if (!snapshot) return { reconciled: 0, failed: 0, pending: 0 };
  const applied = new Set(snapshot.state.appliedAcceptedEffectIds ?? []);
  const drafts = snapshot.state.pendingPhotoActions ?? {};
  const outbox = await persistence.listOutbox(conversationId);
  let reconciled = 0, failed = 0, pending = 0;
  for (const rec of outbox) {
    if (rec.kind !== "send_media" || rec.status !== "succeeded") continue;
    if (rec.receiptLevel !== "accepted" && rec.receiptLevel !== "delivered") continue;
    if (applied.has(rec.effectId)) continue;
    if (!drafts[rec.effectId]) continue;
    pending += 1;
    const pr = rec.providerReceipt;
    const receiptAt = (pr && typeof pr === "object" && !Array.isArray(pr) && typeof (pr as { at?: unknown }).at === "string")
      ? (pr as { at: string }).at : (rec.terminalAt ?? rec.createdAt);
    const result: EffectResult = {
      status: "succeeded",
      effectId: rec.effectId,
      receipt: { effectId: rec.effectId, level: rec.receiptLevel, at: receiptAt },
    };
    const r = await applyAcceptedPhotoActionOutcome({ persistence, conversationId, effectId: rec.effectId, result });
    if (r.ok && r.applied) reconciled += 1;
    else if (!r.ok) failed += 1;
  }
  return { reconciled, failed, pending };
}
