// ============================================================================
// working-memory.ts — R13-S1 (REVISADO pós-auditoria Codex). Reducer + loader da WorkingMemory.
//
//  P0-1 autoridade temporal: applyDecisionWorkingMemoryMutations (commit) × applyEffectOutcomeToWorkingMemory
//       (só receipt). lastPhotoAction só pela 2ª; failed/outcome_uncertain não atualizam; accepted idempotente;
//       delivered posterior não reaplica; mismatch de effectId rejeita atomicamente.
//  P0-4 fonte única: funnel/selectedVehicle/lastOffer DERIVADOS do ConversationState (read-only) — nunca gravados.
//  P0-5 hardening: validação RUNTIME de todos os campos/enums/SlotName/IDs/ISO/arrays/limites (sem casts como
//       validação); malformado -> diagnóstico tipado + default seguro; turnId validado contra o turno autorizado;
//       slot nunca em known E declined (garantido pela derivação); rejeição ATÔMICA do lote inteiro.
//  P1-6 identidade estável: resolve/update de pergunta/compromisso por ID.
// ============================================================================
import type {
  PersistedWorkingMemory, WorkingMemoryV1, WorkingMemoryReducerResult, WorkingMemoryRejection,
  WorkingMemoryLoadDiagnostic, CanonicalWorkingMemoryView,
  DecisionWorkingMemoryMutation, SystemWorkingMemoryMutation, EffectOutcomeWorkingMemoryMutation,
  PhotoActionMemory, PhotoActionDraft, UnansweredQuestion, Commitment, ToolResultMemory, ActiveTopic, LeadIntent,
  AgentActionMemory, AnsweredQuestionMemory, PendingAgentQuestionMemory, ResolvedSlotAnswerMemory,
} from "../domain/agent-brain.ts";
import {
  WORKING_MEMORY_SCHEMA_VERSION, TOPIC_ORIGINS, LEAD_INTENT_KINDS, QUESTION_KINDS, COMMITMENT_STATUSES, AGENT_ACTION_KINDS,
  createInitialPersistedWorkingMemory,
} from "../domain/agent-brain.ts";
export { createInitialPersistedWorkingMemory };
import type { AgentToolObservation, ToolTelemetry } from "../domain/agent-brain.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type { SlotName } from "../domain/types.ts";
import type { EffectResult, QueryResult } from "../domain/decision.ts";

const MAX_TOOL_RESULTS = 8;
const MAX_UNANSWERED = 8;
const MAX_COMMITMENTS = 8;
const SLOT_NAMES: ReadonlySet<string> = new Set<SlotName>([
  "nome", "interesse", "tipoVeiculo", "faixaPreco", "formaPagamento", "entrada", "possuiTroca", "diaHorario",
  "cpf", "parcelaDesejada", "veiculoTroca", "cidade", "conheceLoja", "interesseVisita",
]);

// ── Validadores runtime PUROS (P0-5) — nunca usam cast como validação ────────────────────────────────────────
const isStr = (v: unknown): v is string => typeof v === "string";
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && Number.isFinite(Date.parse(v));
const isConfidence = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const inEnum = <T extends string>(v: unknown, set: readonly T[]): v is T => typeof v === "string" && (set as readonly string[]).includes(v);
const isSlot = (v: unknown): v is SlotName => typeof v === "string" && SLOT_NAMES.has(v);
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);
const slotArray = (v: unknown): SlotName[] => (Array.isArray(v) ? [...new Set(v.filter(isSlot))] : []);

