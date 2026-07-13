import { PilotActiveRoot, PilotActiveRootError } from "../src/engine/pilot-active-root.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen, createInMemoryBacking } from "../src/adapters/persistence/in-memory-store.ts";
import { V2PlaintextApiKeyReader } from "../src/adapters/read/v2-api-key-reader.ts";
import type { V2ColumnName, V2ReadDatabase, V2TableName, V2WhereEquals } from "../src/adapters/read/supabase-v2-read-adapter.ts";
import type { UazapiHttpRequest, UazapiHttpResponse, UazapiHttpTransport } from "../src/adapters/effects/uazapi-whatsapp-sender.ts";
import type { ComposeModelRequest, InterpretModelRequest, ProposeModelRequest, StructuredConversationModel } from "../src/domain/conversation-model.ts";
import type { ProposedDecision, TenantCatalog } from "../src/domain/decision.ts";
import type { TenantAgentRef } from "../src/domain/read-ports.ts";
import type { TenantCatalogSource } from "../src/engine/turn-context-preparer.ts";
import { applyProviderDeliveryReceipt } from "../src/engine/provider-delivery-receipt.ts";
import { redact } from "../src/domain/effect-intent.ts";
// R13-D (audit Codex): fixtures do teste de reconciliação durável ligada no runtime central_active.
import { runCentralConversationTurn } from "../src/engine/central-engine.ts";
import { OutboxDispatcher, type EffectDispatcher } from "../src/engine/outbox-dispatcher.ts";
import { InMemoryEffectGate } from "../src/engine/effect-gate.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { FakeLlm, type ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { loadPersistedWorkingMemory } from "../src/engine/working-memory.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import type { AgentBrainStep, AgentBrainDecision } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { TenantBusinessInfoSource, TenantBusinessInfo } from "../src/engine/tenant-business-info.ts";

const TENANT_ID = "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0";
const AGENT_ID = "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185";
const NOW = "2026-06-28T20:00:00.000Z";

