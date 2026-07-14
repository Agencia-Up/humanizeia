import type { AgentBrainPort, AgentBrainStep, TurnFrame } from "../src/domain/agent-brain.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import type { SendMessagePlan, TurnDecision } from "../src/domain/decision.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { resolveAutomationRules } from "../src/engine/automation-rules.ts";
import { evaluateFollowupDue } from "../src/engine/followup-policy.ts";
import { authorFollowupMessage } from "../src/engine/followup-author.ts";
import { buildHandoffChain } from "../src/engine/handoff-plan.ts";
import { validateEffectPlans } from "../src/engine/finalizer.ts";
import { applyEffectOutcome } from "../src/engine/state-reducer.ts";
import { requiredReceiptFor } from "../src/domain/effect-policy.ts";
import { HandoffEffectDispatcher, NotifySellerEffectDispatcher } from "../src/adapters/effects/transfer-dispatchers.ts";
import type { InsertTransferInput, TransferAgentConfig, TransferLeadRow, TransferRow, TransferSagaStore } from "../src/adapters/effects/transfer-store.ts";
import type { SellerCandidate } from "../src/engine/transfer-templates.ts";

let ok = 0; let bad = 0;
function check(name: string, pass: boolean): void { if (pass) { ok++; console.log(`  OK  ${name}`); } else { bad++; console.error(`  RED ${name}`); } }
const NOW = "2026-07-11T12:15:00.000Z", ANCHOR = "2026-07-11T12:00:00.000Z";
const TENANT = "11111111-1111-4111-8111-111111111111", AGENT = "22222222-2222-4222-8222-222222222222", LEAD = "33333333-3333-4333-8333-333333333333";