export function isValidPhotoActionDraft(v: unknown): v is PhotoActionDraft {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return isNonEmpty(a.vehicleKey) && isNonEmpty(a.label) && isNonEmpty(a.effectId)
    && isNonEmpty(a.sourceTurnId) && typeof a.sourceTurnNumber === "number" && Number.isFinite(a.sourceTurnNumber) && a.sourceTurnNumber >= 0
    && Array.isArray(a.photoIds) && a.photoIds.length > 0 && a.photoIds.every(isNonEmpty);
}
export function isValidPhotoAction(v: unknown): v is PhotoActionMemory {
  return isValidPhotoActionDraft(v) && isIso((v as Record<string, unknown>).acceptedAt);
}
// Correção 3 (Codex): consistência open⟺resolvedTurnId=null; answered/fulfilled/cancelled⟺resolvedTurnId não-nulo.
function validUnanswered(v: unknown): v is UnansweredQuestion {
  if (!v || typeof v !== "object") return false;
  const q = v as Record<string, unknown>;
  if (!(isNonEmpty(q.id) && isNonEmpty(q.text) && inEnum(q.kind, QUESTION_KINDS) && isNonEmpty(q.createdTurnId))) return false;
  if (q.status === "open") return q.resolvedTurnId === null;
  if (q.status === "answered") return isNonEmpty(q.resolvedTurnId);
  return false;
}
function validCommitment(v: unknown): v is Commitment {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  if (!(isNonEmpty(c.id) && isNonEmpty(c.text) && inEnum(c.status, COMMITMENT_STATUSES) && isNonEmpty(c.createdTurnId))) return false;
  if (c.status === "open") return c.resolvedTurnId === null;
  return isNonEmpty(c.resolvedTurnId); // fulfilled/cancelled exigem resolvedTurnId
}
function validToolResult(v: unknown): v is ToolResultMemory {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return isNonEmpty(t.tool) && inEnum(t.status, ["ok", "not_found", "error"] as const) && isNonEmpty(t.turnId)
    && (t.itemCount === undefined || (typeof t.itemCount === "number" && Number.isFinite(t.itemCount)))
    && (t.factKeys === undefined || (Array.isArray(t.factKeys) && t.factKeys.every(isNonEmpty)));
}
function validActiveTopic(v: unknown): v is ActiveTopic {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return isNonEmpty(t.topic) && isNonEmpty(t.sinceTurnId) && inEnum(t.origin, TOPIC_ORIGINS);
}
function validLeadIntent(v: unknown): v is LeadIntent {
  if (!v || typeof v !== "object") return false;
  const i = v as Record<string, unknown>;
  return inEnum(i.intent, LEAD_INTENT_KINDS) && isConfidence(i.confidence) && Array.isArray(i.evidence) && i.evidence.every(isStr);
}
function validAgentAction(v: unknown): v is AgentActionMemory {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return inEnum(a.kind, AGENT_ACTION_KINDS) && isNonEmpty(a.turnId);
}
// ⭐SEM: validacao dos campos de pergunta pendente/resposta resolvida (infra do engine).
function validPendingAgentQuestion(v: unknown): v is PendingAgentQuestionMemory {
  if (!v || typeof v !== "object") return false;
  const q = v as Record<string, unknown>;
  return isNonEmpty(q.slot) && isNonEmpty(q.sinceTurnId);
}
function validResolvedSlotAnswer(v: unknown): v is ResolvedSlotAnswerMemory {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return isNonEmpty(a.slot) && isNonEmpty(a.turnId);
}
function validAnswered(v: unknown): v is AnsweredQuestionMemory {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return isNonEmpty(a.question) && isStr(a.answerSummary) && isNonEmpty(a.turnId);
}

