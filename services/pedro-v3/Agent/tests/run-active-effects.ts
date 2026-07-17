import { WhatsAppEffectDispatcher, splitWhatsAppTextBubbles, type WhatsAppMediaInput, type WhatsAppSendPort, type WhatsAppSendResult, type WhatsAppTextInput } from "../src/adapters/effects/whatsapp-dispatcher.ts";
import { UazapiWhatsAppSender, normalizeUazapiDestination, type UazapiHttpRequest, type UazapiHttpResponse, type UazapiHttpTransport } from "../src/adapters/effects/uazapi-whatsapp-sender.ts";
import { createPilotWhatsAppDispatcher, type WhatsAppInstanceConfig, type WhatsAppInstanceSource } from "../src/adapters/effects/pilot-whatsapp-runtime.ts";
import { V2WhatsAppInstanceCredentialProvider, V2WhatsAppInstanceSource } from "../src/adapters/effects/v2-whatsapp-instance-source.ts";
import { V2PlaintextApiKeyReader } from "../src/adapters/read/v2-api-key-reader.ts";
import { FakeCredentialProvider } from "../src/adapters/read/fakes/fake-credential-provider.ts";
import { makeSecretRef } from "../src/domain/credential-provider.ts";
import { FakeClock, FakeIdGen, InMemoryPersistence } from "../src/adapters/persistence/in-memory-store.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import type { ConfigResult, TenantAgentRef, TenantConfigSource, TenantRuntimeConfig, VehiclePhotoSource, PhotoResolveResult } from "../src/domain/read-ports.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { V2ColumnName, V2ReadDatabase, V2TableName, V2WhereEquals } from "../src/adapters/read/supabase-v2-read-adapter.ts";
import { InMemoryEffectGate } from "../src/engine/effect-gate.ts";
import { OutboxDispatcher } from "../src/engine/outbox-dispatcher.ts";

const NOW = "2026-06-28T18:00:00.000Z";
const ref: TenantAgentRef = { tenantId: "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0", agentId: "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185" };

let ok = 0;
let fail = 0;
const fails: string[] = [];

