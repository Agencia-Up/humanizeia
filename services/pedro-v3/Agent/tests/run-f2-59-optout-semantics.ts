// ============================================================================
// F2.59 (R8.1) — SEMÂNTICA do OPT-OUT GLOBAL endurecida (sem alterar o contrato optedOutAt/evaluateFollowup).
// A: detectExplicitOptOut PURO — separa opt-out global INEQUÍVOCO de rejeição de veículo / low_intent / "não" isolado.
// B: ENGINE central_active — opt-out global misturado com "mais opções" e com preço/tipo AINDA seta (não depende mais de
//    disengagedActionable); rejeição de veículo e mudança para outro veículo NÃO setam; idempotência + persistência.
// C: follow-up BLOQUEADO (lead_opted_out) após cada opt-out global, mesmo com âncora vencida.
// ============================================================================
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import { createInitialState, type ConversationState } from "../src/domain/conversation-state.ts";
import { resolveAutomationRules } from "../src/engine/automation-rules.ts";
import { evaluateFollowup } from "../src/engine/followup-policy.ts";
import { detectExplicitOptOut } from "../src/engine/lead-intent.ts";
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer, TurnContextPreparation } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0; let bad = 0;
function check(name: string, pass: boolean, extra?: string): void { if (pass) { ok++; console.log(`  OK  ${name}`); } else { bad++; console.error(`  RED ${name}${extra ? ` — ${extra}` : ""}`); } }

const TENANT = "11111111-1111-4111-8111-111111111111", AGENT = "22222222-2222-4222-8222-222222222222", LEAD = "33333333-3333-4333-8333-333333333333";
const ANCHOR = "2026-07-15T12:00:00.000Z", NOW = "2026-07-15T12:20:00.000Z";
const rules = resolveAutomationRules({ followup: { enabled: true, t1_min: 5, t2_min: 8, t3_min: 12, t3_transfers: true }, transfer: { enabled: true, seller_response_min: 10 } }).followup;
function record(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return { effectId: "turn-1:message", conversationId: "wa:t", turnId: "turn-1", planId: "message", kind: "send_message", idempotencyKey: "turn-1:message", order: 1, dependsOn: [], payload: { text: "Oi", __redacted: true }, onSuccess: [], status: "succeeded", providerCapability: "none", receiptLevel: "delivered", attempts: 1, nextRetryAt: null, providerReceipt: null, outcomeAppliedAt: ANCHOR, lastError: null, createdAt: ANCHOR, dispatchedAt: ANCHOR, ...overrides };
}

// ── A: detector PURO ──────────────────────────────────────────────────────────────────────────────────
function partA(): void {
  console.log("== F2.59 A — detectExplicitOptOut: opt-out global inequívoco vs rejeição de veículo ==");
  const OPT_OUT = [
    "Me tira da lista", "Pare de me mandar mensagens", "Pode parar de mandar", "Não quero mais nada",
    "Não quero receber mais mensagens", "Pode parar de me chamar", "Encerra o contato", "Não me interessa",
    "Não quero comprar", "Me tira da lista, não quero mais opções", "Me tira da lista do SUV até 50 mil",
    "Não me mande mais mensagens", "Sai fora",
  ];
  const NOT_OPT_OUT = [
    "Não me interessa esse carro, tem outro?", "Não me interessa esse Onix, quero outro", "Não gostei desse Onix, mostra outro",
    "Não quero esse SUV, quero um sedan", "Não", "Obrigado", "Vou pensar", "Quero um SUV até 50 mil",
    "Gostei do Compass", "Tem outro modelo?", "Não gostei da cor, tem em outra?",
  ];
  const SCOPED_NOT_OPT_OUT = [
    "Não me mande mais fotos", "Não quero mais receber fotos", "Pode parar de enviar ofertas de SUV", "Não me mande mais o Onix",
    "Não me mande mais mensagens sobre o Onix", "Não quero mais receber contato desse carro", "Sai fora desse carro",
  ];
  for (const m of OPT_OUT) check(`[A-opt] "${m}" => opt-out`, detectExplicitOptOut(m) === true, "detectou false");
  for (const m of NOT_OPT_OUT) check(`[A-not] "${m}" => NÃO opt-out`, detectExplicitOptOut(m) === false, "detectou true");
  for (const m of SCOPED_NOT_OPT_OUT) check(`[A-scoped] "${m}" => NÃO opt-out`, detectExplicitOptOut(m) === false, "detectou true");
}