// ── Loader fail-closed (P0-5) — createInitialPersistedWorkingMemory vem do domínio (re-exportado acima) ───────
// Carrega SÓ a parte persistida (WM-owned). Cada campo é validado; inválido -> default seguro + diagnóstico
// (fail-closed, nunca injeta dado inválido — P0-5). JSONB malformado NUNCA vira SlotName/intent/veículo/etc.
export function loadPersistedWorkingMemory(raw: unknown): { memory: PersistedWorkingMemory; diagnostics: WorkingMemoryLoadDiagnostic[] } {
  const base = createInitialPersistedWorkingMemory();
  const diag: WorkingMemoryLoadDiagnostic[] = [];
  if (raw == null || typeof raw !== "object") { if (raw != null) diag.push({ field: "root", reason: "não é objeto" }); return { memory: base, diagnostics: diag }; }
  const r = raw as Record<string, unknown>;
  // A.4 (Codex): schema FUTURO/desconhecido -> FAIL-CLOSED (nunca reinterpreta silenciosamente). Ausente/0/1 ->
  // migração explícita para V1 (segue validando campo a campo abaixo).
  const sv = r.schemaVersion;
  if (typeof sv === "number" && sv > WORKING_MEMORY_SCHEMA_VERSION) {
    return { memory: base, diagnostics: [{ field: "schemaVersion", reason: `schema futuro/desconhecido ${sv} > ${WORKING_MEMORY_SCHEMA_VERSION} (fail-closed)` }] };
  }
  if (sv != null && typeof sv !== "number") diag.push({ field: "schemaVersion", reason: "tipo inválido; migrando p/ V1" });
  const keepArr = <T>(v: unknown, ok: (x: unknown) => x is T, field: string, cap: number): readonly T[] => {
    if (!Array.isArray(v)) { if (v != null) diag.push({ field, reason: "não é array" }); return []; }
    const good: T[] = []; for (const it of v) { if (ok(it)) good.push(it); else diag.push({ field, reason: "item inválido descartado" }); }
    return good.slice(-cap);
  };
  return {
    memory: {
      schemaVersion: WORKING_MEMORY_SCHEMA_VERSION,
      activeTopic: validActiveTopic(r.activeTopic) ? r.activeTopic : (r.activeTopic != null ? (diag.push({ field: "activeTopic", reason: "inválido" }), null) : null),
      currentLeadIntent: validLeadIntent(r.currentLeadIntent) ? r.currentLeadIntent : (r.currentLeadIntent != null ? (diag.push({ field: "currentLeadIntent", reason: "inválido" }), null) : null),
      unansweredLeadQuestions: keepArr(r.unansweredLeadQuestions, validUnanswered, "unansweredLeadQuestions", MAX_UNANSWERED),
      lastPhotoAction: isValidPhotoAction(r.lastPhotoAction) ? r.lastPhotoAction : (r.lastPhotoAction != null ? (diag.push({ field: "lastPhotoAction", reason: "inválido" }), null) : null),
      lastToolResults: keepArr(r.lastToolResults, validToolResult, "lastToolResults", MAX_TOOL_RESULTS),
      commitments: keepArr(r.commitments, validCommitment, "commitments", MAX_COMMITMENTS),
      conversationSummary: isStr(r.conversationSummary) ? r.conversationSummary.slice(0, 1200) : "",
      lastAgentAction: validAgentAction(r.lastAgentAction) ? r.lastAgentAction : null,
      lastAnsweredLeadQuestion: validAnswered(r.lastAnsweredLeadQuestion) ? r.lastAnsweredLeadQuestion : null,
      pendingAgentQuestion: validPendingAgentQuestion(r.pendingAgentQuestion) ? r.pendingAgentQuestion : (r.pendingAgentQuestion != null ? (diag.push({ field: "pendingAgentQuestion", reason: "invalido" }), null) : null),
      lastResolvedSlotAnswer: validResolvedSlotAnswer(r.lastResolvedSlotAnswer) ? r.lastResolvedSlotAnswer : (r.lastResolvedSlotAnswer != null ? (diag.push({ field: "lastResolvedSlotAnswer", reason: "invalido" }), null) : null),
    },
    diagnostics: diag,
  };
}

// ── Derivação CANÔNICA read-only do ConversationState (P0-4) — nunca gravável ────────────────────────────────
export function deriveCanonicalViews(state: ConversationState): CanonicalWorkingMemoryView {
  const slots = state.slots as Record<string, { status?: string } | undefined>;
  const known: SlotName[] = []; const declined: SlotName[] = [];
  for (const name of SLOT_NAMES) {
    const st = slots[name]?.status;
    if (st === "known") known.push(name as SlotName);
    else if (st === "declined") declined.push(name as SlotName);   // known XOR declined por construção (1 status/slot)
  }
  const obj = state.currentObjective;
  const pendingSlot = obj?.status === "pending" && obj.slot ? (obj.slot as SlotName) : null;
  const deferred: SlotName[] = pendingSlot && (obj?.deferrals ?? 0) > 0 ? [pendingSlot] : [];
  const sel = state.vehicleContext?.selected;
  const offer = state.lastRenderedOfferContext;
  return {
    funnel: { known, declined, deferred, suggestedObjective: pendingSlot },
    selectedVehicle: sel?.key ? { vehicleKey: sel.key, label: sel.label ?? sel.key } : null,
    lastOffer: offer && offer.items.length > 0 ? { vehicleKeys: offer.items.map((i) => i.vehicleKey), turnId: offer.sourceTurnId } : null,
  };
}