function record(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return { effectId: "turn-1:message", conversationId: "wa:test", turnId: "turn-1", planId: "message", kind: "send_message", idempotencyKey: "turn-1:message", order: 1, dependsOn: [], payload: { text: "Oi", __redacted: true }, onSuccess: [], status: "succeeded", providerCapability: "none", receiptLevel: "delivered", attempts: 1, nextRetryAt: null, providerReceipt: null, outcomeAppliedAt: ANCHOR, lastError: null, createdAt: ANCHOR, dispatchedAt: ANCHOR, ...overrides };
}
function state() { return createInitialState({ conversationId: "wa:test", tenantId: TENANT, agentId: AGENT, leadId: LEAD, now: "2026-07-11T11:59:00.000Z" }); }
function final(text: string, effects: any[] = []): AgentBrainStep { return { kind: "final", decision: { reasonCode: "followup", reasonSummary: "followup", confidence: 1, responsePlan: { guidance: "", draft: { parts: [{ type: "text", content: text }] } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } }; }
class QueueBrain implements AgentBrainPort {
  frames: TurnFrame[] = [];
  constructor(private readonly steps: AgentBrainStep[]) {}
  async proposeNextStep(frame: TurnFrame): Promise<AgentBrainStep> { this.frames.push(frame); return this.steps.shift() ?? final("Ainda posso te ajudar?"); }
}

console.log("== F2.49 Handoff + Follow-up LLM-first ==");
const rules = resolveAutomationRules({ followup: { enabled: true, t1_min: 5, t2_min: 8, t3_min: 12, t3_transfers: true }, transfer: { enabled: true, seller_response_min: 10 } });
check("[R1] T1=5", rules.followup.t1Min === 5); check("[R2] T2=8", rules.followup.t2Min === 8); check("[R3] T3=12", rules.followup.t3Min === 12); check("[R4] T3 transfere", rules.followup.t3Transfers); check("[R5] seller timeout=10", rules.transfer.sellerResponseMin === 10);

const s = state(), anchor = record();
check("[P1] T1 vence", evaluateFollowupDue({ state: s, outbox: [anchor], rules: rules.followup, now: "2026-07-11T12:05:00.000Z" })?.stage === 1);
s.followupCycle = { anchorEffectId: anchor.effectId, anchorAt: ANCHOR, sentStages: [1], plannedStage: null, lastSentAt: "2026-07-11T12:05:00.000Z" };
check("[P2] T2 vence", evaluateFollowupDue({ state: s, outbox: [anchor], rules: rules.followup, now: "2026-07-11T12:08:00.000Z" })?.stage === 2);
s.followupCycle = { ...s.followupCycle, sentStages: [1, 2] };
const due3 = evaluateFollowupDue({ state: s, outbox: [anchor], rules: rules.followup, now: NOW });
check("[P3] T3 vence", due3?.stage === 3);
check("[P4] accepted ancora quando provider nao publica delivery", evaluateFollowupDue({ state: state(), outbox: [record({ receiptLevel: "accepted" })], rules: rules.followup, now: NOW })?.stage === 1);
const sameTick = state(); sameTick.recentTurns.push({ role: "lead", text: "tem sedan?", at: ANCHOR });
check("[P4b] lead e resposta no mesmo timestamp permitem T1", evaluateFollowupDue({ state: sameTick, outbox: [anchor], rules: rules.followup, now: NOW })?.stage === 1);
const spoke = state(); spoke.recentTurns.push({ role: "lead", text: "voltei", at: "2026-07-11T12:01:00.000Z" });
check("[P5] lead cancela", evaluateFollowupDue({ state: spoke, outbox: [anchor], rules: rules.followup, now: NOW }) === null);
const handed = state(); handed.stage = "handoff";
check("[P6] handoff cancela", evaluateFollowupDue({ state: handed, outbox: [anchor], rules: rules.followup, now: NOW }) === null);
check("[P7] pending dedup", evaluateFollowupDue({ state: state(), outbox: [anchor, record({ effectId: `followup:${anchor.effectId}:1`, status: "pending", receiptLevel: null })], rules: rules.followup, now: NOW }) === null);
check("[P8] followup nao ancora", evaluateFollowupDue({ state: state(), outbox: [anchor, record({ effectId: `followup:${anchor.effectId}:1`, createdAt: "2026-07-11T12:05:00.000Z" })], rules: rules.followup, now: NOW })?.anchorEffectId === anchor.effectId);
check("[P9] saga de handoff cancela follow-up antes do callback do vendedor", evaluateFollowupDue({
  state: state(),
  outbox: [anchor, record({ effectId: "handoff-active", kind: "handoff", status: "succeeded", receiptLevel: "delivered", outcomeAppliedAt: NOW })],
  rules: rules.followup,
  now: NOW,
}) === null);

const b1 = new QueueBrain([final("Oi, ainda procura um carro?")]);
check("[L1] LLM autora T1", await authorFollowupMessage({ brain: b1, state: state(), stage: 1, turnId: "fu1", now: NOW, portalPromptSha256: "sha" }) === "Oi, ainda procura um carro?");
check("[L2] frame tem stage", b1.frames[0]?.signals.followupStage === 1);
const b2 = new QueueBrain([{ kind: "query", call: { tool: "stock_search", input: {} } }, final("Posso ajudar com mais alguma informacao?")]);
check("[L3] tool e negada/reautora", (await authorFollowupMessage({ brain: b2, state: state(), stage: 2, turnId: "fu2", now: NOW, portalPromptSha256: "sha" }))?.startsWith("Posso") === true && b2.frames.length === 2);
check("[L4] T3 sem pergunta", await authorFollowupMessage({ brain: new QueueBrain([final("Se precisar, sigo por aqui. Ate mais!")]), state: state(), stage: 3, turnId: "fu3", now: NOW, portalPromptSha256: "sha" }) != null);
check("[L5] T3 pergunta reautorada", await authorFollowupMessage({ brain: new QueueBrain([final("Quer continuar?"), final("Ate mais!")]), state: state(), stage: 3, turnId: "fu4", now: NOW, portalPromptSha256: "sha" }) === "Ate mais!");
check("[L6] efeito da LLM e removido", await authorFollowupMessage({ brain: new QueueBrain([final("Oi", [{ kind: "handoff" }]), final("Ainda quer ajuda?")]), state: state(), stage: 1, turnId: "fu5", now: NOW, portalPromptSha256: "sha" }) === "Ainda quer ajuda?");

const turnId = "followup:anchor:3", msgId = `${turnId}:followup-message`;
const send: SendMessagePlan = { kind: "send_message", planId: "followup-message", effectId: msgId, order: 1, dependsOn: [], onSuccess: [] };
const decision: TurnDecision = { turnId, action: "close", reasonCode: "followup_t3", reasonSummary: "timeout", confidence: 1, decisionMutations: [], effectPlan: [send], responsePlan: { guidance: "" }, policyChecks: [] };
const chain = buildHandoffChain({ decision, turnId, leadId: LEAD, stateAfter: state(), adContext: null, adVehicleLabel: null, lastPhotoAction: null, agentName: "Pedro", leadPhone: "5512999999999", leadDisplayName: "Douglas", nowLocal: "11/07/2026 09:15", plannable: true, forcedReason: "followup_timeout_handoff" });
const handoff = chain.effectPlan.find((p) => p.kind === "handoff"), notify = chain.effectPlan.find((p) => p.kind === "notify_seller");
check("[H1] T3 monta handoff", chain.planned && chain.reason === "followup_timeout_handoff");
check("[H2] handoff depende da msg", handoff?.dependsOn?.includes("followup-message") === true);
check("[H3] notify depende do handoff", notify?.dependsOn?.includes("handoff") === true);
check("[H4] correlacao exata", handoff?.kind === "handoff" && notify?.kind === "notify_seller" && handoff.correlationId === notify.correlationId);
check("[H5] LLM nao escolhe seller", handoff?.kind === "handoff" && !("sellerId" in handoff));
check("[H6] stage so no notify", handoff?.onSuccess.length === 0 && notify?.onSuccess.some((o) => o.op === "mark_handoff_completed") === true);
check("[H7] grafo valido", validateEffectPlans(chain.effectPlan).length === 0);
const handoffReply = chain.effectPlan.find((p) => p.kind === "send_message");
check("[H8] reply do handoff nao inventa delivery gate", handoffReply?.onSuccess.every((o) => o.op !== "mark_message_delivered") === true);

const os = state(); os.followupCycle = { anchorEffectId: anchor.effectId, anchorAt: ANCHOR, sentStages: [], plannedStage: 1, lastSentAt: null };
const op: SendMessagePlan = { ...send, effectId: "fu-out", onSuccess: [{ op: "mark_followup_sent", effectId: "fu-out", anchorEffectId: anchor.effectId, stage: 1, sentAt: NOW }] };
const reduced = applyEffectOutcome(os, op, { status: "succeeded", effectId: "fu-out", receipt: { effectId: "fu-out", level: "accepted", at: NOW } });
check("[O1] receipt marca stage", reduced.ok && reduced.next.followupCycle?.sentStages.includes(1) === true);
check("[O2] receipt limpa planned", reduced.ok && reduced.next.followupCycle?.plannedStage === null);
check("[O3] follow-up exige apenas accepted", requiredReceiptFor(record({ onSuccess: op.onSuccess })) === "accepted");

class FakeTransferStore implements TransferSagaStore {
  lead: TransferLeadRow = { id: LEAD, status: "qualificado", assignedToId: null, leadName: "Douglas", remoteJid: "5512999999999@s.whatsapp.net", summary: null };
  seller: SellerCandidate = { id: "44444444-4444-4444-8444-444444444444", name: "Regia", whatsappNumber: "12999999999", isActive: true, agentId: null, lastLeadReceivedAt: null, totalLeadsReceived: 0 };
  transfer: TransferRow | null = null;
  inserted: InsertTransferInput[] = [];
  rollbackStatus: string | null | undefined;
  failInsert = false;
  config: TransferAgentConfig = { agentName: "Pedro", rules, briefingTemplateVendedor: null, briefingTemplateGerente: null, mensagensSemEmoji: false, gerenteFeedbackCompleto: false, gerentePhones: [] };
  async loadAgentConfig() { return this.config; }
  async fetchOwnedLeadForTransfer(_ref: any, id: string) { return id === LEAD ? this.lead : null; }
  async fetchSellerById(_tenant: string, id: string) { return id === this.seller.id ? this.seller : null; }
  async findPreviousSellerId() { return null; }
  async listActiveSellers() { return [this.seller]; }
  async latestTransferForLead() { return this.transfer; }
  async transferForCorrelation(_ref: any, _lead: string, correlation: string) { return this.transfer?.reason?.includes(`[${correlation}]`) ? this.transfer : null; }
  async activePendingForLead() { return null; }
  async claimLeadForTransfer() { return true; }
  async revertLeadClaim(_ref: any, _lead: string, previous: string | null) { this.rollbackStatus = previous; }
  async insertTransfer(input: InsertTransferInput) {
    this.inserted.push(input);
    if (this.failInsert) return null;
    this.transfer = { id: "55555555-5555-4555-8555-555555555555", toMemberId: input.toMemberId, transferStatus: input.status, isConfirmed: input.isConfirmed, reason: input.reason, notes: input.notes, confirmationTimeoutAt: input.confirmationTimeoutAt, createdAt: NOW };
    return this.transfer.id;
  }
  async updateLeadSummaryGuarded() {}
  async markSellerReceivedLead() {}
  async releaseLeadAssignment() {}
}
const transferStore = new FakeTransferStore();
const handoffPlan = handoff!;
const handoffRecord = record({ effectId: handoffPlan.effectId, turnId, planId: handoffPlan.planId, kind: "handoff", idempotencyKey: handoffPlan.effectId, payload: { leadId: LEAD, reason: "followup_timeout_handoff", briefing: "Resumo factual", correlationId: handoffPlan.kind === "handoff" ? handoffPlan.correlationId : "", __redacted: true }, status: "pending", receiptLevel: null, outcomeAppliedAt: null });
const handoffResult = await new HandoffEffectDispatcher({ ref: { tenantId: TENANT, agentId: AGENT }, clock: { now: () => NOW }, store: transferStore }).dispatch(handoffRecord);
check("[S1] saga cria pending", transferStore.inserted[0]?.status === "pending");
check("[S2] pending usa seller resolvido", transferStore.inserted[0]?.toMemberId === transferStore.seller.id);
check("[S3] correlation vai no transfer_reason", transferStore.inserted[0]?.reason.includes(`[${handoffPlan.kind === "handoff" ? handoffPlan.correlationId : ""}]`) === true);
check("[S4] handoff banco e delivered", handoffResult.status === "succeeded" && handoffResult.receipt.level === "delivered");

const sentTo: string[] = [];
const sentTexts: string[] = [];
transferStore.config = { ...transferStore.config, gerentePhones: ["5511888888888"] };
const notifyPlan = notify!;
const notifyRecord = record({ effectId: notifyPlan.effectId, turnId, planId: notifyPlan.planId, kind: "notify_seller", idempotencyKey: notifyPlan.effectId, payload: { leadId: LEAD, reason: "followup_timeout_handoff", etiquetas: { nome: "Douglas", telefone: "5512999999999" }, sensitiveRefs: { cpf: "cpf-ref", birthDate: "birth-ref" }, correlationId: notifyPlan.kind === "notify_seller" ? notifyPlan.correlationId : "", __redacted: true }, onSuccess: notifyPlan.onSuccess, status: "pending", receiptLevel: null, outcomeAppliedAt: null });
const notifyResult = await new NotifySellerEffectDispatcher({ ref: { tenantId: TENANT, agentId: AGENT }, clock: { now: () => NOW }, store: transferStore, sender: { async sendText(input) { sentTo.push(input.to); sentTexts.push(input.text); return { ok: true as const, level: "accepted" as const, providerMessageId: "wa-seller-1" }; }, async sendImage() { return { ok: false as const, code: "VALIDATION" as const, message: "unused", retryable: false }; } }, sensitiveVault: { async store() { throw new Error("unused"); }, async resolve(input) { return input.kind === "cpf" ? "11144477735" : "01/10/1997"; } } }).dispatch(notifyRecord);
check("[S5] notify usa vendedor da transfer", sentTo[0] === "12999999999");
check("[S6] notify nao mente delivered", notifyResult.status === "succeeded" && notifyResult.receipt.level === "accepted");
check("[S6d] accepted do notify satisfaz outcome operacional", requiredReceiptFor(notifyRecord) === "accepted");
const handoffState = state();
const notifyReduced = applyEffectOutcome(handoffState, notifyPlan, notifyResult);
check("[S6e] accepted do notify conclui stage handoff", notifyReduced.ok && notifyReduced.next.stage === "handoff");
check("[S6a] PII abre somente na mensagem direta do vendedor", sentTexts[0]?.includes("CPF: 11144477735") === true && sentTexts[0]?.includes("Data de nascimento: 01/10/1997") === true);
check("[S6b] gerente nunca recebe CPF/data", sentTexts[1] != null && !sentTexts[1].includes("11144477735") && !sentTexts[1].includes("01/10/1997"));
check("[S6c] outbox guarda somente refs opacas", !JSON.stringify(notifyRecord.payload).includes("11144477735") && !JSON.stringify(notifyRecord.payload).includes("01/10/1997"));
const wrong = { ...notifyRecord, effectId: "wrong-notify", idempotencyKey: "wrong-notify", payload: { ...notifyRecord.payload, correlationId: "wrong" } };
const wrongResult = await new NotifySellerEffectDispatcher({ ref: { tenantId: TENANT, agentId: AGENT }, clock: { now: () => NOW }, store: transferStore, sender: { async sendText() { return { ok: true as const, level: "accepted" as const, providerMessageId: "never" }; }, async sendImage() { return { ok: false as const, code: "VALIDATION" as const, message: "unused", retryable: false }; } } }).dispatch(wrong);
check("[S7] correlation errada nao notifica", wrongResult.status === "failed");

const rollbackStore = new FakeTransferStore(); rollbackStore.failInsert = true;
const rollbackResult = await new HandoffEffectDispatcher({ ref: { tenantId: TENANT, agentId: AGENT }, clock: { now: () => NOW }, store: rollbackStore }).dispatch(handoffRecord);
check("[S8] insert falho vira uncertain", rollbackResult.status === "outcome_uncertain");
check("[S9] rollback restaura status factual", rollbackStore.rollbackStatus === "qualificado");

console.log(`\n== F2.49: ${ok} OK | ${bad} FALHA ==`);
if (bad) process.exit(1);
