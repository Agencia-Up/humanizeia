import { PilotActiveRoot, PilotActiveRootError } from "../src/engine/pilot-active-root.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { V2PlaintextApiKeyReader } from "../src/adapters/read/v2-api-key-reader.ts";
import type { V2ColumnName, V2ReadDatabase, V2TableName, V2WhereEquals } from "../src/adapters/read/supabase-v2-read-adapter.ts";
import type { UazapiHttpRequest, UazapiHttpResponse, UazapiHttpTransport } from "../src/adapters/effects/uazapi-whatsapp-sender.ts";
import type { ComposeModelRequest, InterpretModelRequest, ProposeModelRequest, StructuredConversationModel } from "../src/domain/conversation-model.ts";
import type { ProposedDecision, TenantCatalog } from "../src/domain/decision.ts";
import type { TenantAgentRef } from "../src/domain/read-ports.ts";
import type { TenantCatalogSource } from "../src/engine/turn-context-preparer.ts";
import { redact } from "../src/domain/effect-intent.ts";

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
    proposedEffects: [{ kind: "handoff", planId: "handoff-1", order: 1, leadId: "11111111-1111-4111-8111-111111111111", sellerId: "seller-1", onSuccess: [] }],
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
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
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
  check("turno ativo commita", result.status === "committed", JSON.stringify(result));
  check("turno ativo despacha exatamente uma mensagem", result.dispatched === 1 && transport.calls.length === 1, JSON.stringify({ dispatched: result.dispatched, calls: transport.calls.length }));
  check("outbox fica accepted sem aplicar outcome delivered", outbox[0]?.status === "succeeded" && outbox[0].receiptLevel === "accepted" && outbox[0].outcomeAppliedAt === null, JSON.stringify(outbox[0]));
  check("memoria registra lead mas nao inventa entrega do agente em accepted", state?.state.recentTurns.some((t) => t.role === "lead" && t.text === "Boa noite") === true && state.state.recentTurns.every((t) => !(t.role === "agent" && t.text === "Oi, posso ajudar?")), JSON.stringify(state?.state.recentTurns));
  check("prompt do portal chega ao modelo", model.interpretCalls[0]?.binding.systemPrompt === "Voce e o Aloan.", JSON.stringify(model.interpretCalls[0]?.binding));

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
  check("handoff inseguro cai em resposta WhatsApp segura", result.status === "committed" && result.dispatched === 1 && transport.calls.length === 1 && outbox[0]?.kind === "send_message" && outbox[0].status === "succeeded", JSON.stringify({ outbox: outbox[0], calls: transport.calls.length }));
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
if (fail > 0) {
  console.error(`\nACTIVE ROOT: ${ok} OK | ${fail} FALHA`);
  for (const item of failures) console.error(` - ${item}`);
  process.exit(1);
}
console.log(`\nACTIVE ROOT: ${ok} OK | 0 FALHA`);