// Visão completa que o cérebro recebe = persistido (validado) + view canônica derivada (read-only).
export function buildWorkingMemory(state: ConversationState, rawPersisted: unknown): { memory: WorkingMemoryV1; diagnostics: WorkingMemoryLoadDiagnostic[] } {
  const { memory, diagnostics } = loadPersistedWorkingMemory(rawPersisted);
  return { memory: { ...memory, ...deriveCanonicalViews(state) }, diagnostics };
}

// ── Reducer de DECISÃO (commit) — ATÔMICO (P0-5): valida o lote todo; qualquer inválida rejeita tudo ──────────
export function applyDecisionWorkingMemoryMutations(
  memory: PersistedWorkingMemory,
  mutations: readonly DecisionWorkingMemoryMutation[],
  opts: { readonly authorizedTurnId: string },
): WorkingMemoryReducerResult {
  const turn = opts.authorizedTurnId;
  const rejected: WorkingMemoryRejection[] = [];
  // Passo 1: validação ESTRUTURAL (sem estado) — turnId contra o turno autorizado, enums, IDs, não-vazios.
  for (const m of mutations) {
    const bad = (reason: string): void => { rejected.push({ mutation: m, reason }); };
    switch (m.op) {
      case "set_active_topic": if (!isNonEmpty(m.topic)) bad("topic vazio"); else if (!inEnum(m.origin, TOPIC_ORIGINS)) bad("origin inválida"); else if (m.turnId !== turn) bad("turnId != turno autorizado"); break;
      case "set_lead_intent": if (!inEnum(m.intent, LEAD_INTENT_KINDS)) bad("intent inválido"); else if (!isConfidence(m.confidence)) bad("confidence fora de [0,1]"); else if (m.turnId !== turn) bad("turnId != turno autorizado"); break; // A.3
      case "add_unanswered_question": if (!validUnanswered(m.question)) bad("question inválida"); else if (m.question.createdTurnId !== turn) bad("createdTurnId != turno"); else if (m.question.status !== "open" || m.question.resolvedTurnId !== null) bad("nova pergunta deve nascer open/não-resolvida"); break;
      case "resolve_unanswered_question": if (!isNonEmpty(m.id)) bad("id vazio"); else if (m.resolvedTurnId !== turn) bad("resolvedTurnId != turno"); break;
      case "add_commitment": if (!validCommitment(m.commitment)) bad("commitment inválido"); else if (m.commitment.createdTurnId !== turn) bad("createdTurnId != turno"); break;
      case "update_commitment": if (!isNonEmpty(m.id)) bad("id vazio"); else if (!inEnum(m.status, COMMITMENT_STATUSES)) bad("status inválido"); else if (m.resolvedTurnId !== turn) bad("resolvedTurnId != turno"); break;
      case "set_conversation_summary": if (!isStr(m.summary)) bad("summary não é string"); else if (m.turnId !== turn) bad("turnId != turno"); break;
      case "set_last_agent_action": if (!validAgentAction(m.action)) bad("agent action inválida"); else if (m.action.turnId !== turn) bad("turnId != turno"); break;
      case "set_last_answered_question": if (!validAnswered(m.answered)) bad("answered inválido"); else if (m.answered.turnId !== turn) bad("turnId != turno"); break;
      default: bad("op desconhecida");
    }
  }
  if (rejected.length > 0) return { ok: false, rejected };

  // Passo 2: aplica sequencialmente numa cópia; resolve/update por ID que não existe rejeita o lote (atômico).
  let next: PersistedWorkingMemory = memory;
  for (const m of mutations) {
    switch (m.op) {
      case "set_active_topic": next = { ...next, activeTopic: { topic: m.topic.trim(), sinceTurnId: m.turnId, origin: m.origin } }; break;
      case "set_lead_intent": next = { ...next, currentLeadIntent: { intent: m.intent, confidence: m.confidence, evidence: m.evidence.slice(0, 6) } }; break;
      case "add_unanswered_question": {
        if (next.unansweredLeadQuestions.some((q) => q.id === m.question.id)) break; // idempotente por id
        next = { ...next, unansweredLeadQuestions: [...next.unansweredLeadQuestions, m.question].slice(-MAX_UNANSWERED) };
        break;
      }
      case "resolve_unanswered_question": {
        if (!next.unansweredLeadQuestions.some((q) => q.id === m.id)) return { ok: false, rejected: [{ mutation: m, reason: `pergunta id '${m.id}' inexistente` }] };
        next = { ...next, unansweredLeadQuestions: next.unansweredLeadQuestions.map((q) => (q.id === m.id ? { ...q, status: "answered", resolvedTurnId: m.resolvedTurnId } : q)) };
        break;
      }
      case "add_commitment": {
        if (next.commitments.some((c) => c.id === m.commitment.id)) break;
        next = { ...next, commitments: [...next.commitments, m.commitment].slice(-MAX_COMMITMENTS) };
        break;
      }
      case "update_commitment": {
        if (!next.commitments.some((c) => c.id === m.id)) return { ok: false, rejected: [{ mutation: m, reason: `commitment id '${m.id}' inexistente` }] };
        next = { ...next, commitments: next.commitments.map((c) => (c.id === m.id ? { ...c, status: m.status, resolvedTurnId: m.resolvedTurnId } : c)) };
        break;
      }
      case "set_conversation_summary": next = { ...next, conversationSummary: m.summary.slice(0, 1200) }; break;
      case "set_last_agent_action": next = { ...next, lastAgentAction: m.action }; break;
      case "set_last_answered_question": next = { ...next, lastAnsweredLeadQuestion: m.answered }; break;
    }
  }
  return { ok: true, next };
}

