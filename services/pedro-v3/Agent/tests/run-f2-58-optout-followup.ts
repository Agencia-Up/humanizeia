// ============================================================================
// F2.58 (R8) — OPT-OUT DURÁVEL de desinteresse cancela follow-up mesmo quando o handoff NÃO é plannable.
// Parte A (evaluateFollowup PURO): com `optedOutAt` setado, retorna motivo terminal "lead_opted_out" ANTES da âncora,
//   independente de leadId (null/válido), handoff (habilitado/desabilitado/plannable/não), e do estágio do follow-up
//   (ancorado / pendente / já enviado). Sem opt-out + âncora vencida => "due" (controle).
// Parte B (ENGINE real central_active): "me tira da lista" / "pare de mandar" / "não me interessa" SETAM optedOutAt;
//   "não" após pergunta de troca, "não" após lista e "obrigado" NÃO setam; opt-out sobrevive a novo turno (idempotente).
// ============================================================================
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import { createInitialState, type ConversationState } from "../src/domain/conversation-state.ts";
import { resolveAutomationRules } from "../src/engine/automation-rules.ts";
import { evaluateFollowup } from "../src/engine/followup-policy.ts";
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
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
function baseState(leadId: string | null): ConversationState { return createInitialState({ conversationId: "wa:t", tenantId: TENANT, agentId: AGENT, leadId, now: "2026-07-15T11:59:00.000Z" }); }
function optedOut(leadId: string | null): ConversationState { return { ...baseState(leadId), optedOutAt: "2026-07-15T12:10:00.000Z" }; }
const anchor = record();
const handoffRec = record({ effectId: "handoff-x", kind: "handoff", status: "succeeded", receiptLevel: "delivered", outcomeAppliedAt: NOW });
const pendingFollowup = record({ effectId: `followup:${anchor.effectId}:1`, status: "pending", receiptLevel: null, outcomeAppliedAt: null });
const sentFollowupCycle = { anchorEffectId: anchor.effectId, anchorAt: ANCHOR, sentStages: [1, 2] as Array<1 | 2 | 3>, plannedStage: null, lastSentAt: "2026-07-15T12:09:00.000Z" };

async function partA(): Promise<void> {
  console.log("== F2.58 A — evaluateFollowup: opt-out durável vence tudo ==");
  const reason = (state: ConversationState, outbox: OutboxRecord[], r = rules) => evaluateFollowup({ state, outbox, rules: r, now: NOW });
  // CONTROLE: sem opt-out + âncora vencida -> T1 vence (prova que sem opt-out o follow-up dispararia).
  check("[A0] controle: SEM opt-out + âncora vencida => due T1", reason(baseState(LEAD), [anchor]).due?.stage === 1);
  // OPT-OUT vence, em TODA a matriz do contrato:
  check("[A1] opt-out + leadId VÁLIDO => lead_opted_out", reason(optedOut(LEAD), [anchor]).reason === "lead_opted_out");
  check("[A2] ⭐opt-out + leadId NULO (handoff não-plannable) => lead_opted_out", reason(optedOut(null), [anchor]).reason === "lead_opted_out");
  check("[A2b] opt-out + leadId nulo: due é NULL (nenhum T1/T2/T3)", reason(optedOut(null), [anchor]).due === null);
  check("[A3] opt-out + handoff no outbox (plannable) => lead_opted_out (mesmo bloqueio)", reason(optedOut(LEAD), [anchor, handoffRec]).reason === "lead_opted_out");
  check("[A4] opt-out + SEM handoff no outbox (não-plannable) => lead_opted_out (mesmo bloqueio)", reason(optedOut(null), [anchor]).reason === "lead_opted_out");
  check("[A5] opt-out + follow-up PENDENTE => lead_opted_out", reason(optedOut(LEAD), [anchor, pendingFollowup]).reason === "lead_opted_out");
  const sentState = { ...optedOut(LEAD), followupCycle: sentFollowupCycle };
  check("[A6] opt-out + follow-up JÁ ENVIADO (T1/T2) => lead_opted_out (T3 não arma)", reason(sentState, [anchor]).reason === "lead_opted_out" && reason(sentState, [anchor]).due === null);
  check("[A7] opt-out + rules DESABILITADAS => rules_disabled (respeita o desligamento global)", reason(optedOut(LEAD), [anchor], { ...rules, enabled: false }).reason === "rules_disabled");
  check("[A8] opt-out vence ANTES da âncora: SEM anchor no outbox ainda retorna lead_opted_out (não no_anchor)", reason(optedOut(LEAD), []).reason === "lead_opted_out");
  check("[A9] opt-out vence stage: stage=greeting normal ainda bloqueia", reason(optedOut(LEAD), [anchor]).reason === "lead_opted_out");
  // handoff plannable e não-plannable têm o MESMO bloqueio de follow-up
  check("[A10] plannable×não-plannable: mesmo resultado (due=null nos dois)", reason(optedOut(LEAD), [anchor, handoffRec]).due === null && reason(optedOut(null), [anchor]).due === null);
}