function check(group: string, name: string, pass: boolean, detail = ""): void {
  if (pass) {
    ok += 1;
    console.log(`  OK  [${group}] ${name}`);
  } else {
    fail += 1;
    fails.push(`[${group}] ${name}${detail ? ` - ${detail}` : ""}`);
    console.error(`  RED [${group}] ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

class FakePhotoSource implements VehiclePhotoSource {
  constructor(private readonly urlsByVehicle: Record<string, Record<string, string>>) {}

  async resolvePhotos(_ref: TenantAgentRef, vehicleKey: string): Promise<PhotoResolveResult> {
    const urls = this.urlsByVehicle[vehicleKey];
    if (!urls) return { vehicleKey, ambiguous: true, photoIds: [] };
    return { vehicleKey, ambiguous: false, photoIds: Object.keys(urls) };
  }

  async resolveUrls(_ref: TenantAgentRef, vehicleKey: string, photoIds: readonly string[]): Promise<readonly string[]> {
    const urls = this.urlsByVehicle[vehicleKey];
    if (!urls) return [];
    const out = photoIds.map((photoId) => urls[photoId]).filter((url): url is string => typeof url === "string");
    return out.length === photoIds.length ? out : [];
  }
}

class RecordingSender implements WhatsAppSendPort {
  readonly texts: WhatsAppTextInput[] = [];
  readonly images: WhatsAppMediaInput[] = [];
  textResult: WhatsAppSendResult = { ok: true, level: "accepted", providerMessageId: "msg-text" };
  imageResults: WhatsAppSendResult[] = [];
  throwText = false;
  throwImage = false;

  async sendText(input: WhatsAppTextInput): Promise<WhatsAppSendResult> {
    this.texts.push(input);
    if (this.throwText) throw new Error("SECRET-TOKEN should not leak");
    return this.textResult;
  }

  async sendImage(input: WhatsAppMediaInput): Promise<WhatsAppSendResult> {
    this.images.push(input);
    if (this.throwImage) throw new Error("https://secret.example/token");
    return this.imageResults.shift() ?? { ok: true, level: "accepted", providerMessageId: `img-${input.photoId}` };
  }
}

type UazapiCall = { readonly url: string; readonly request: UazapiHttpRequest };

class FakeUazapiTransport implements UazapiHttpTransport {
  readonly calls: UazapiCall[] = [];
  responses: UazapiHttpResponse[] = [];
  throwAbort = false;
  throwError = false;

  async postJson(url: string, request: UazapiHttpRequest): Promise<UazapiHttpResponse> {
    this.calls.push({ url, request });
    if (this.throwAbort) {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    if (this.throwError) throw new Error("SECRET-UAZAPI-TOKEN should not leak");
    return this.responses.shift() ?? { ok: true, status: 200, json: { messageid: "uazapi-msg" } };
  }
}

function tenantConfig(instanceId: string | null): TenantRuntimeConfig {
  return Object.freeze({
    tenantId: ref.tenantId,
    agentId: ref.agentId,
    agentName: "Aloan",
    companyName: null,
    instanceId,
    promptText: "Prompt do portal",
    promptSource: "raw_system_prompt",
    model: "openai/gpt-4.1-mini",
    temperature: 0.3,
    sdrGoal: null,
    qualificationQuestions: null,
    sellsMotorcycles: false,
    blockedCategories: [],
    ragRestricted: false,
    stockProvider: "none",
    stockSecretRef: null,
    versionStamp: "v-test",
  });
}

class FakeTenantConfigSource implements TenantConfigSource {
  constructor(private readonly result: ConfigResult) {}
  async load(_ref: TenantAgentRef): Promise<ConfigResult> { return this.result; }
}

class FakeWhatsAppInstanceSource implements WhatsAppInstanceSource {
  constructor(private readonly instances: Record<string, WhatsAppInstanceConfig>) {}
  async loadOwnedInstance(_ref: TenantAgentRef, instanceId: string): Promise<WhatsAppInstanceConfig | null> {
    return this.instances[instanceId] ?? null;
  }
}

type V2DbCall = { readonly op: "one" | "many"; readonly table: V2TableName; readonly columns: readonly V2ColumnName[]; readonly where: V2WhereEquals };

class TinyV2ReadDatabase implements V2ReadDatabase {
  readonly calls: V2DbCall[] = [];
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

function makeUazapiSender(args: { transport?: FakeUazapiTransport; material?: string; baseUrl?: string; allowedHosts?: readonly string[]; instanceName?: string | null } = {}): { sender: UazapiWhatsAppSender; transport: FakeUazapiTransport; credentials: FakeCredentialProvider } {
  const transport = args.transport ?? new FakeUazapiTransport();
  const tokenRef = makeSecretRef({ tenantId: ref.tenantId, integrationId: "wa-inst-1", provider: "uazapi", purpose: "whatsapp_instance" });
  const credentials = new FakeCredentialProvider({
    "wa-inst-1": { tenantId: ref.tenantId, provider: "uazapi", material: args.material ?? "SECRET-UAZAPI-TOKEN" },
  });
  const sender = new UazapiWhatsAppSender({
    baseUrl: args.baseUrl ?? "https://api.uazapi.example/base",
    allowedHosts: args.allowedHosts ?? ["api.uazapi.example"],
    instanceName: args.instanceName ?? "pilot-instance",
    tokenRef,
    timeoutMs: 250,
    typingDelay: { minMs: 0, maxMs: 0, sleep: async () => undefined },
  }, credentials, transport);
  return { sender, transport, credentials };
}

function baseRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  const turnId = overrides.turnId ?? "turn-1";
  const planId = overrides.planId ?? "msg";
  const effectId = overrides.effectId ?? `${turnId}:${planId}`;
  return {
    effectId,
    conversationId: overrides.conversationId ?? "conv-1",
    turnId,
    planId,
    kind: overrides.kind ?? "send_message",
    idempotencyKey: overrides.idempotencyKey ?? effectId,
    order: overrides.order ?? 1,
    dependsOn: overrides.dependsOn ?? [],
    payload: overrides.payload ?? redact({ text: "Ola, posso te ajudar." }),
    onSuccess: overrides.onSuccess ?? [],
    status: overrides.status ?? "pending",
    providerCapability: overrides.providerCapability ?? "none",
    receiptLevel: overrides.receiptLevel ?? null,
    attempts: overrides.attempts ?? 0,
    nextRetryAt: overrides.nextRetryAt ?? null,
    providerReceipt: overrides.providerReceipt ?? null,
    outcomeAppliedAt: overrides.outcomeAppliedAt ?? null,
    lastError: overrides.lastError ?? null,
    terminalAt: overrides.terminalAt ?? null,
    processingBy: overrides.processingBy ?? null,
    processingToken: overrides.processingToken ?? null,
    processingExpiresAt: overrides.processingExpiresAt ?? null,
    createdAt: overrides.createdAt ?? NOW,
    dispatchedAt: overrides.dispatchedAt ?? null,
  };
}

function makeDispatcher(args: { sender?: RecordingSender; photoSource?: VehiclePhotoSource; conversationId?: string } = {}): { dispatcher: WhatsAppEffectDispatcher; sender: RecordingSender; clock: FakeClock } {
  const clock = new FakeClock(NOW);
  const sender = args.sender ?? new RecordingSender();
  const photoSource = args.photoSource ?? new FakePhotoSource({ "veh-1": { p1: "https://cdn.example/p1.jpg", p2: "https://cdn.example/p2.jpg" } });
  return {
    clock,
    sender,
    dispatcher: new WhatsAppEffectDispatcher({
      ref,
      conversationId: args.conversationId ?? "conv-1",
      to: "5512999999999",
      clock,
      sender,
      photoSource,
    }),
  };
}

function storeWith(record: OutboxRecord): { p: InMemoryPersistence; clock: FakeClock; gate: InMemoryEffectGate } {
  const clock = new FakeClock(NOW);
  const p = new InMemoryPersistence(clock, new FakeIdGen());
  const gate = new InMemoryEffectGate();
  gate.setActiveMode(record.conversationId, true);
  const u = p.begin();
  u.casState(record.conversationId, 0, createInitialState({ conversationId: record.conversationId, tenantId: ref.tenantId, agentId: ref.agentId, now: NOW }));
  u.appendOutbox([record]);
  const committed = u.commit();
  if (!committed.ok) throw new Error(committed.reason);
  return { p, clock, gate };
}

console.log("\n=== F2.6B - active WhatsApp effects (fake sender, no network) ===\n");

// 1) Text validation: missing text fails closed and does not call sender.
{
  const { dispatcher, sender } = makeDispatcher();
  const result = await dispatcher.dispatch(baseRecord({ payload: redact({ text: "" }) }));
  check("text", "missing text returns failed validation", result.status === "failed" && result.error.code === "VALIDATION", JSON.stringify(result));
  check("text", "missing text does not call sender", sender.texts.length === 0, String(sender.texts.length));
}

// 2) Accepted text without onSuccess is enough for non-critical messages.
{
  const { dispatcher, sender } = makeDispatcher();
  sender.textResult = { ok: true, level: "accepted", providerMessageId: "accepted-1" };
  const result = await dispatcher.dispatch(baseRecord());
  check("text", "accepted text succeeds", result.status === "succeeded" && result.receipt.level === "accepted", JSON.stringify(result));
  check("text", "text uses effectId as idempotency key", sender.texts[0]?.idempotencyKey === "turn-1:msg", JSON.stringify(sender.texts));
}

// 2b) Parágrafos autorados pela LLM viram dois balões; listas ficam inteiras.
{
  const intro = "Boa tarde! Sou o Carvalho, consultor aqui de IA da Icom Motors 😊 Você é aqui de Taubaté mesmo já conhece a nossa loja?";
  const vehicle = "Vi que você se interessou no HB20X. Tenho ele disponível.";
  const { dispatcher, sender } = makeDispatcher();
  const result = await dispatcher.dispatch(baseRecord({ payload: redact({ text: `${intro}\n\n${vehicle}` }) }));
  check("text", "dois parágrafos conversacionais viram dois balões", result.status === "succeeded" && sender.texts.length === 2
    && sender.texts[0]?.text === intro && sender.texts[1]?.text === vehicle, JSON.stringify(sender.texts));
  check("text", "balões usam idempotência estável por parte", sender.texts[0]?.idempotencyKey === "turn-1:msg:bubble:1"
    && sender.texts[1]?.idempotencyKey === "turn-1:msg:bubble:2", JSON.stringify(sender.texts));
  const list = "Encontrei estas opções:\n\n1. HB20X 2019 - R$ 76.990\n\n2. Onix 2020 - R$ 79.990";
  check("text", "lista numerada nunca é quebrada em balões", splitWhatsAppTextBubbles(list).length === 1);
}

// 3) F2.7.4: send_message com SO append_assistant_turn = accepted-safe -> grava a MEMORIA do agente no
//    ACCEPTED (o agente lembra do que ENVIOU; nao depende do callback delivered, que pode nao chegar).
{
  const record = baseRecord({
    onSuccess: [{ op: "append_assistant_turn", effectId: "turn-1:msg", turn: { role: "agent", text: "Pergunta entregue", at: NOW } }],
  });
  const { p, clock, gate } = storeWith(record);
  const sender = new RecordingSender();
  sender.textResult = { ok: true, level: "accepted", providerMessageId: "accepted-critical" };
  const effectDispatcher = makeDispatcher({ sender }).dispatcher;
  const outbox = new OutboxDispatcher(p, clock, effectDispatcher, gate);
  const count = await outbox.dispatchConversation("conv-1");
  const state = p.load("conv-1")?.state;
  const row = p.listOutbox("conv-1")[0];
  check("receipt", "send_message accepted dispatches once", count === 1, String(count));
  check("receipt", "F2.7.4 append_assistant_turn aplica no accepted", row.receiptLevel === "accepted" && row.outcomeAppliedAt != null, JSON.stringify(row));
  check("receipt", "F2.7.4 memoria do agente gravada no accepted", state?.recentTurns.some((turn) => turn.role === "agent" && turn.text === "Pergunta entregue") === true, JSON.stringify(state?.recentTurns));
}

// 3b) F2.7.4 SEPARACAO RIGIDA: send_message com outcome que EXIGE delivered (mark_message_delivered) NAO
//     aplica no accepted — nem a memoria do agente avanca (espera o delivered real). Nao se inventa delivered.
{
  const record = baseRecord({
    onSuccess: [
      { op: "append_assistant_turn", effectId: "turn-1:msg", turn: { role: "agent", text: "Pergunta entregue", at: NOW } },
      { op: "mark_message_delivered", effectId: "turn-1:msg", messageId: "m-1" },
    ],
  });
  const { p, clock, gate } = storeWith(record);
  const sender = new RecordingSender();
  sender.textResult = { ok: true, level: "accepted", providerMessageId: "accepted-mixed" };
  const effectDispatcher = makeDispatcher({ sender }).dispatcher;
  const outbox = new OutboxDispatcher(p, clock, effectDispatcher, gate);
  await outbox.dispatchConversation("conv-1");
  const state = p.load("conv-1")?.state;
  const row = p.listOutbox("conv-1")[0];
  check("receipt", "F2.7.4 record que exige delivered NAO aplica no accepted", row.receiptLevel === "accepted" && row.outcomeAppliedAt == null, JSON.stringify(row));
  check("receipt", "F2.7.4 memoria NAO grava no accepted quando exige delivered", state?.recentTurns.every((turn) => turn.role !== "agent") === true, JSON.stringify(state?.recentTurns));
}

// 4) Critical text with delivered receipt advances memory.
{
  const record = baseRecord({
    onSuccess: [{ op: "append_assistant_turn", effectId: "turn-1:msg", turn: { role: "agent", text: "Pergunta entregue", at: NOW } }],
  });
  const { p, clock, gate } = storeWith(record);
  const sender = new RecordingSender();
  sender.textResult = { ok: true, level: "delivered", providerMessageId: "delivered-critical" };
  const effectDispatcher = makeDispatcher({ sender }).dispatcher;
  const outbox = new OutboxDispatcher(p, clock, effectDispatcher, gate);
  await outbox.dispatchConversation("conv-1");
  const state = p.load("conv-1")?.state;
  const row = p.listOutbox("conv-1")[0];
  check("receipt", "delivered outcome applied", row.receiptLevel === "delivered" && row.outcomeAppliedAt != null, JSON.stringify(row));
  check("receipt", "agent memory appended on delivered", state?.recentTurns.some((turn) => turn.role === "agent" && turn.text === "Pergunta entregue") === true, JSON.stringify(state?.recentTurns));
}

// 5) Media resolves current URLs and uses photo-scoped idempotency keys.
{
  const { dispatcher, sender } = makeDispatcher();
  sender.imageResults = [
    { ok: true, level: "delivered", providerMessageId: "img-p1" },
    { ok: true, level: "delivered", providerMessageId: "img-p2" },
  ];
  const result = await dispatcher.dispatch(baseRecord({
    kind: "send_media",
    planId: "photos",
    effectId: "turn-1:photos",
    idempotencyKey: "turn-1:photos",
    payload: redact({ vehicleKey: "veh-1", photoIds: ["p1", "p2"] }),
  }));
  check("media", "media delivered with perItem", result.status === "succeeded" && result.receipt.level === "delivered" && result.receipt.perItem?.length === 2, JSON.stringify(result));
  check("media", "media sender receives resolved urls", sender.images[0]?.url === "https://cdn.example/p1.jpg" && sender.images[1]?.url === "https://cdn.example/p2.jpg", JSON.stringify(sender.images));
  check("media", "media idempotency key is scoped by photo", sender.images[0]?.idempotencyKey === "turn-1:photos:p1" && sender.images[1]?.idempotencyKey === "turn-1:photos:p2", JSON.stringify(sender.images));
}

// 6) Media missing/ambiguous references fail closed and do not send images.
{
  const { dispatcher, sender } = makeDispatcher();
  const result = await dispatcher.dispatch(baseRecord({
    kind: "send_media",
    planId: "photos",
    effectId: "turn-1:photos",
    payload: redact({ vehicleKey: "veh-missing", photoIds: ["p1"] }),
  }));
  check("media", "unresolvable media reference fails closed", result.status === "failed" && result.error.code === "VALIDATION", JSON.stringify(result));
  check("media", "unresolvable media sends nothing", sender.images.length === 0, String(sender.images.length));
}

// 7) Delivered media applies only confirmed perItem photo IDs to the ledger.
{
  const record = baseRecord({
    kind: "send_media",
    planId: "photos",
    effectId: "turn-1:photos",
    idempotencyKey: "turn-1:photos",
    payload: redact({ vehicleKey: "veh-1", photoIds: ["p1", "p2"] }),
    onSuccess: [{ op: "mark_photos_sent", effectId: "turn-1:photos", vehicleKey: "veh-1", photoIds: ["p1", "p2"] }],
  });
  const { p, clock, gate } = storeWith(record);
  const sender = new RecordingSender();
  sender.imageResults = [
    { ok: true, level: "delivered", providerMessageId: "img-p1" },
    { ok: true, level: "delivered", providerMessageId: "img-p2" },
  ];
  const effectDispatcher = makeDispatcher({ sender }).dispatcher;
  const outbox = new OutboxDispatcher(p, clock, effectDispatcher, gate);
  await outbox.dispatchConversation("conv-1");
  const state = p.load("conv-1")?.state;
  check("media", "delivered media updates photo ledger", JSON.stringify(state?.photoLedger.sentByVehicle["veh-1"]) === JSON.stringify(["p1", "p2"]), JSON.stringify(state?.photoLedger));
}

// 8) Sender exception is sanitized as outcome_uncertain; raw secret is not persisted.
{
  const record = baseRecord();
  const { p, clock, gate } = storeWith(record);
  const sender = new RecordingSender();
  sender.throwText = true;
  const effectDispatcher = makeDispatcher({ sender }).dispatcher;
  const outbox = new OutboxDispatcher(p, clock, effectDispatcher, gate);
  await outbox.dispatchConversation("conv-1");
  const row = p.listOutbox("conv-1")[0];
  const serialized = JSON.stringify(row);
  check("safety", "sender exception becomes outcome_uncertain", row.status === "outcome_uncertain", JSON.stringify(row));
  check("safety", "sender exception does not leak token", !serialized.includes("SECRET-TOKEN"), serialized);
  // F2.6Q: o reason ganha um label SEGURO (name+code do erro, ex.: "Error"), nunca a mensagem (que poderia
  // vazar token). Confirma que diagnosticamos a causa sem vazar.
  check("safety", "sender exception reason inclui label seguro sem mensagem", serialized.includes("sender_text_exception:Error"), serialized);
}

// 9) Conversation mismatch blocks dispatch.
{
  const { dispatcher, sender } = makeDispatcher({ conversationId: "conv-expected" });
  const result = await dispatcher.dispatch(baseRecord({ conversationId: "conv-other" }));
  check("safety", "conversation mismatch is forbidden", result.status === "failed" && result.error.code === "FORBIDDEN", JSON.stringify(result));
  check("safety", "conversation mismatch does not call sender", sender.texts.length === 0 && sender.images.length === 0, JSON.stringify({ texts: sender.texts, images: sender.images }));
}

// 10) Unsupported commercial effects remain blocked in WhatsApp dispatcher.
{
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.dispatch(baseRecord({ kind: "handoff", payload: redact({ leadId: "lead", sellerId: "seller" }) }));
  check("safety", "unsupported effect kind fails closed", result.status === "failed" && result.error.code === "FORBIDDEN", JSON.stringify(result));
}


// 11) Uazapi sender normalizes destination and sends accepted-only text through safe injected transport.
{
  const { sender, transport, credentials } = makeUazapiSender();
  const result = await sender.sendText({ to: "(12) 99999-9999", text: "Oi", idempotencyKey: "idem-1" });
  const body = JSON.parse(transport.calls[0]?.request.body ?? "{}");
  check("uazapi", "destination normalization adds Brazil country code", normalizeUazapiDestination("(12) 99999-9999") === "5512999999999");
  check("uazapi", "text uses /send/text first", transport.calls[0]?.url === "https://api.uazapi.example/base/send/text", JSON.stringify(transport.calls));
  check("uazapi", "text body is compatible with Uazapi number endpoint", body.number === "5512999999999" && body.text === "Oi", JSON.stringify(body));
  check("uazapi", "text carries stable tracking id for receipt correlation", body.track_source === "pedro_v3" && body.track_id === "idem-1", JSON.stringify(body));
  check("uazapi", "Uazapi HTTP OK is accepted, not delivered", result.ok && result.level === "accepted" && result.providerMessageId === "uazapi-msg", JSON.stringify(result));
  check("uazapi", "credential resolved only at send time", credentials.resolveCount === 1, String(credentials.resolveCount));
}

// 12) Uazapi text retries compatible fallback endpoints without leaking secret in returned error.
{
  const transport = new FakeUazapiTransport();
  transport.responses = [
    { ok: false, status: 500, text: "SECRET-UAZAPI-TOKEN https://api.uazapi.example" },
    { ok: true, status: 200, json: { data: { id: "fallback-ok" } } },
  ];
  const { sender } = makeUazapiSender({ transport });
  const result = await sender.sendText({ to: "5512999999999", text: "Oi", idempotencyKey: "idem-2" });
  const serialized = JSON.stringify(result);
  check("uazapi", "text retries remoteJid fallback after retryable 500", result.ok && result.providerMessageId === "fallback-ok" && transport.calls.length === 2, JSON.stringify({ result, calls: transport.calls.map(c => c.url) }));
  check("uazapi", "failed body with token is not returned", !serialized.includes("SECRET-UAZAPI-TOKEN") && !serialized.includes("api.uazapi.example"), serialized);
}

// 12b) O indicador visual e best-effort e acontece apenas quando o dispatcher envia ao lead.
{
  const { sender, transport } = makeUazapiSender();
  const result = await sender.sendText({ to: "5512999999999", text: "Oi, posso ajudar?", idempotencyKey: "typing-1", showTyping: true });
  const calls = transport.calls.map((call) => ({ url: call.url, body: JSON.parse(call.request.body) as Record<string, unknown> }));
  check("uazapi", "typing envia composing antes do texto", calls[0]?.url.endsWith("/message/presence") && calls[0]?.body.presence === "composing", JSON.stringify(calls));
  check("uazapi", "typing envia texto entre composing e paused", calls[1]?.url.endsWith("/send/text") && calls[2]?.url.endsWith("/message/presence") && calls[2]?.body.presence === "paused", JSON.stringify(calls));
  check("uazapi", "typing preserva a entrega do texto", result.ok && result.level === "accepted", JSON.stringify(result));
}

// 13) Uazapi media sends only HTTPS media URL and returns accepted.
{
  const { sender, transport } = makeUazapiSender();
  const result = await sender.sendImage({ to: "5512999999999", url: "https://cdn.example/car.jpg", photoId: "p1", idempotencyKey: "idem-p1" });
  const body = JSON.parse(transport.calls[0]?.request.body ?? "{}");
  check("uazapi", "media uses /send/media", transport.calls[0]?.url === "https://api.uazapi.example/base/send/media", JSON.stringify(transport.calls));
  check("uazapi", "media body is image payload", body.number === "5512999999999" && body.file === "https://cdn.example/car.jpg" && body.type === "image", JSON.stringify(body));
  check("uazapi", "media HTTP OK is accepted", result.ok && result.level === "accepted", JSON.stringify(result));
}

// 14) Uazapi validation fails closed before resolving secrets or calling transport.
{
  const { sender, transport, credentials } = makeUazapiSender();
  const badPhone = await sender.sendText({ to: "abc", text: "Oi", idempotencyKey: "bad-phone" });
  const badMedia = await sender.sendImage({ to: "5512999999999", url: "http://cdn.example/car.jpg", photoId: "p1", idempotencyKey: "bad-media" });
  check("uazapi", "invalid phone fails validation", !badPhone.ok && badPhone.code === "VALIDATION", JSON.stringify(badPhone));
  check("uazapi", "http media URL fails validation", !badMedia.ok && badMedia.code === "VALIDATION", JSON.stringify(badMedia));
  check("uazapi", "validation failures do not resolve secret or call HTTP", credentials.resolveCount === 0 && transport.calls.length === 0, JSON.stringify({ resolves: credentials.resolveCount, calls: transport.calls.length }));
}

// 15) Uazapi config and runtime errors are fail-closed and sanitized.
{
  let rejectedHttp = false;
  try { makeUazapiSender({ baseUrl: "http://api.uazapi.example" }); } catch { rejectedHttp = true; }
  let rejectedHost = false;
  try { makeUazapiSender({ allowedHosts: ["other.example"] }); } catch { rejectedHost = true; }
  const transport = new FakeUazapiTransport();
  transport.throwError = true;
  const { sender } = makeUazapiSender({ transport });
  const result = await sender.sendText({ to: "5512999999999", text: "Oi", idempotencyKey: "idem-err" });
  const serialized = JSON.stringify(result);
  check("uazapi", "http base URL rejected", rejectedHttp);
  check("uazapi", "host outside allowlist rejected", rejectedHost);
  check("uazapi", "transport exception is retryable upstream failure", !result.ok && result.code === "UPSTREAM" && result.retryable, JSON.stringify(result));
  check("uazapi", "transport exception does not leak secret", !serialized.includes("SECRET-UAZAPI-TOKEN"), serialized);
}

// 16) Uazapi sender JSON never exposes the resolved token.
{
  const { sender } = makeUazapiSender();
  const serialized = JSON.stringify(sender);
  check("uazapi", "sender JSON has no token material", !serialized.includes("SECRET-UAZAPI-TOKEN") && !serialized.includes("apikey") && !serialized.includes("api_key"), serialized);
}

// 17) Pilot runtime factory blocks missing instance before creating any sender.
{
  const tokenRef = makeSecretRef({ tenantId: ref.tenantId, integrationId: "wa-inst-1", provider: "uazapi", purpose: "whatsapp_instance" });
  const result = await createPilotWhatsAppDispatcher({ ref, conversationId: "conv-1", to: "5512999999999", allowedUazapiHosts: ["api.uazapi.example"] }, {
    configSource: new FakeTenantConfigSource({ ok: true, config: tenantConfig(null) }),
    instanceSource: new FakeWhatsAppInstanceSource({ "wa-inst-1": { tenantId: ref.tenantId, instanceId: "wa-inst-1", provider: "uazapi", apiUrl: "https://api.uazapi.example", instanceName: "pilot", tokenRef } }),
    credentialProvider: new FakeCredentialProvider({ "wa-inst-1": { tenantId: ref.tenantId, provider: "uazapi", material: "SECRET-UAZAPI-TOKEN" } }),
    httpTransport: new FakeUazapiTransport(),
    photoSource: new FakePhotoSource({}),
    clock: new FakeClock(NOW),
  });
  check("pilot-runtime", "agent without instance is blocked", !result.ok && result.error === "AGENT_WITHOUT_INSTANCE", JSON.stringify(result));
}

// 18) Pilot runtime factory creates a dispatcher only for owned Uazapi instance.
{
  const tokenRef = makeSecretRef({ tenantId: ref.tenantId, integrationId: "wa-inst-1", provider: "uazapi", purpose: "whatsapp_instance" });
  const transport = new FakeUazapiTransport();
  const result = await createPilotWhatsAppDispatcher({ ref, conversationId: "conv-1", to: "5512999999999", allowedUazapiHosts: ["api.uazapi.example"] }, {
    configSource: new FakeTenantConfigSource({ ok: true, config: tenantConfig("wa-inst-1") }),
    instanceSource: new FakeWhatsAppInstanceSource({ "wa-inst-1": { tenantId: ref.tenantId, instanceId: "wa-inst-1", provider: "uazapi", apiUrl: "https://api.uazapi.example", instanceName: "pilot", tokenRef } }),
    credentialProvider: new FakeCredentialProvider({ "wa-inst-1": { tenantId: ref.tenantId, provider: "uazapi", material: "SECRET-UAZAPI-TOKEN" } }),
    httpTransport: transport,
    photoSource: new FakePhotoSource({}),
    clock: new FakeClock(NOW),
  });
  check("pilot-runtime", "owned Uazapi instance creates dispatcher", result.ok && result.instanceId === "wa-inst-1", JSON.stringify(result));
  if (result.ok) {
    const dispatch = await result.dispatcher.dispatch(baseRecord());
    check("pilot-runtime", "runtime dispatcher sends through Uazapi sender", dispatch.status === "succeeded" && dispatch.receipt.level === "accepted" && transport.calls.length === 1, JSON.stringify({ dispatch, calls: transport.calls.length }));
  }
}

// 19) Pilot runtime factory blocks ownership mismatch and unsupported provider.
{
  const tokenRef = makeSecretRef({ tenantId: ref.tenantId, integrationId: "wa-inst-1", provider: "uazapi", purpose: "whatsapp_instance" });
  const commonDeps = {
    configSource: new FakeTenantConfigSource({ ok: true, config: tenantConfig("wa-inst-1") }),
    credentialProvider: new FakeCredentialProvider({ "wa-inst-1": { tenantId: ref.tenantId, provider: "uazapi", material: "SECRET-UAZAPI-TOKEN" } }),
    httpTransport: new FakeUazapiTransport(),
    photoSource: new FakePhotoSource({}),
    clock: new FakeClock(NOW),
  };
  const mismatch = await createPilotWhatsAppDispatcher({ ref, conversationId: "conv-1", to: "5512999999999", allowedUazapiHosts: ["api.uazapi.example"] }, {
    ...commonDeps,
    instanceSource: new FakeWhatsAppInstanceSource({ "wa-inst-1": { tenantId: "other-tenant", instanceId: "wa-inst-1", provider: "uazapi", apiUrl: "https://api.uazapi.example", instanceName: "pilot", tokenRef } }),
  });
  const unsupported = await createPilotWhatsAppDispatcher({ ref, conversationId: "conv-1", to: "5512999999999", allowedUazapiHosts: ["api.uazapi.example"] }, {
    ...commonDeps,
    instanceSource: new FakeWhatsAppInstanceSource({ "wa-inst-1": { tenantId: ref.tenantId, instanceId: "wa-inst-1", provider: "unsupported", apiUrl: "https://api.uazapi.example", instanceName: "pilot", tokenRef } }),
  });
  check("pilot-runtime", "instance ownership mismatch is blocked", !mismatch.ok && mismatch.error === "INSTANCE_OWNERSHIP_MISMATCH", JSON.stringify(mismatch));
  check("pilot-runtime", "unsupported provider is blocked", !unsupported.ok && unsupported.error === "INSTANCE_PROVIDER_UNSUPPORTED", JSON.stringify(unsupported));
}

// 20) V2 wa_instances source reads metadata without selecting token columns.
{
  const db = new TinyV2ReadDatabase({
    wa_instances: [{ id: "wa-inst-real", user_id: ref.tenantId, instance_name: "real", api_url: "https://api.uazapi.example", provider: null, api_key_encrypted: "SECRET-UAZAPI-TOKEN" }],
  });
  const source = new V2WhatsAppInstanceSource(db);
  const instance = await source.loadOwnedInstance(ref, "wa-inst-real");
  const call = db.calls[0];
  check("v2-wa-instance", "owned wa_instance metadata loads as uazapi", instance?.provider === "uazapi" && instance.apiUrl === "https://api.uazapi.example" && instance.tokenRef.provider === "uazapi", JSON.stringify(instance));
  check("v2-wa-instance", "metadata query does not select token columns", call?.table === "wa_instances" && !call.columns.includes("api_key_encrypted") && !call.columns.includes("api_key"), JSON.stringify(call));
}

// 21) V2 wa_instances credential provider resolves token only for owned uazapi instance.
{
  const db = new TinyV2ReadDatabase({
    wa_instances: [{ id: "wa-inst-real", user_id: ref.tenantId, provider: "uazapi", api_key_encrypted: JSON.stringify({ api_key: "SECRET-UAZAPI-TOKEN" }) }],
  });
  const provider = new V2WhatsAppInstanceCredentialProvider(db, new V2PlaintextApiKeyReader());
  const tokenRef = makeSecretRef({ tenantId: ref.tenantId, integrationId: "wa-inst-real", provider: "uazapi", purpose: "whatsapp_instance" });
  const result = await provider.resolve(tokenRef);
  const call = db.calls[0];
  check("v2-wa-instance", "credential provider resolves uazapi token", result.ok && result.secret.material === "SECRET-UAZAPI-TOKEN", JSON.stringify(result));
  check("v2-wa-instance", "credential query is scoped by id and tenant", call?.where.id === "wa-inst-real" && call.where.user_id === ref.tenantId, JSON.stringify(call));
  // F2.6Q: wa_instances NAO tem coluna `api_key` (so `api_key_encrypted`). Selecionar `api_key` gerava
  // 400 no PostgREST real -> sender_text_exception. A query deve pedir api_key_encrypted e NUNCA api_key.
  check("v2-wa-instance", "credential query nao seleciona coluna inexistente api_key", !!call && call.columns.includes("api_key_encrypted") && !call.columns.includes("api_key"), JSON.stringify(call));
}

// 22) Legacy `evolution` rows are Uazapi-backed and remain executable.
{
  const db = new TinyV2ReadDatabase({
    wa_instances: [{ id: "wa-evolution", user_id: ref.tenantId, instance_name: "legacy", api_url: "https://api.uazapi.example", provider: "evolution", api_key_encrypted: "SECRET-UAZAPI-TOKEN" }],
  });
  const source = new V2WhatsAppInstanceSource(db);
  const instance = await source.loadOwnedInstance(ref, "wa-evolution");
  const provider = new V2WhatsAppInstanceCredentialProvider(db, new V2PlaintextApiKeyReader());
  const secret = await provider.resolve(makeSecretRef({ tenantId: ref.tenantId, integrationId: "wa-evolution", provider: "uazapi", purpose: "whatsapp_instance" }));
  check("v2-wa-instance", "legacy evolution label uses the proven uazapi transport", instance?.provider === "uazapi" && instance.apiUrl === "https://api.uazapi.example", JSON.stringify(instance));
  check("v2-wa-instance", "legacy evolution label resolves its owned uazapi credential", secret.ok && secret.secret.material === "SECRET-UAZAPI-TOKEN", JSON.stringify(secret));
}

// 23) V2 wa_instances source and credentials fail closed on cross-tenant/provider mismatch.
{
  const db = new TinyV2ReadDatabase({
    wa_instances: [
      { id: "wa-cross", user_id: "other-tenant", instance_name: "cross", api_url: "https://api.uazapi.example", provider: "uazapi", api_key_encrypted: "SECRET-UAZAPI-TOKEN" },
      { id: "wa-meta", user_id: ref.tenantId, instance_name: "meta", api_url: "https://graph.facebook.com", provider: "meta", api_key_encrypted: "META-TOKEN" },
    ],
  });
  const source = new V2WhatsAppInstanceSource(db);
  const cross = await source.loadOwnedInstance(ref, "wa-cross");
  const meta = await source.loadOwnedInstance(ref, "wa-meta");
  const provider = new V2WhatsAppInstanceCredentialProvider(db, new V2PlaintextApiKeyReader());
  const metaSecret = await provider.resolve(makeSecretRef({ tenantId: ref.tenantId, integrationId: "wa-meta", provider: "uazapi", purpose: "whatsapp_instance" }));
  check("v2-wa-instance", "cross-tenant instance is not returned", cross === null, JSON.stringify(cross));
  check("v2-wa-instance", "meta instance is surfaced as unsupported provider for runtime block", meta?.provider !== "uazapi", JSON.stringify(meta));
  check("v2-wa-instance", "meta token is not resolved by uazapi credential provider", !metaSecret.ok && metaSecret.error === "SECRET_PROVIDER_MISMATCH", JSON.stringify(metaSecret));
}

console.log(`\n=== ACTIVE EFFECTS: ${ok} OK | ${fail} FALHA ===`);
if (fail > 0) {
  console.error(fails.join("\n"));
  process.exit(1);
}