// ── Reducer de SISTEMA (A.2) — aplicado SÓ pelo ENGINE, com o resultado REAL de uma tool executada+autorizada.
//    A LLM não propõe isto. Sanitização/limite ANTES de persistir. ATÔMICO; turnId validado.
export function applySystemWorkingMemoryMutations(
  memory: PersistedWorkingMemory,
  mutations: readonly SystemWorkingMemoryMutation[],
  opts: { readonly authorizedTurnId: string },
): WorkingMemoryReducerResult {
  const rejected: WorkingMemoryRejection[] = [];
  for (const m of mutations) {
    if (m.op === "record_tool_result") {
      if (!validToolResult(m.result)) rejected.push({ mutation: m, reason: "tool result invalido" });
      else if (m.result.turnId !== opts.authorizedTurnId) rejected.push({ mutation: m, reason: "turnId != turno autorizado" });
    } else if (m.op === "set_pending_agent_question") {
      if (m.turnId !== opts.authorizedTurnId) rejected.push({ mutation: m, reason: "turnId != turno autorizado" });
      else if (m.question != null && !validPendingAgentQuestion(m.question)) rejected.push({ mutation: m, reason: "pending question invalida" });
    } else if (m.op === "set_resolved_slot_answer") {
      if (m.turnId !== opts.authorizedTurnId) rejected.push({ mutation: m, reason: "turnId != turno autorizado" });
      else if (!validResolvedSlotAnswer(m.answer)) rejected.push({ mutation: m, reason: "resolved answer invalida" });
    } else if (m.op === "reconcile_turn_semantics") {
      if (m.turnId !== opts.authorizedTurnId) rejected.push({ mutation: m, reason: "turnId != turno autorizado" });
      else if (m.intent != null && !inEnum(m.intent, LEAD_INTENT_KINDS)) rejected.push({ mutation: m, reason: "intent invalido" });
    } else rejected.push({ mutation: m, reason: "op de sistema desconhecida" });
  }
  if (rejected.length > 0) return { ok: false, rejected };
  let next = memory;
  for (const m of mutations) {
    if (m.op === "record_tool_result") {
      const safe: ToolResultMemory = { tool: m.result.tool, status: m.result.status, turnId: m.result.turnId,
        ...(m.result.itemCount !== undefined ? { itemCount: m.result.itemCount } : {}),
        ...(m.result.factKeys ? { factKeys: m.result.factKeys.slice(0, 12) } : {}) };
      next = { ...next, lastToolResults: [...next.lastToolResults, safe].slice(-MAX_TOOL_RESULTS) };
    } else if (m.op === "set_pending_agent_question") {
      next = { ...next, pendingAgentQuestion: m.question };
    } else if (m.op === "set_resolved_slot_answer") {
      next = { ...next, lastResolvedSlotAnswer: m.answer };
    } else if (m.op === "reconcile_turn_semantics") {
      // ⭐SEM inv.4: reflete o entendimento ACEITO na memoria viva - SEM sobrescrever escolha da LLM (o caller
      // so emite quando a LLM nao setou topic/intent neste turno). Origem "lead_message" (a fonte real do turno).
      if (m.topic != null && m.topic.trim() !== "") next = { ...next, activeTopic: { topic: m.topic.trim(), sinceTurnId: m.turnId, origin: "lead_message" } };
      if (m.intent != null) next = { ...next, currentLeadIntent: { intent: m.intent, confidence: 0.7, evidence: [] } };
    }
  }
  return { ok: true, next };
}