// ── Parte B: harness do engine real (central_active, singleAuthor+llmFirst) ──
const COMPASS: VehicleFact = { vehicleKey: "rm:compass", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 99000, km: 58000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
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
  const id = `wa:f58_${seq0++}`; let s = 0;
  const t = async (leadMsgs: string | string[], responder: BrainResponder, rel: TurnRelation = "ambiguous"): Promise<{ optedOutAt: string | null; src: string | null }> => {
    preparer.relation = rel; brain.setResponder(responder);
    const bursts = Array.isArray(leadMsgs) ? leadMsgs : [leadMsgs];
    for (const m of bursts) { await persistence.tryInsert({ eventId: `${id}-e${++s}-${Math.random().toString(36).slice(2, 6)}`, conversationId: id, raw: redact({ text: m }), receivedAt: clock.now() }); clock.advance(300); }
    clock.advance(700);
    const turnId = `${id}-t${s}`;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
      conversationId: id, tenantId: TENANT, agentId: AGENT, leadId, crmWriteEnabled: leadId != null,
      workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: "sha-f258",
      limits: { maxSteps: 6, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 3, brainMaxSteps: 6, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    });
    while (true) {
      const claimed = await persistence.claimOutbox(id, "w", 60_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock, conversationId: id, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: id, effectId: rec.effectId, result });
      }
    }
    const after = persistence.load(id)?.state ?? null;
    return { optedOutAt: after?.optedOutAt ?? null, src: r.status === "committed" ? (r.responseSource ?? null) : null };
  };
  return { t };
}

// respostas do cérebro (declaram understanding; a LLM autora a despedida — o engine só persiste o fato)
const goodbye: BrainResponder = () => finU([txt("Sem problema! Vou te tirar da lista. Se mudar de ideia, estou à disposição.")], U("smalltalk", [ev(undefined, "tira")]));
const tradeAnswer: BrainResponder = () => finU([txt("Anotado, sem carro para troca então. Você pretende dar algum valor de entrada?")], U("trade_in", [ev(undefined, "nao")]));
const listChoice: BrainResponder = () => finU([txt("Sem problema! Quer que eu te mostre outras opções ou prefere ver as condições do Compass?")], U("other", [ev(undefined, "nao")]));
const thanks: BrainResponder = () => finU([txt("Imagina! Qualquer coisa é só chamar. 😊")], U("smalltalk", [ev(undefined, "obrigado")]));

async function partB(): Promise<void> {
  console.log("\n== F2.58 B — engine central_active: quando o FATO durável é (ou não) criado ==");
  // opt-out SETADO nos desinteresses explícitos:
  const b1 = await conv(null); const r1 = await b1.t("Me tira da lista", goodbye, "unrelated");
  check("[B1] ⭐'Me tira da lista' + leadId NULO => optedOutAt SETADO", r1.optedOutAt != null, `optedOutAt=${r1.optedOutAt} src=${r1.src}`);
  const b2 = await conv(LEAD); const r2 = await b2.t("Pare de me mandar mensagens", goodbye, "unrelated");
  check("[B2] 'pare de me mandar mensagens' => optedOutAt SETADO", r2.optedOutAt != null, `optedOutAt=${r2.optedOutAt}`);
  const b3 = await conv(LEAD); const r3 = await b3.t("Não me interessa", goodbye, "unrelated");
  check("[B3] 'não me interessa' => optedOutAt SETADO", r3.optedOutAt != null, `optedOutAt=${r3.optedOutAt}`);
  // opt-out NÃO setado em resposta curta / low_intent:
  const b4 = await conv(LEAD);
  await b4.t("Você tem interesse em algum SUV?", () => finU([txt("Perfeito! Você tem algum carro para dar de troca?")], U("smalltalk", [ev(undefined, "suv")])));
  const r4 = await b4.t("Não", tradeAnswer, "answers_pending");
  check("[B4] ⭐'Não' após pergunta de troca => optedOutAt NÃO setado", r4.optedOutAt == null, `optedOutAt=${r4.optedOutAt}`);
  const b5 = await conv(LEAD); const r5 = await b5.t("Não", listChoice, "answers_pending");
  check("[B5] ⭐'Não' (curto) => optedOutAt NÃO setado", r5.optedOutAt == null, `optedOutAt=${r5.optedOutAt}`);
  const b6 = await conv(LEAD); const r6 = await b6.t("Obrigado", thanks, "unrelated");
  check("[B6] 'Obrigado' (low_intent) => optedOutAt NÃO setado como opt-out firme", r6.optedOutAt == null, `optedOutAt=${r6.optedOutAt}`);
  // idempotência: opt-out sobrevive a um novo turno e NÃO é reaberto/limpo automaticamente
  const b7 = await conv(LEAD);
  const first = await b7.t("Me tira da lista", goodbye, "unrelated");
  const second = await b7.t("Oi", () => finU([txt("Oi! Fico à disposição se precisar. 😊")], U("smalltalk", [ev(undefined, "oi")])));
  check("[B7] ⭐opt-out sobrevive a novo turno (idempotente, mesmo timestamp, não limpa)", first.optedOutAt != null && second.optedOutAt === first.optedOutAt, `first=${first.optedOutAt} second=${second.optedOutAt}`);
}

async function main(): Promise<void> {
  await partA();
  await partB();
  console.log(`\n== F2.58: ${ok} OK | ${bad} FALHA ==`);
  if (bad) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