// ── B/C: engine real ──────────────────────────────────────────────────────────────────────────────────
const COMPASS: VehicleFact = { vehicleKey: "rm:compass", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 49000, km: 58000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const STOCK = [COMPASS];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } });
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  if (call.tool === "stock_search") return { ok: true, tool: "stock_search", data: { items: STOCK, filtersUsed: {} as Record<string, never> }, source: "fake" } as QueryResult;
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<TurnContextPreparation> { return { interpretation: { relation: this.relation } as never, tenantCatalog: catalog, claimExtractor: extractor }; } }
const U = (primaryIntent: PrimaryIntent, evidence: TurnUnderstanding["evidence"] = []): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence, isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const ev = (capability: string | undefined, quote: string): TurnUnderstanding["evidence"][number] => ({ capability: capability as never, quote });
function finU(parts: ResponsePart[], u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode: "reply", reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
let seq0 = 0;
function conv(leadId: string | null) {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock("2026-07-15T09:00:00.000Z"); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:f59_${seq0++}`; let s = 0;
  const t = async (leadMsgs: string | string[], responder: BrainResponder, rel: TurnRelation = "ambiguous"): Promise<{ optedOutAt: string | null; followupReason: string; state: ConversationState | null }> => {
    preparer.relation = rel; brain.setResponder(responder);
    const bursts = Array.isArray(leadMsgs) ? leadMsgs : [leadMsgs];
    for (const m of bursts) { await persistence.tryInsert({ eventId: `${id}-e${++s}-${Math.random().toString(36).slice(2, 6)}`, conversationId: id, raw: redact({ text: m }), receivedAt: clock.now() }); clock.advance(300); }
    clock.advance(700);
    const turnId = `${id}-t${s}`;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
      conversationId: id, tenantId: TENANT, agentId: AGENT, leadId, crmWriteEnabled: leadId != null,
      workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: "sha-f259",
      limits: { maxSteps: 6, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 3, brainMaxSteps: 6, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    });
    void r;
    while (true) {
      const claimed = await persistence.claimOutbox(id, "w", 60_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock, conversationId: id, effectId: rec.effectId, result });
      }
    }
    const after = persistence.load(id)?.state ?? null;
    // follow-up com uma âncora vencida: se optou, tem que dar lead_opted_out
    const fu = after ? evaluateFollowup({ state: after, outbox: [record()], rules, now: NOW }) : null;
    return { optedOutAt: after?.optedOutAt ?? null, followupReason: fu?.reason ?? "n/a", state: after };
  };
  return { t };
}
const goodbye: BrainResponder = () => finU([txt("Sem problema! Vou te tirar da lista. Se precisar, é só chamar.")], U("smalltalk", [ev(undefined, "tira")]));
const rejectVehicle: BrainResponder = () => finU([txt("Sem problema! Deixa eu te mostrar outras opções então.")], U("other", [ev(undefined, "outro")]));

async function partBC(): Promise<void> {
  console.log("\n== F2.59 B/C — engine: opt-out global (mesmo com contexto comercial) seta e bloqueia follow-up; rejeição não ==");
  // opt-out global MISTURADO com "mais opções" (mentionsMoreOptions) — antes o SET era suprimido; agora SETA.
  const m1 = await conv(null); const r1 = await m1.t("Me tira da lista, não quero mais opções", goodbye, "unrelated");
  check("[B1] ⭐'me tira da lista, não quero mais opções' + leadId NULO => optedOutAt SETADO", r1.optedOutAt != null, `optedOutAt=${r1.optedOutAt}`);
  check("[C1] follow-up bloqueado (lead_opted_out) após B1", r1.followupReason === "lead_opted_out", r1.followupReason);
  // opt-out global MISTURADO com preço/tipo (constraint comercial) — antes suprimido; agora SETA.
  const m2 = await conv(LEAD); const r2 = await m2.t("Me tira da lista do SUV até 50 mil", goodbye, "unrelated");
  check("[B2] ⭐'me tira da lista do SUV até 50 mil' => optedOutAt SETADO (não suprimido por constraint comercial)", r2.optedOutAt != null, `optedOutAt=${r2.optedOutAt}`);
  check("[C2] follow-up bloqueado após B2", r2.followupReason === "lead_opted_out", r2.followupReason);
  // novas formulações globais
  const m3 = await conv(LEAD); const r3 = await m3.t("Pode parar de mandar", goodbye, "unrelated");
  check("[B3] 'pode parar de mandar' => optedOutAt SETADO", r3.optedOutAt != null, `optedOutAt=${r3.optedOutAt}`);
  const m4 = await conv(LEAD); const r4 = await m4.t("Não quero mais nada", goodbye, "unrelated");
  check("[B4] 'não quero mais nada' => optedOutAt SETADO", r4.optedOutAt != null, `optedOutAt=${r4.optedOutAt}`);
  const m5 = await conv(LEAD); const r5 = await m5.t("Não quero receber mais mensagens", goodbye, "unrelated");
  check("[B5] 'não quero receber mais mensagens' => optedOutAt SETADO", r5.optedOutAt != null, `optedOutAt=${r5.optedOutAt}`);
  const m6 = await conv(LEAD); const r6 = await m6.t("Encerra o contato", goodbye, "unrelated");
  check("[B6] 'encerra o contato' => optedOutAt SETADO", r6.optedOutAt != null, `optedOutAt=${r6.optedOutAt}`);
  // rejeição de veículo NÃO seta
  const m7 = await conv(LEAD); const r7 = await m7.t("Não me interessa esse carro, tem outro?", rejectVehicle, "continues_offer");
  check("[B7] ⭐'não me interessa esse carro, tem outro?' => optedOutAt NÃO setado (rejeição de veículo)", r7.optedOutAt == null, `optedOutAt=${r7.optedOutAt}`);
  check("[C7] follow-up NÃO bloqueado por opt-out (não é lead_opted_out)", r7.followupReason !== "lead_opted_out", r7.followupReason);
  // mudança explícita para outro veículo NÃO seta
  const m8 = await conv(LEAD); const r8 = await m8.t("Não quero esse SUV, quero um sedan", rejectVehicle, "direction_change");
  check("[B8] ⭐'não quero esse SUV, quero um sedan' => optedOutAt NÃO setado (mudança de veículo)", r8.optedOutAt == null, `optedOutAt=${r8.optedOutAt}`);
  // idempotência + persistência após novo turno
  const m9 = await conv(LEAD);
  const first = await m9.t("Me tira da lista", goodbye, "unrelated");
  const second = await m9.t("Oi", () => finU([txt("Oi! Fico à disposição. 😊")], U("smalltalk", [ev(undefined, "oi")])));
  check("[B9] ⭐opt-out persiste após novo turno, idempotente (mesmo timestamp)", first.optedOutAt != null && second.optedOutAt === first.optedOutAt, `first=${first.optedOutAt} second=${second.optedOutAt}`);
  check("[C9] follow-up segue bloqueado no turno seguinte", second.followupReason === "lead_opted_out", second.followupReason);
}

async function main(): Promise<void> {
  partA();
  await partBC();
  console.log(`\n== F2.59: ${ok} OK | ${bad} FALHA ==`);
  if (bad) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