// Correção 2 (Codex): o ENGINE constrói a ToolResultMemory SANITIZADA a partir do QueryResult — nunca summary
// livre. CRM não persiste nome/PII; erro vira só status (sem URL/token/corpo externo).
export function toToolResultMemory(result: QueryResult, turnId: string): ToolResultMemory {
  if (!result.ok) return { tool: result.tool, status: result.error.code === "NOT_FOUND" ? "not_found" : "error", turnId };
  switch (result.tool) {
    case "stock_search": return { tool: "stock_search", status: result.data.items.length > 0 ? "ok" : "not_found", turnId, itemCount: result.data.items.length, factKeys: result.data.items.slice(0, 12).map((v) => v.vehicleKey) };
    case "vehicle_details": return { tool: "vehicle_details", status: "ok", turnId, factKeys: [result.data.vehicle.vehicleKey] };
    case "vehicle_photos_resolve": return { tool: "vehicle_photos_resolve", status: result.data.photoIds.length > 0 ? "ok" : "not_found", turnId, itemCount: result.data.photoIds.length, factKeys: [result.data.vehicleKey] };
    case "crm_read": return { tool: "crm_read", status: "ok", turnId }; // NUNCA nome/telefone/CPF/payload
    case "knowledge_search": return { tool: "knowledge_search", status: result.data.chunks.length > 0 ? "ok" : "not_found", turnId, itemCount: result.data.chunks.length };
  }
}