let ok = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`  OK  ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.error(`  RED ${name}${detail ? ` - ${detail}` : ""}`);
  }
}
async function expectThrow(name: string, fn: () => Promise<unknown> | unknown, code: string): Promise<void> {
  try {
    await fn();
    check(name, false, "deveria falhar");
  } catch (error) {
    const actual = error instanceof PilotActiveRootError ? error.code : error instanceof Error ? error.message : String(error);
    check(name, actual.includes(code), actual);
  }
}

type DbCall = { op: "one" | "many"; table: V2TableName; columns: readonly V2ColumnName[]; where: V2WhereEquals };
class TinyV2ReadDatabase implements V2ReadDatabase {
  readonly calls: DbCall[] = [];
  constructor(private readonly rows: Partial<Record<V2TableName, readonly Record<string, unknown>[]>>) {}
  async selectOne(table: V2TableName, columns: readonly V2ColumnName[], where: V2WhereEquals): Promise<Record<string, unknown> | null> {
    this.calls.push({ op: "one", table, columns, where });
    const row = this.find(table, where)[0];
    return row ? this.project(row, columns) : null;
  }
  async selectMany(table: V2TableName, columns: readonly V2ColumnName[], where: V2WhereEquals): Promise<readonly Record<string, unknown>[]> {
    this.calls.push({ op: "many", table, columns, where });
    return this.find(table, where).map((row) => this.project(row, columns));
  }
  private find(table: V2TableName, where: V2WhereEquals): readonly Record<string, unknown>[] {
    return (this.rows[table] ?? []).filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
  }
  private project(row: Record<string, unknown>, columns: readonly V2ColumnName[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const column of columns) out[column] = row[column];
    return out;
  }
}

class ReceiptMemoryPersistence extends InMemoryPersistence {
  constructor(clock: FakeClock, idGen: FakeIdGen, private readonly receiptConversationId: string) {
    super(clock, idGen);
  }

  async findOutboxByProviderMessageId(providerMessageId: string) {
    const rows = await this.listOutbox(this.receiptConversationId);
    const matches = rows.filter((row) => {
      const receipt = row.providerReceipt;
      return typeof receipt === "object"
        && receipt !== null
        && !Array.isArray(receipt)
        && receipt.providerMessageId === providerMessageId;
    });
    if (matches.length > 1) throw new Error("provider_message_id_ambiguous");
    return matches[0] ?? null;
  }
}
class StaticCatalogSource implements TenantCatalogSource {
  async loadCatalog(_ref: TenantAgentRef): Promise<TenantCatalog> { return { entries: [] }; }
}

class RecordingUazapiTransport implements UazapiHttpTransport {
  readonly calls: Array<{ url: string; request: UazapiHttpRequest }> = [];
  responses: UazapiHttpResponse[] = [];
  async postJson(url: string, request: UazapiHttpRequest): Promise<UazapiHttpResponse> {
    this.calls.push({ url, request });
    return this.responses.shift() ?? { ok: true, status: 200, json: { messageId: "wa-msg-1" } };
  }
}

class ScriptedModel implements StructuredConversationModel {
  readonly interpretCalls: InterpretModelRequest[] = [];
  readonly proposeCalls: ProposeModelRequest[] = [];
  readonly composeCalls: ComposeModelRequest[] = [];
  constructor(private readonly proposal: ProposedDecision, private readonly text: string) {}
  async interpret(request: InterpretModelRequest): Promise<unknown> {
    this.interpretCalls.push(request);
    return { relation: "ambiguous", intentSummary: "pilot_active_test" };
  }
  async propose(request: ProposeModelRequest): Promise<unknown> {
    this.proposeCalls.push(request);
    return { kind: "final", proposal: this.proposal };
  }
  async compose(request: ComposeModelRequest): Promise<unknown> {
    this.composeCalls.push(request);
    return { parts: [{ type: "text", content: this.text }] };
  }
}

function replyProposal(turnId: string, leadText: string, agentText: string): ProposedDecision {
  return {
    proposedAction: "reply",
    facts: [{ op: "append_lead_turn", turn: { role: "lead", text: leadText, at: NOW } }],
    proposedEffects: [{
      kind: "send_message",
      planId: "msg-1",
      order: 1,
      onSuccess: [{ op: "append_assistant_turn", effectId: "placeholder-before-finalizer", turn: { role: "agent", text: agentText, at: NOW } }],
    }],
    responsePlan: { guidance: "Responder a saudacao." },
    reasonCode: `active_reply_${turnId}`,
    reasonSummary: "Resposta ativa do piloto.",
    confidence: 0.9,
  };
}

function handoffProposal(): ProposedDecision {
  return {
    proposedAction: "handoff",
    facts: [],
    // HF-1 (contrato novo): handoff proposto carrega leadId + reason tipado + briefing — NUNCA sellerId (saga resolve).
    proposedEffects: [{ kind: "handoff", planId: "handoff-1", order: 1, leadId: "11111111-1111-4111-8111-111111111111", reason: "explicit_human_request", briefing: "", onSuccess: [] }],
    responsePlan: { guidance: "Handoff bloqueado nesta fase." },
    reasonCode: "handoff_attempt",
    reasonSummary: "Tentativa de handoff sem adapter.",
    confidence: 0.8,
  };
}

function seed(overrides: { agent?: Partial<Record<string, unknown>>; instance?: Partial<Record<string, unknown>> } = {}): TinyV2ReadDatabase {
  const agent = {
    id: AGENT_ID,
    user_id: TENANT_ID,
    instance_id: "wa-inst-1",
    name: "Aloan",
    system_prompt: "Voce e o Aloan.",
    use_funnel_config: false,
    company_name: "Aloan Motors",
    model: "openai/gpt-4.1-mini",
    temperature: 0.3,
    sdr_goal: "qualificar",
    qualification_questions: [] as string[],
    sells_motorcycles: false,
    blocked_categories: [] as string[],
    rag_restricted: false,
    is_active: true,
    updated_at: NOW,
    ...overrides.agent,
  };
  const instance = {
    id: "wa-inst-1",
    user_id: TENANT_ID,
    instance_name: "pilot",
    api_url: "https://api.uazapi.example",
    provider: "uazapi",
    api_key_encrypted: JSON.stringify({ api_key: "SECRET-UAZAPI-TOKEN" }),
    api_key: null,
    ...overrides.instance,
  };
  return new TinyV2ReadDatabase({
    wa_ai_agents: [agent],
    agent_funnel_config: [],
    platform_integrations: [],
    ai_crm_leads: [],
    wa_instances: [instance],
  });
}

async function makeRoot(args: { db?: TinyV2ReadDatabase; model?: StructuredConversationModel; transport?: RecordingUazapiTransport; clock?: FakeClock } = {}) {
  const clock = args.clock ?? new FakeClock(NOW);
  const transport = args.transport ?? new RecordingUazapiTransport();
  const root = await PilotActiveRoot.create({ mode: "active", tenantId: TENANT_ID, agentId: AGENT_ID }, {
    db: args.db ?? seed(),
    decryptor: new V2PlaintextApiKeyReader(),
    clock,
    model: args.model ?? new ScriptedModel(replyProposal("t1", "Boa noite", "Oi, posso ajudar?"), "Oi, posso ajudar?"),
    catalogSource: new StaticCatalogSource(),
    whatsappTransport: transport,
    allowedUazapiHosts: ["api.uazapi.example"],
  });
  return { root, clock, transport };
}

const limits = { maxSteps: 3, totalTimeoutMs: 2_000, proposeTimeoutMs: 500, queryTimeoutMs: 500, composeTimeoutMs: 500 };

// ── R13-D (audit Codex): fixtures da reconciliação durável no runtime central_active ───────────────────────────
const RSTOCK: VehicleFact[] = [
  { vehicleKey: "rm:2", marca: "Honda", modelo: "CRV", ano: 2010, preco: 62990, tipo: "suv", km: 158000, cambio: "Automatico", cor: "Preto" } as VehicleFact,
];
const RPHOTOS: Record<string, string[]> = { "rm:2": ["c2a", "c2b"] };
const rCatalog = buildTenantCatalog(RSTOCK);
const rExtractor = new CatalogClaimExtractor(rCatalog);
class RFixedPreparer implements TurnContextPreparer {
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof rCatalog; claimExtractor: typeof rExtractor }> {
    return { interpretation: { relation: "ambiguous" }, tenantCatalog: rCatalog, claimExtractor: rExtractor };
  }
}
const rRunQuery = async (call: QueryCall): Promise<QueryResult> => {
  if (call.tool === "stock_search") return { ok: true, tool: "stock_search", data: { items: RSTOCK, filtersUsed: {} as Record<string, never> }, source: "fake" } as QueryResult;
  if (call.tool === "vehicle_details") {
    const v = RSTOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey);
    return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult
            : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") {
    const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? "";
    return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: RPHOTOS[key] ?? [] }, source: "fake" } as QueryResult;
  }
  throw new Error("rRunQuery: tool não suportada");
};
class RBusinessInfo implements TenantBusinessInfoSource {
  async getBusinessInfo(): Promise<TenantBusinessInfo> { return { address: null, hours: null, unit: null, source: "tenant_runtime_config" }; }
}
const rPlainText: ComposeOverride = (d) => ({ parts: [{ type: "text", content: d.responsePlan.guidance }] });
function rLlm(): FakeLlm { const l = new FakeLlm(); l.setTurnScript([], rPlainText); return l; }
function rFinalReply(guidance: string): AgentBrainStep {
  const decision: AgentBrainDecision = {
    reasonCode: "reply", reasonSummary: "resposta", confidence: 0.9, responsePlan: { guidance },
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan],
    memoryMutations: [], stateMutations: [],
  };
  return { kind: "final", decision };
}
const rSendMedia = (vehicleKey: string, photoIds: string[]): ProposedEffectPlan => ({
  kind: "send_media", planId: "media", order: 1, vehicleKey, photoIds,
  onSuccess: [{ op: "mark_photos_sent", effectId: "placeholder", vehicleKey, photoIds }],
} as ProposedEffectPlan);
class FailWmPromotion extends InMemoryPersistence {
  commitWorkingMemoryOutcome(): { ok: true; applied: boolean; version: number } | { ok: false; reason: string } {
    return { ok: false, reason: "transient_wm_failure" };
  }
}

console.log("F2.6F active pilot root (fake I/O, no network):");

await expectThrow(
  "nao cria root para agent fora do piloto",
  () => PilotActiveRoot.create({ mode: "active", tenantId: TENANT_ID, agentId: "agent-outro" }, {
    db: seed(), decryptor: new V2PlaintextApiKeyReader(), clock: new FakeClock(NOW), model: new ScriptedModel(replyProposal("x", "Oi", "Oi"), "Oi"), whatsappTransport: new RecordingUazapiTransport(), allowedUazapiHosts: ["api.uazapi.example"], catalogSource: new StaticCatalogSource(),
  }),
  "PILOT_ACTIVE_SCOPE_DENIED",
);

await expectThrow(
  "agente piloto sem instance_id falha fechado",
  () => makeRoot({ db: seed({ agent: { instance_id: null } }) }),
  "AGENT_WITHOUT_INSTANCE",
);

{
  const model = new ScriptedModel(replyProposal("t1", "Boa noite", "Oi, posso ajudar?"), "Oi, posso ajudar?");
  const { root, clock, transport } = await makeRoot({ model });
  const persistence = new ReceiptMemoryPersistence(clock, new FakeIdGen(), "conv-1");
  const result = await root.runTurn({
    persistence,
    conversationId: "conv-1",
    to: "5512999999999",
    workerId: "worker-1",
    turnId: "turn-1",
    eventId: "evt-1",
    messageText: "Boa noite",
    receivedAt: NOW,
    limits,
    maxValidationAttempts: 2,
  });
  const outbox = await persistence.listOutbox("conv-1");
  const state = await persistence.load("conv-1");
  const sentText = typeof (outbox[0]?.payload as any)?.text === "string" ? (outbox[0]?.payload as any).text : "";
  check("turno ativo commita", result.status === "committed", JSON.stringify(result));
  check("turno ativo despacha exatamente uma mensagem", result.dispatched === 1 && transport.calls.length === 1, JSON.stringify({ dispatched: result.dispatched, calls: transport.calls.length }));
  check("F2.7.4 outbox accepted JA aplica o outcome (memoria do agente no accepted)", outbox[0]?.status === "succeeded" && outbox[0].receiptLevel === "accepted" && outbox[0].outcomeAppliedAt !== null, JSON.stringify(outbox[0]));
  check("F2.7.14 memoria registra lead e o texto realmente enviado (sem duplicar)", state?.state.recentTurns.filter((t) => t.role === "lead" && t.text === "Boa noite").length === 1 && sentText.length > 0 && state.state.recentTurns.filter((t) => t.role === "agent" && t.text === sentText).length === 1, JSON.stringify({ sentText, turns: state?.state.recentTurns }));
  check("prompt do portal chega ao modelo", model.interpretCalls[0]?.binding.systemPrompt === "Voce e o Aloan.", JSON.stringify(model.interpretCalls[0]?.binding));

  const delivered = await applyProviderDeliveryReceipt({
    persistence,
    clock,
    receipt: { providerMessageId: "wa-msg-1", status: "delivered", at: NOW },
  });
  const deliveredState = await persistence.load("conv-1");
  const deliveredVersion = deliveredState?.version;
  check("messages_update delivered aplica outcome sem reenviar", delivered.status === "applied" && transport.calls.length === 1, JSON.stringify({ delivered, calls: transport.calls.length }));
  check("delivery posterior preserva a fala sem duplicar", deliveredState?.state.recentTurns.filter((turn) => turn.role === "agent" && turn.text === sentText).length === 1, JSON.stringify(deliveredState?.state.recentTurns));

  const repeatedDelivery = await applyProviderDeliveryReceipt({
    persistence,
    clock,
    receipt: { providerMessageId: "wa-msg-1", status: "read", at: NOW },
  });
  const repeatedState = await persistence.load("conv-1");
  check("callback duplicado/read e idempotente", repeatedDelivery.status === "duplicate" && repeatedState?.version === deliveredVersion && transport.calls.length === 1, JSON.stringify({ repeatedDelivery, version: repeatedState?.version }));

  const dup = await root.runTurn({
    persistence,
    conversationId: "conv-1",
    to: "5512999999999",
    workerId: "worker-1",
    turnId: "turn-dup",
    eventId: "evt-1",
    messageText: "Boa noite duplicado",
    receivedAt: NOW,
    limits,
    maxValidationAttempts: 2,
  });
  check("webhook duplicado nao reprocessa nem reenvia", dup.status === "duplicate" && dup.dispatched === 0 && transport.calls.length === 1, JSON.stringify({ dup, calls: transport.calls.length }));
}

{
  const clock = new FakeClock(NOW);
  const persistence = new ReceiptMemoryPersistence(clock, new FakeIdGen(), "conv-notify-receipt");
  const initial = createInitialState({ conversationId: "conv-notify-receipt", tenantId: TENANT_ID, agentId: AGENT_ID, leadId: null, now: NOW });
  const notify: OutboxRecord = {
    effectId: "turn-notify:notify-seller", conversationId: "conv-notify-receipt", turnId: "turn-notify",
    planId: "notify-seller", kind: "notify_seller", idempotencyKey: "turn-notify:notify-seller",
    order: 3, dependsOn: [], payload: redact({ leadId: "33333333-3333-4333-8333-333333333333" }),
    onSuccess: [{ op: "mark_handoff_completed", effectId: "turn-notify:notify-seller" }],
    status: "succeeded", providerCapability: "none", receiptLevel: "accepted", attempts: 1,
    nextRetryAt: null, providerReceipt: redact({ effectId: "turn-notify:notify-seller", level: "accepted", at: NOW, providerMessageId: "wa-seller-notify-1" }),
    outcomeAppliedAt: null, lastError: null, createdAt: NOW, dispatchedAt: NOW,
  };
  const seed = persistence.begin();
  seed.casState("conv-notify-receipt", 0, initial);
  seed.appendOutbox([notify]);
  await seed.commit();

  const delivered = await applyProviderDeliveryReceipt({
    persistence,
    clock,
    receipt: { providerMessageId: "wa-seller-notify-1", status: "delivered", at: NOW },
  });
  const snapshot = await persistence.load("conv-notify-receipt");
  check("notify_seller delivered aplica o handoff no callback real", delivered.status === "applied" && delivered.conversationId === "conv-notify-receipt" && snapshot?.state.stage === "handoff", JSON.stringify({ delivered, stage: snapshot?.state.stage }));
}

{
  const model = new ScriptedModel(handoffProposal(), "Vou chamar o consultor.");
  const { root, clock, transport } = await makeRoot({ model });
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const result = await root.runTurn({
    persistence,
    conversationId: "conv-2",
    to: "5512999999999",
    workerId: "worker-2",
    turnId: "turn-handoff",
    eventId: "evt-handoff",
    messageText: "Gostei",
    receivedAt: NOW,
    limits,
    maxValidationAttempts: 2,
  });
  const outbox = await persistence.listOutbox("conv-2");
  check("handoff nao executa provider de CRM/handoff nesta fase", outbox.every((record) => record.kind !== "handoff" || record.status !== "succeeded"), JSON.stringify(outbox));
  check("pedido humano explicito nao fica refem de nome; adapter ausente falha fechado", result.status === "committed" && result.dispatched === 1 && transport.calls.length === 0 && outbox[0]?.kind === "handoff" && outbox[0].status === "failed", JSON.stringify({ outbox: outbox[0], calls: transport.calls.length }));
}

{
  const model = new ScriptedModel(replyProposal("t-retry", "Oi de novo", "Vamos continuar."), "Vamos continuar.");
  const { root, clock, transport } = await makeRoot({ model });
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const preInserted = await persistence.tryInsert({
    eventId: "evt-pending-retry",
    conversationId: "conv-pending-retry",
    raw: redact({ text: "Oi de novo" }),
    receivedAt: NOW,
  });
  const result = await root.runTurn({
    persistence,
    conversationId: "conv-pending-retry",
    to: "5512999999999",
    workerId: "worker-retry",
    turnId: "turn-pending-retry",
    eventId: "evt-pending-retry",
    messageText: "Oi de novo",
    receivedAt: NOW,
    limits,
    maxValidationAttempts: 2,
  });
  const inbox = await persistence.get("evt-pending-retry");
  check("pre-condicao do retry cria inbox pending", preInserted === true);
  check("retry retoma evento pending e commita", result.status === "committed" && result.inserted === true, JSON.stringify(result));
  check("retry de pending envia exatamente uma vez", result.dispatched === 1 && transport.calls.length === 1, JSON.stringify({ result, calls: transport.calls.length }));
  check("retry conclui inbox do evento original", inbox?.status === "done", JSON.stringify(inbox));
}
// ── R13-D (audit Codex): reconcileAcceptedPhotoOutcomes LIGADO em #processCentralActive ────────────────────────
// Prova o wiring pedido: gap DURÁVEL (send_media accepted, WM NÃO promovida por falha transitória) -> RESTART ->
// processConversation em central_active RECONCILIA antes do turno -> a resposta LEMBRA a foto -> mídia NÃO reenviada.
console.log("\nR13-D reconciliação durável no runtime central_active:");
{
  const CONV = "conv-reconcile-1";
  const clock = new FakeClock(NOW);
  const backing = createInMemoryBacking();

  // 1) GAP DURÁVEL: turno de foto (engine) + dispatch accepted, mas a promoção da WM FALHA (transiente).
  const p1 = new FailWmPromotion(clock, new FakeIdGen(), backing);
  const seed0 = createInitialState({ conversationId: CONV, tenantId: TENANT_ID, agentId: AGENT_ID, leadId: null, now: NOW });
  seed0.vehicleContext.selected = { kind: "vehicle", key: "rm:2", label: "Honda CRV 2010" };
  { const uow = p1.begin(); uow.casState(CONV, 0, seed0); await uow.commit(); }
  await p1.tryInsert({ eventId: `${CONV}-e1`, conversationId: CONV, raw: redact({ text: "manda as fotos" }), receivedAt: clock.now() });
  clock.advance(1000);
  const photoBrain = new ScriptedAgentBrain();
  photoBrain.setTurnScript([
    { kind: "query", call: { tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: "rm:2" } } } },
    { kind: "final", decision: { reasonCode: "send_photos", reasonSummary: "envia fotos", confidence: 0.9, responsePlan: { guidance: "Aqui estão as fotos 📸" }, proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan, rSendMedia("rm:2", RPHOTOS["rm:2"])], memoryMutations: [], stateMutations: [] } },
  ]);
  await runCentralConversationTurn({
    persistence: p1, clock, brain: photoBrain, llm: rLlm(), runQuery: rRunQuery, businessInfo: new RBusinessInfo(),
    contextPreparer: new RFixedPreparer(), conversationId: CONV, tenantId: TENANT_ID, agentId: AGENT_ID, leadId: null,
    workerId: "setup", turnId: `${CONV}-t1`, leaseTtlMs: 60_000, portalPromptSha256: "sha-fake",
    limits: { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 4, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" },
  });
  const acceptedDispatcher: EffectDispatcher = { async dispatch(rec: OutboxRecord) { return { status: "succeeded", effectId: rec.effectId, receipt: { effectId: rec.effectId, level: "accepted", at: clock.now() } }; } };
  const setupGate = new InMemoryEffectGate(); setupGate.setActiveMode(CONV, true);
  await new OutboxDispatcher(p1, clock, acceptedDispatcher, setupGate, "setup-d").dispatchConversation(CONV);
  const gapState = await p1.load(CONV);
  const gapWm = loadPersistedWorkingMemory(gapState?.state.workingMemory).memory;
  const gapMedia = (await p1.listOutbox(CONV)).find((o) => o.kind === "send_media");
  const gapApplied = gapState?.state.appliedAcceptedEffectIds ?? [];
  check("[gap] mídia succeeded/accepted, WM NÃO promovida, effect NÃO aplicado",
    !!gapMedia && gapMedia.status === "succeeded" && gapMedia.receiptLevel === "accepted" && gapWm.lastPhotoAction === null && !gapApplied.includes(gapMedia.effectId),
    JSON.stringify({ media: gapMedia?.status, receipt: gapMedia?.receiptLevel, wm: gapWm.lastPhotoAction, applied: gapApplied }));

  // 2) RESTART + recall via PilotActiveRoot central_active -> #processCentralActive reconcilia ANTES do turno.
  const p2 = new InMemoryPersistence(clock, new FakeIdGen(), backing);
  const recallBrain = new ScriptedAgentBrain();
  recallBrain.setTurnScript([rFinalReply("Deixa eu verificar aqui pra você.")]);
  const transport = new RecordingUazapiTransport();
  const root = await PilotActiveRoot.create({ mode: "active", tenantId: TENANT_ID, agentId: AGENT_ID }, {
    db: seed(), decryptor: new V2PlaintextApiKeyReader(), clock,
    model: new ScriptedModel(replyProposal("recall", "x", "x"), "Deixa eu verificar aqui pra você."),
    catalogSource: new StaticCatalogSource(), whatsappTransport: transport, allowedUazapiHosts: ["api.uazapi.example"],
    brainMode: "central_active", agentBrainFactory: () => recallBrain,
  });
  check("[root] modo central_active ativo", root.mode === "central_active", root.mode);
  clock.advance(2000);
  await p2.tryInsert({ eventId: `${CONV}-e2`, conversationId: CONV, raw: redact({ text: "qual foto eu pedi mesmo?" }), receivedAt: clock.now() });
  clock.advance(2000);
  const result = await root.processConversation({
    persistence: p2, conversationId: CONV, to: "5512999999999", workerId: "recall-w", turnId: `${CONV}-t2`,
    limits: { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 }, maxValidationAttempts: 2,
  });
  const afterState = await p2.load(CONV);
  const afterWm = loadPersistedWorkingMemory(afterState?.state.workingMemory).memory;
  const afterApplied = afterState?.state.appliedAcceptedEffectIds ?? [];
  const afterMedia = (await p2.listOutbox(CONV)).find((o) => o.kind === "send_media");
  const sentMsg = (await p2.listOutbox(CONV)).find((o) => o.kind === "send_message" && o.effectId === `${CONV}-t2:reply`);
  const sentText = typeof (sentMsg?.payload as any)?.text === "string" ? (sentMsg!.payload as any).text : "";

  check("[reconcile] processConversation promoveu a WM (lastPhotoAction = Honda CRV 2010)", afterWm.lastPhotoAction?.label === "Honda CRV 2010", `label=${afterWm.lastPhotoAction?.label}`);
  check("[reconcile] effect de foto marcado como aplicado (idempotência independente)", !!gapMedia && afterApplied.includes(gapMedia.effectId), JSON.stringify(afterApplied));
  check("[reconcile] o cérebro do turno VIU a memória reconciliada no frame", recallBrain.seenFrames[0]?.workingMemory.lastPhotoAction?.label === "Honda CRV 2010", `frame=${recallBrain.seenFrames[0]?.workingMemory.lastPhotoAction?.label}`);
  check("[reconcile] a resposta LEMBRA a foto do Honda CRV 2010", sentText.includes("Honda CRV 2010"), sentText.slice(0, 90));
  check("[reconcile] mídia NÃO reenviada (send_media segue succeeded; transporte só a msg de texto)", afterMedia?.status === "succeeded" && transport.calls.length === 1, `media=${afterMedia?.status} calls=${transport.calls.length}`);
  check("[reconcile] turno commitou e despachou exatamente 1 mensagem", result.status === "committed" && result.dispatched === 1, JSON.stringify({ status: result.status, dispatched: result.dispatched }));
}

if (fail > 0) {
  console.error(`\nACTIVE ROOT: ${ok} OK | ${fail} FALHA`);
  for (const item of failures) console.error(` - ${item}`);
  process.exit(1);
}
console.log(`\nACTIVE ROOT: ${ok} OK | 0 FALHA`);