// ── Reducer de OUTCOME (só EffectOutcomeCommit) — accepted-safe, timestamp DO RECEIPT, newer-wins, idempotente ─
// A.1 (Codex): acceptedAt vem EXCLUSIVAMENTE de result.receipt.at; triple-check effectId; receipt antigo nunca
// sobrescreve a ação mais recente (A→B→callback atrasado A mantém B); duplicado do mesmo effectId é no-op;
// failed/outcome_uncertain não alteram a memória.
export function applyEffectOutcomeToWorkingMemory(
  memory: PersistedWorkingMemory,
  mutation: EffectOutcomeWorkingMemoryMutation,
  result: EffectResult,
): WorkingMemoryReducerResult {
  if (mutation.op !== "mark_photo_action_accepted") return { ok: false, rejected: [{ mutation, reason: "outcome op desconhecida" }] };
  const draft = mutation.action;
  if (!isValidPhotoActionDraft(draft)) return { ok: false, rejected: [{ mutation, reason: "photo action draft inválido" }] };
  if (draft.effectId !== result.effectId) return { ok: false, rejected: [{ mutation, reason: `effectId da ação (${draft.effectId}) != result (${result.effectId})` }] };
  if (result.status !== "succeeded") return { ok: true, next: memory }; // failed/outcome_uncertain não atualizam
  if (result.effectId !== result.receipt.effectId) return { ok: false, rejected: [{ mutation, reason: `result.effectId (${result.effectId}) != receipt.effectId (${result.receipt.effectId})` }] };
  if (result.receipt.level !== "accepted" && result.receipt.level !== "delivered") return { ok: true, next: memory };
  if (!isIso(result.receipt.at)) return { ok: false, rejected: [{ mutation, reason: "receipt.at não é ISO" }] };
  const current = memory.lastPhotoAction;
  if (current) {
    if (current.effectId === draft.effectId) return { ok: true, next: memory }; // duplicado do MESMO efeito -> no-op
    // Correção 1 (Codex): RECÊNCIA por sourceTurnNumber (turno da ação conversacional), NÃO pelo receipt.at.
    if (current.sourceTurnNumber > draft.sourceTurnNumber) return { ok: true, next: memory }; // ação atual mais recente -> ignora callback de turno anterior
    if (current.sourceTurnNumber === draft.sourceTurnNumber) return { ok: false, rejected: [{ mutation, reason: `mesmo sourceTurnNumber (${draft.sourceTurnNumber}) com effectId diferente — fail-closed` }] };
  }
  const stored: PhotoActionMemory = { ...draft, acceptedAt: result.receipt.at }; // acceptedAt = receipt.at (A.1)
  return { ok: true, next: { ...memory, lastPhotoAction: stored } };
}

// ── Observação factual × telemetria (P0-3) — a partir do QueryResult canônico ───────────────────────────────
// AgentToolObservation = FATO estruturado que o cérebro usa p/ decidir (transitório; pode conter nome do CRM,
// mas NÃO é persistido cru na memória — só um summary sanitizado entra em ToolResultMemory). NUNCA é texto ao lead.
export function toAgentObservation(result: QueryResult): AgentToolObservation {
  if (!result.ok) return { tool: result.tool, ok: false, error: { code: result.error.code, message: result.error.message } };
  switch (result.tool) {
    case "stock_search": return { tool: "stock_search", ok: true, data: result.data };
    case "vehicle_details": return { tool: "vehicle_details", ok: true, data: result.data };
    case "vehicle_photos_resolve": return { tool: "vehicle_photos_resolve", ok: true, data: result.data };
    case "crm_read": return { tool: "crm_read", ok: true, data: result.data };
    case "knowledge_search": return { tool: "knowledge_search", ok: true, data: result.data };
  }
}
// Telemetria SANITIZADA (log/trace): só metadados — NUNCA nome/PII/payload bruto/segredo.
export function toToolTelemetry(result: QueryResult, ms: number): ToolTelemetry {
  const base: ToolTelemetry = { tool: result.tool, ok: result.ok, ms };
  if (result.ok && result.tool === "stock_search") return { ...base, itemCount: result.data.items.length, keys: result.data.items.slice(0, 12).map((v) => v.vehicleKey) };
  if (result.ok && result.tool === "vehicle_photos_resolve") return { ...base, itemCount: result.data.photoIds.length, keys: [result.data.vehicleKey] };
  if (result.ok && result.tool === "vehicle_details") return { ...base, keys: [result.data.vehicle.vehicleKey] };
  return base; // crm_read: sem nome/PII na telemetria (fica só na observação transitória)
}

// ── Seletores puros ─────────────────────────────────────────────────────────────────────────────────────────
export function recallLastPhotoLabel(memory: PersistedWorkingMemory): string | null {
  return memory.lastPhotoAction?.label ?? null;
}
export function hasUnansweredInstitutional(memory: PersistedWorkingMemory): boolean {
  return memory.unansweredLeadQuestions.some((q) => q.status === "open" && q.kind === "institutional");
}
