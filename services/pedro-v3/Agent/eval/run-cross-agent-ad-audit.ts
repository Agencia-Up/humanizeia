// Cross-agent CTWA audit.
//
// Purpose:
// - Evaluate the Pedro v3 central agent behavior using the DOUGLAS runtime/prompt.
// - Inject real adReferral payloads captured from other agents as CTWA context.
// - Route stock tools to the source stock tenant/provider being tested.
//
// This is intentionally an eval-only harness. It does not model production tenant
// ownership; it answers the product question: "Can Pedro v3 read a real ad and
// use the right stock tool to conduct the conversation?"
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { SupabaseReadOnlyDatabase } from "../src/adapters/read/supabase-read-database.ts";
import {
  V2DatabaseCredentialProvider,
  V2DatabaseReadGateway,
} from "../src/adapters/read/supabase-v2-read-adapter.ts";
import { V2PlaintextApiKeyReader } from "../src/adapters/read/v2-api-key-reader.ts";
import { SafeHttpClient } from "../src/adapters/read/http-client.ts";
import { ReadCache } from "../src/adapters/read/cache.ts";
import { V2StockLoader } from "../src/adapters/read/stock-loader.ts";
import { V2StockSource } from "../src/adapters/read/stock-source.ts";
import { V2VehiclePhotoSource } from "../src/adapters/read/photo-source.ts";
import { V2CrmReadSource } from "../src/adapters/read/crm-read-source.ts";
import { createReadQueryRunner } from "../src/engine/read-query-runner.ts";
import {
  ConversationTurnContextPreparer,
  StockTenantCatalogSource,
} from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createOpenAiModelFactory } from "../src/engine/openai-canary-root.ts";
import { FetchModelHttpTransport } from "../src/runtime/fetch-transports.ts";
import { OpenAiAgentBrain } from "../src/adapters/llm/openai-agent-brain.ts";
import { PromptBoundConversationAdapter } from "../src/adapters/llm/prompt-bound-conversation.ts";
import { PromptTenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import {
  runCentralConversationTurn,
  applyAcceptedPhotoActionOutcome,
} from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { InMemoryPersistence, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { createInitialState, type AdContext } from "../src/domain/conversation-state.ts";
import { makeSecretRef } from "../src/domain/credential-provider.ts";
import {
  PEDRO_V3_PILOT_AGENT_ID,
  PEDRO_V3_PILOT_TENANT_ID,
} from "../src/domain/pilot-scope.ts";
import type {
  CrmReadSource,
  NormalizedVehicle,
  StockSearchFilters,
  StockSearchResult,
  StockSource,
  TenantAgentRef,
  TenantRuntimeConfig,
  VehicleDetailSource,
  VehiclePhotoSource,
  PhotoResolveResult,
} from "../src/domain/read-ports.ts";
import type { AgentBrainPort, AgentBrainStep, AgentToolObservation, TurnFrame } from "../src/domain/agent-brain.ts";
import type { QueryCall, QueryResult, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type {
  OwnedAgentRow,
  OwnedCrmLeadRow,
  OwnedFunnelConfigRow,
  StockIntegrationMetadataRow,
  V2ReadGateway,
} from "../src/adapters/read/v2-read-gateway.ts";
import { redact } from "../src/domain/effect-intent.ts";
import { extractAdVehicleConstraints, adText } from "../src/engine/ad-context.ts";
import { detectCommercialConstraints } from "../src/engine/commercial-constraints.ts";
import { CatalogClaimExtractor, StockTenantCatalogSource as CatalogSource } from "../src/engine/turn-context-preparer.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { loadServiceEnv, CountingModelHttpTransport, RetryingModelHttpTransport, sanitize } from "./real-harness.ts";
import { AiRuntimeSecret } from "../src/runtime/ai-provider.ts";
import { extractSensitiveSpans, materializeSensitiveTokens } from "../src/domain/sensitive-data.ts";
import type { ModelHttpRequest, ModelHttpResponse, ModelHttpTransport } from "../src/adapters/llm/structured-json-model.ts";

const MODEL = "deepseek-chat";
const DEEPSEEK_PROXY_URL = "https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-v3-deepseek-eval-proxy";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const RUNTIME: TenantAgentRef = { tenantId: PEDRO_V3_PILOT_TENANT_ID, agentId: PEDRO_V3_PILOT_AGENT_ID };
const CARVALHO_BNDV: TenantAgentRef = { tenantId: "f49fd48a-4386-4009-95f3-26a5100b84f7", agentId: "aee7e916-31b1-431c-ba6f-f38178fd4899" };
const MANU_REVENDA: TenantAgentRef = { tenantId: "7e23b020-0377-4120-a6a4-502701d62208", agentId: "03421f26-f4e3-48f1-a791-24fc438e9b3d" };
const LIMITS = { maxSteps: 4, totalTimeoutMs: 200_000, proposeTimeoutMs: 90_000, queryTimeoutMs: 25_000, composeTimeoutMs: 40_000 } as const;
const ALLOWED_TOOLS = ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"] as const;

type AdRow = { created_at: string; content: string; metadata: Record<string, unknown> };
type ToolLog = { tool: string; input: Record<string, unknown>; ok: boolean; itemCount?: number; keys?: string[] };
type EffectLog = { kind: string; vehicleKey?: string; photoCount?: number; status: string };
type TurnLog = {
  turn: number;
  lead: string;
  response: string;
  status: string;
  reasonCode?: string;
  responseSource?: string;
  adVehicle?: string | null;
  tools: ToolLog[];
  effects: EffectLog[];
  llmCalls: number;
  terminalSafe: boolean;
  selectedKey?: string | null;
  primaryIntent?: string | null;
  slotsDelta: Array<{ slot: string; from: string; to: string }>;
  policyFeedback: string[];
  controlFeedback: string[];
  brainSteps: number;
};
type Scenario = {
  id: string;
  label: string;
  sourceRef: TenantAgentRef;
  stockLabel: string;
  ad: AdContext;
  expectedModel: string | null;
  switchTo: string;
  steps: string[][];
  expect: (turns: TurnLog[], scenario: Scenario) => string[];
};

class DeepSeekEvalProxyTransport implements ModelHttpTransport {
  readonly #inner = new FetchModelHttpTransport();
  postJson(_url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    return this.#inner.postJson(DEEPSEEK_PROXY_URL, request);
  }
}

function hostOf(url: string): string {
  const p = new URL(url);
  if (p.protocol !== "https:" || p.username || p.password) throw new Error("SUPABASE_URL_INVALID");
  return p.hostname.toLowerCase();
}
function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`ENV_${name}_MISSING`);
  return v;
}
function norm(s: string): string {
  return (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function has(s: string, needle: string): boolean {
  return norm(s).includes(norm(needle));
}
function compactJson(value: unknown): string {
  return JSON.stringify(value).replace(/\s+/g, " ");
}

async function restRows<T>(table: string, params: URLSearchParams): Promise<T[]> {
  const url = requiredEnv("SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/${table}?${params}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === "AbortError" ? "REST_TIMEOUT" : "REST_NETWORK_ERROR";
    throw new Error(`${code}:${table}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`REST_${table}_${res.status}:${await res.text()}`);
  return await res.json() as T[];
}

function adFromMetadata(meta: Record<string, unknown>): AdContext | null {
  const raw = (meta.ctwa_ad ?? meta.ad_context ?? meta.externalAdReply) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
  const media = Array.isArray((meta as { media?: unknown }).media) ? (meta as { media: unknown[] }).media : [];
  const imageUrls = media
    .map((m) => str((m as Record<string, unknown>)?.file ?? (m as Record<string, unknown>)?.url))
    .filter((v): v is string => !!v && !v.startsWith("data:"));
  return {
    adId: str(raw.sourceId ?? raw.sourceID ?? raw.adId ?? raw.ad_id),
    source: str(raw.sourceApp ?? raw.source ?? raw.conversionSource),
    sourceUrl: str(raw.sourceUrl ?? raw.sourceURL ?? raw.url),
    title: str(raw.title),
    body: str(raw.body ?? raw.description),
    greeting: str(raw.greetingMessageBody ?? raw.greeting),
    imageUrls,
    capturedAtTurn: 0,
  };
}

async function recentAds(ref: TenantAgentRef, limit = 1200): Promise<AdContext[]> {
  const params = new URLSearchParams();
  params.set("select", "created_at,content,metadata");
  params.set("agent_id", `eq.${ref.agentId}`);
  params.set("metadata", "not.is.null");
  params.set("order", "created_at.desc");
  params.set("limit", String(limit));
  const rows = await restRows<AdRow>("wa_chat_history", params);
  const seen = new Set<string>();
  const ads: AdContext[] = [];
  for (const row of rows) {
    const ad = adFromMetadata(row.metadata ?? {});
    if (!ad) continue;
    const fp = [ad.greeting, ad.title, ad.body, ad.sourceUrl].filter(Boolean).join(" | ").slice(0, 800);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    ads.push(ad);
  }
  return ads;
}

class InactiveAllowedGateway implements V2ReadGateway {
  constructor(private readonly inner: V2ReadGateway) {}
  async getOwnedAgent(ref: TenantAgentRef): Promise<OwnedAgentRow | null> {
    const row = await this.inner.getOwnedAgent(ref);
    return row ? { ...row, isActive: true } : row;
  }
  getOwnedFunnelConfig(ref: TenantAgentRef): Promise<OwnedFunnelConfigRow | null> {
    return this.inner.getOwnedFunnelConfig(ref);
  }
  listActiveStockIntegrationMetadata(ref: TenantAgentRef): Promise<StockIntegrationMetadataRow[]> {
    return this.inner.listActiveStockIntegrationMetadata(ref);
  }
  getOwnedCrmLead(ref: TenantAgentRef, leadId: string): Promise<OwnedCrmLeadRow | null> {
    return this.inner.getOwnedCrmLead(ref, leadId);
  }
}

class RefMappedStockSource implements StockSource, VehicleDetailSource {
  constructor(private readonly inner: V2StockSource, private readonly sourceRef: TenantAgentRef) {}
  search(_ref: TenantAgentRef, filters: StockSearchFilters): Promise<StockSearchResult> {
    return this.inner.search(this.sourceRef, filters);
  }
  getDetails(_ref: TenantAgentRef, vehicleKey: string) {
    return this.inner.getDetails(this.sourceRef, vehicleKey);
  }
}

class RefMappedPhotoSource implements VehiclePhotoSource {
  constructor(private readonly inner: V2VehiclePhotoSource, private readonly sourceRef: TenantAgentRef) {}
  resolvePhotos(_ref: TenantAgentRef, vehicleKey: string): Promise<PhotoResolveResult> {
    return this.inner.resolvePhotos(this.sourceRef, vehicleKey);
  }
  resolveUrls(_ref: TenantAgentRef, vehicleKey: string, photoIds: readonly string[]) {
    return this.inner.resolveUrls(this.sourceRef, vehicleKey, photoIds);
  }
}

async function makeReadPieces(sourceRef: TenantAgentRef) {
  const url = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const allowedHosts = [hostOf(url)];
  const readDb = SupabaseReadOnlyDatabase.create({ url, apiKey: serviceRoleKey, allowedHosts, timeoutMs: 15_000, maxResponseBytes: 4 * 1024 * 1024 });
  const baseGateway = new V2DatabaseReadGateway(readDb);
  const stockGateway = new InactiveAllowedGateway(baseGateway);
  const credentialProvider = new V2DatabaseCredentialProvider(readDb, new V2PlaintextApiKeyReader());
  const clock = { now: () => new Date().toISOString() };
  const cache = new ReadCache<NormalizedVehicle[]>(clock as never, { ttlMs: 60_000, maxItems: 16, enabled: true });
  const loader = new V2StockLoader(stockGateway, credentialProvider, cache, new SafeHttpClient());
  const rawStock = new V2StockSource(loader);
  const rawPhoto = new V2VehiclePhotoSource(loader);
  const stockSource = new RefMappedStockSource(rawStock, sourceRef);
  const photoSource = new RefMappedPhotoSource(rawPhoto, sourceRef);
  return { baseGateway, stockSource, photoSource, crmSource: new V2CrmReadSource(baseGateway) };
}

async function buildAssembly(sourceRef: TenantAgentRef) {
  const url = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const allowedHosts = [hostOf(url)];
  const readDb = SupabaseReadOnlyDatabase.create({ url, apiKey: serviceRoleKey, allowedHosts, timeoutMs: 15_000, maxResponseBytes: 4 * 1024 * 1024 });
  const runtimeGateway = new V2DatabaseReadGateway(readDb);
  const runtimeAgent = await runtimeGateway.getOwnedAgent(RUNTIME);
  if (!runtimeAgent) throw new Error("RUNTIME_AGENT_NOT_FOUND");
  if (!runtimeAgent.isActive) throw new Error("RUNTIME_AGENT_INACTIVE");

  const { stockSource, photoSource, crmSource } = await makeReadPieces(sourceRef);
  const sampleStock = await stockSource.search(RUNTIME, {});
  if (sampleStock.items.length === 0) throw new Error(`SOURCE_STOCK_EMPTY:${sourceRef.tenantId}:${sourceRef.agentId}`);

  const runtimeConfig: TenantRuntimeConfig = {
    tenantId: RUNTIME.tenantId,
    agentId: RUNTIME.agentId,
    agentName: runtimeAgent.name,
    companyName: runtimeAgent.companyName?.trim() || null,
    instanceId: runtimeAgent.instanceId ?? null,
    promptText: runtimeAgent.systemPrompt?.trim() || "Atenda o lead como consultor automotivo.",
    promptSource: "raw_system_prompt",
    model: typeof runtimeAgent.model === "string" ? runtimeAgent.model : null,
    temperature: typeof runtimeAgent.temperature === "number" ? runtimeAgent.temperature : null,
    sdrGoal: runtimeAgent.sdrGoal ?? null,
    qualificationQuestions: runtimeAgent.qualificationQuestions ? [...runtimeAgent.qualificationQuestions] : null,
    sellsMotorcycles: !!runtimeAgent.sellsMotorcycles,
    blockedCategories: [...(runtimeAgent.blockedCategories ?? [])],
    ragRestricted: !!runtimeAgent.ragRestricted,
    stockProvider: "none",
    stockSecretRef: null,
    versionStamp: `cross-ad:${runtimeAgent.updatedAt}:${sourceRef.tenantId}:${sourceRef.agentId}`,
  };

  // O proxy temporario usa a service role somente para autenticar o eval. A
  // chave DeepSeek permanece no cofre da Edge Function e nunca chega ao runner.
  const openAiSecret = AiRuntimeSecret.fromString("deepseek", serviceRoleKey);

  const runQueryBase = createReadQueryRunner(RUNTIME, {
    stock: stockSource,
    vehicleDetails: stockSource,
    vehiclePhotos: photoSource,
    crm: crmSource as CrmReadSource,
  });
  const brainTransport = new CountingModelHttpTransport(new RetryingModelHttpTransport(new DeepSeekEvalProxyTransport()));
  brainTransport.fullPrompt = runtimeConfig.promptText;
  const brain = new OpenAiAgentBrain(openAiSecret, brainTransport, runtimeConfig.promptText, {
    model: MODEL,
    retryModel: MODEL,
    temperature: 0.1,
    maxCompletionTokens: 1_600,
    timeoutMs: 60_000,
    allowedTools: [...ALLOWED_TOOLS],
    endpointUrl: DEEPSEEK_ENDPOINT,
    allowedHosts: ["api.deepseek.com"],
    tokenParameter: "max_tokens",
    handoffEnabled: true,
  });
  const composeTransport = new CountingModelHttpTransport(new RetryingModelHttpTransport(new DeepSeekEvalProxyTransport()));
  composeTransport.fullPrompt = runtimeConfig.promptText;
  const composeModel = createOpenAiModelFactory({
    openAiSecret,
    modelTransport: composeTransport,
    modelOptions: {
      endpointUrl: DEEPSEEK_ENDPOINT,
      allowedHosts: ["api.deepseek.com"],
      modelOverride: MODEL,
      temperatureOverride: 0.2,
      timeoutMs: 60_000,
      maxResponseBytes: 2 * 1024 * 1024,
      maxCompletionTokens: 1_200,
      tokenParameter: "max_tokens",
    },
  })(runtimeConfig);
  const composeLlm = new PromptBoundConversationAdapter(runtimeConfig, composeModel);
  return {
    runtimeConfig,
    promptSha: createHash("sha256").update(runtimeConfig.promptText, "utf8").digest("hex"),
    brain,
    brainTransport,
    composeLlm,
    composeTransport,
    runQueryBase,
    contextPreparer: new ConversationTurnContextPreparer(RUNTIME, composeLlm, new StockTenantCatalogSource(stockSource)),
    sdrPolicy: buildSdrQualificationPolicy(runtimeConfig),
    businessInfo: new PromptTenantBusinessInfoSource(runtimeConfig),
    stockSource,
  };
}

class RecordingBrain implements AgentBrainPort {
  adVehicle: string | null = null;
  constructor(private readonly inner: AgentBrainPort) {}
  reset(): void { this.adVehicle = null; }
  async proposeNextStep(frame: TurnFrame, obs: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    this.adVehicle = frame.signals.adVehicle ?? null;
    return this.inner.proposeNextStep(frame, obs);
  }
}

function wrapQuery(inner: (call: QueryCall) => Promise<QueryResult>, log: ToolLog[]): (call: QueryCall) => Promise<QueryResult> {
  return async (call) => {
    const res = await inner(call);
    const base: ToolLog = { tool: call.tool, input: { ...(call.input as Record<string, unknown>) }, ok: res.ok };
    if (res.ok && res.tool === "stock_search") {
      log.push({ ...base, itemCount: res.data.items.length, keys: res.data.items.slice(0, 8).map((v) => v.vehicleKey) });
    } else if (res.ok && res.tool === "vehicle_photos_resolve") {
      log.push({ ...base, itemCount: res.data.photoIds.length, keys: [res.data.vehicleKey] });
    } else if (res.ok && res.tool === "vehicle_details") {
      log.push({ ...base, keys: [res.data.vehicle.vehicleKey] });
    } else {
      log.push(base);
    }
    return res;
  };
}

type SlotShape = { status?: string; value?: unknown; ref?: unknown };
function slotSummary(state: { slots?: Record<string, SlotShape> } | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, slot] of Object.entries(state?.slots ?? {})) {
    if (slot.status && slot.status !== "unknown") out[name] = `${slot.status}:${JSON.stringify(slot.value ?? slot.ref ?? null)}`;
  }
  return out;
}
function diffSlots(
  before: { slots?: Record<string, SlotShape> } | undefined,
  after: { slots?: Record<string, SlotShape> } | undefined,
): Array<{ slot: string; from: string; to: string }> {
  const left = slotSummary(before);
  const right = slotSummary(after);
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((slot) => left[slot] !== right[slot])
    .map((slot) => ({ slot, from: left[slot] ?? "-", to: right[slot] ?? "-" }));
}

async function runScenario(s: Scenario): Promise<TurnLog[]> {
  const a = await buildAssembly(s.sourceRef);
  const base = { ms: Date.parse("2026-07-07T10:00:00.000Z") };
  const clock = { now: () => new Date(base.ms).toISOString() };
  const persistence = new InMemoryPersistence(clock as never, new FakeIdGen());
  const convId = `crossad-${s.id}-${Date.now()}`;
  const tx = persistence.begin();
  const fakeLeadId = "54545454-5454-4454-8454-545454545454";
  tx.casState(convId, 0, createInitialState({ conversationId: convId, tenantId: RUNTIME.tenantId, agentId: RUNTIME.agentId, leadId: fakeLeadId, now: clock.now() }));
  const seeded = await tx.commit();
  if (!seeded.ok) throw new Error(`SEED_FAILED:${seeded.reason}`);
  const brain = new RecordingBrain(a.brain);
  const turns: TurnLog[] = [];
  let seq = 0;
  for (let i = 0; i < s.steps.length; i++) {
    const burst = s.steps[i];
    const before = (await persistence.load(convId))?.state;
    for (const msg of burst) {
      seq++;
      const eventId = `${convId}-e${seq}`;
      const sensitive = extractSensitiveSpans(msg, new Date(clock.now()).getUTCFullYear(), {
        expectsCpf: /\bcpf\b/i.test(msg) || /\bcpf\b/i.test([...((before?.recentTurns ?? []))].reverse().find((t) => t.role === "agent")?.text ?? ""),
        expectsBirthDate: /\b(?:data\s+de\s+nascimento|nascimento)\b/i.test(msg),
      });
      const refs = new Map<string, string>();
      sensitive.secrets.forEach((secret, index) => refs.set(secret.placeholder, createHash("sha256").update(`${convId}\0${eventId}\0${index}\0${secret.kind}`).digest("hex")));
      const text = materializeSensitiveTokens(sensitive, refs);
      const raw = i === 0 && seq === 1 ? { text, adContext: s.ad } : { text };
      await persistence.tryInsert({ eventId, conversationId: convId, raw: redact(raw as never) as never, receivedAt: clock.now() });
    }
    base.ms += 1_000;
    const toolLog: ToolLog[] = [];
    brain.reset();
    const beforeCalls = a.brainTransport.count + a.composeTransport.count;
    const turnId = `${convId}-t${i + 1}`;
    const r = await runCentralConversationTurn({
      persistence,
      clock: clock as never,
      brain,
      llm: a.composeLlm,
      runQuery: wrapQuery(a.runQueryBase, toolLog),
      businessInfo: a.businessInfo,
      contextPreparer: a.contextPreparer,
      conversationId: convId,
      tenantId: RUNTIME.tenantId,
      agentId: RUNTIME.agentId,
      leadId: fakeLeadId,
      workerId: "cross-ad-audit",
      turnId,
      leaseTtlMs: 120_000,
      portalPromptSha256: a.promptSha,
      limits: LIMITS,
      maxValidationAttempts: 3,
      brainMaxSteps: 6,
      allowedTools: [...ALLOWED_TOOLS],
      providerCapability: { send_message: "none", send_media: "none" },
      singleAuthor: true,
      llmFirst: true,
      crmWriteEnabled: true,
      handoff: {
        enabled: true,
        available: true,
        agentName: a.runtimeConfig.agentName,
        leadPhone: "5512999999999",
        nowLocal: "12/07/2026 15:00",
      },
    });
    while (true) {
      const claimed = await persistence.claimOutbox(convId, "cross-ad-audit", 120_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string; payload?: { vehicleKey?: string; photoIds?: string[] } }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock: clock as never, conversationId: convId, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result });
      }
    }
    const after = (await persistence.load(convId))?.state;
    const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; status: string; payload?: { vehicleKey?: string; photoIds?: string[] } }[];
    turns.push({
      turn: i + 1,
      lead: burst.join(" | "),
      response: sanitize(r.status === "committed" ? r.composedText : `[${r.status}]`),
      status: r.status,
      reasonCode: r.status === "committed" ? r.decision.reasonCode : undefined,
      responseSource: r.status === "committed" ? r.responseSource : undefined,
      adVehicle: r.status === "committed" ? brain.adVehicle : null,
      tools: toolLog,
      effects: outbox.map((o) => ({ kind: o.kind, vehicleKey: o.payload?.vehicleKey, photoCount: o.payload?.photoIds?.length, status: o.status })),
      llmCalls: a.brainTransport.count + a.composeTransport.count - beforeCalls,
      terminalSafe: r.status === "committed" ? r.terminalSafe : true,
      selectedKey: r.status === "committed" ? (after?.vehicleContext.selected?.key ?? r.resolvedVehicleKey) : null,
      primaryIntent: r.status === "committed" ? r.understanding.primaryIntent : null,
      slotsDelta: diffSlots(before as never, after as never),
      policyFeedback: r.status === "committed" ? [...r.policyFeedback] : [],
      controlFeedback: r.status === "committed" ? r.toolObservations.flatMap((o) => !o.ok ? [`${o.error.code}:${o.error.message}`] : []) : [],
      brainSteps: r.status === "committed" ? r.brainSteps : 0,
    });
    base.ms += 30_000;
  }
  return turns;
}

async function adFitsStock(ad: AdContext, sourceRef: TenantAgentRef): Promise<{ model: string; count: number } | null> {
  const { stockSource } = await buildAssembly(sourceRef);
  const all = await stockSource.search(RUNTIME, {});
  const catalog = buildTenantCatalog(all.items);
  const extractor = new CatalogClaimExtractor(catalog);
  const constraints = extractAdVehicleConstraints(ad, extractor, { relation: "ambiguous" });
  const model = constraints.modelos?.[0] ?? "";
  if (!model) return null;
  const res = await stockSource.search(RUNTIME, { modelo: model });
  return res.items.length > 0 ? { model, count: res.items.length } : null;
}

async function pickAds(sourceRef: TenantAgentRef, label: string): Promise<Array<{ ad: AdContext; expectedModel: string }>> {
  const ads = await recentAds(sourceRef);
  const picked: Array<{ ad: AdContext; expectedModel: string }> = [];
  for (const ad of ads) {
    const fit = await adFitsStock(ad, sourceRef).catch(() => null);
    if (!fit) continue;
    if (picked.some((p) => has(p.expectedModel, fit.model))) continue;
    picked.push({ ad, expectedModel: fit.model });
    if (picked.length >= 2) break;
  }
  if (picked.length < 2) throw new Error(`NOT_ENOUGH_MATCHING_ADS:${label}:${picked.length}`);
  return picked;
}

async function pickGenericAds(sourceRef: TenantAgentRef, label: string): Promise<AdContext[]> {
  const ads = await recentAds(sourceRef);
  const generic = ads.filter((ad) => !/compass|onix|hb20|kicks|renegade|corolla|civic|crv|cr-v|gol|palio|sandero|duster|toro|strada|fox|polo|virtus|voyage|versa|c3|208|2008/i.test(adText(ad)));
  const chosen = generic.length >= 2 ? generic.slice(0, 2) : ads.slice(0, 2);
  if (chosen.length < 2) throw new Error(`NOT_ENOUGH_GENERIC_ADS:${label}:${chosen.length}`);
  return chosen;
}

function baseViolations(turns: TurnLog[]): string[] {
  const out: string[] = [];
  for (const t of turns) {
    if (t.status !== "committed") out.push(`T${t.turn}: status=${t.status}`);
    if (t.terminalSafe) out.push(`T${t.turn}: terminalSafe=true`);
    if (t.responseSource === "technical_fallback") out.push(`T${t.turn}: technical_fallback`);
    if (/nao consegui confirmar|consegue reformular/i.test(t.response)) out.push(`T${t.turn}: fallback generico`);
    if (/\brevenda(?:mais)?:\d+|\bbndv:[^\s]+/i.test(t.response)) out.push(`T${t.turn}: chave interna vazou`);
    if (/\b(telefone|celular|numero para contato|n[uú]mero para contato)\b/i.test(t.response)) out.push(`T${t.turn}: pediu telefone no WhatsApp`);
  }
  return out;
}

function expectedModelSeen(turns: TurnLog[], expectedModel: string): boolean {
  return turns.some((t) => has(t.adVehicle ?? "", expectedModel) || has(t.response, expectedModel) || t.tools.some((x) => has(compactJson(x.input), expectedModel)));
}

function hasStockForExpected(turns: TurnLog[], expectedModel: string): boolean {
  return turns.some((t) => t.tools.some((x) => x.tool === "stock_search" && x.itemCount && x.itemCount > 0 && has(compactJson(x.input), expectedModel)));
}

function scenarioExpect(turns: TurnLog[], s: Scenario): string[] {
  const out = baseViolations(turns);
  if (s.expectedModel) {
    if (!expectedModelSeen(turns.slice(0, 2), s.expectedModel)) {
      out.push(`nao conectou a conversa ao veiculo do anuncio (${s.expectedModel}) nos dois primeiros turnos`);
    }
    if (!hasStockForExpected(turns.slice(0, 2), s.expectedModel)) {
      out.push(`nao buscou estoque com resultado para o veiculo do anuncio (${s.expectedModel})`);
    }
  } else {
    if (turns[0] && /compass|onix|hb20|kicks|renegade|corolla/i.test(turns[0].response) && !turns[0].tools.some((x) => x.tool === "stock_search")) {
      out.push("anuncio generico inventou/citou veiculo especifico sem busca");
    }
    if (turns[1] && !turns[1].tools.some((x) => x.tool === "stock_search" && (x.itemCount ?? 0) > 0)) {
      out.push("pedido comercial apos anuncio generico nao buscou estoque com resultado");
    }
  }
  const t2 = turns[1];
  if (t2 && /nao (temos|achei|encontrei)/i.test(norm(t2.response))) {
    const hadItems = t2.tools.some((x) => x.tool === "stock_search" && (x.itemCount ?? 0) > 0);
    if (hadItems) out.push("respondeu ausencia apesar de stock_search com itens");
  }
  const photoTurn = turns[2];
  if (photoTurn && !photoTurn.effects.some((e) => e.kind === "send_media") && !/qual|op[cç][oõ]es|de qual/i.test(photoTurn.response)) {
    out.push("pedido de foto nao enviou midia nem pediu esclarecimento util");
  }
  const changeTurn = turns[3];
  if (!changeTurn?.tools.some((x) => x.tool === "stock_search" && has(compactJson(x.input), s.switchTo))) {
    out.push(`mudanca de interesse nao buscou ${s.switchTo}`);
  }
  if (changeTurn && has(changeTurn.response, s.expectedModel) && !has(changeTurn.response, s.switchTo)) {
    out.push(`ficou preso no anuncio (${s.expectedModel}) apos lead pedir ${s.switchTo}`);
  }
  return out;
}

async function buildScenarios(): Promise<Scenario[]> {
  const ads = await recentAds(CARVALHO_BNDV);
  const findAd = (fragment: string): AdContext => {
    const found = ads.find((ad) => has(ad.greeting ?? "", fragment));
    if (!found) throw new Error(`REAL_AD_NOT_FOUND:${fragment}`);
    return found;
  };
  const hasTool = (turn: TurnLog | undefined, tool: string): boolean => !!turn?.tools.some((item) => item.tool === tool);
  const hasCommercialTool = (turn: TurnLog | undefined): boolean => !!turn?.tools.some((item) => ["stock_search", "vehicle_details", "vehicle_photos_resolve"].includes(item.tool));
  const hasSlot = (turn: TurnLog | undefined, slot: string, value?: RegExp): boolean => !!turn?.slotsDelta.some((item) => item.slot === slot && (!value || value.test(item.to)));
  const hasEffect = (turn: TurnLog | undefined, kind: string): boolean => !!turn?.effects.some((effect) => effect.kind === kind);
  const common = (turns: TurnLog[]): string[] => {
    const failures = baseViolations(turns);
    for (const turn of turns) {
      if (!/^brain_(?:final|retry)$|^deterministic_(?:photo|institutional)$/.test(turn.responseSource ?? "")) {
        failures.push(`T${turn.turn}: autoria comercial nao-LLM (${turn.responseSource ?? "-"})`);
      }
      if (turn.effects.some((effect) => effect.kind === "send_media" && (effect.photoCount ?? 0) > 5)) {
        failures.push(`T${turn.turn}: enviou mais de 5 fotos`);
      }
    }
    return failures;
  };

  const hb20: Scenario = {
    id: "bruno-hb20x-km",
    label: "Bruno real A - anuncio HB20X, km, fotos, financiamento, visita, PII e humano",
    sourceRef: CARVALHO_BNDV,
    stockLabel: "BNDV/Carvalho",
    ad: findAd("HB20X Premium 1.6 2019"),
    expectedModel: "HB20X",
    switchTo: "",
    steps: [
      ["Ola! Tenho interesse e queria mais informacoes, por favor.", "Quantos km??"],
      ["Pode me mandar fotos dele?"],
      ["Gostei dele. Tenho 15 mil de entrada e quero financiar o restante"],
      ["Quero visitar na segunda as 15h"],
      ["CPF 111.444.777-35", "data de nascimento 01/10/1990"],
      ["Quero falar com um atendente"],
    ],
    expect(turns) {
      const failures = common(turns);
      if (!/hb\s*20\s*x/i.test(turns[0]?.response ?? "") || !/139[\.\s]?154/.test(turns[0]?.response ?? "")) failures.push("T1 nao respondeu o HB20X e a km do anuncio");
      if (!hasTool(turns[0], "stock_search") && !hasTool(turns[0], "vehicle_details")) failures.push("T1 nao aterrou o veiculo do anuncio em tool");
      if (!hasEffect(turns[1], "send_media")) failures.push("T2 nao enviou fotos do HB20X");
      if (hasCommercialTool(turns[2]) || !hasSlot(turns[2], "entrada", /15000/)) failures.push("T3 nao registrou entrada=15000 sem rebuscar estoque");
      if (turns[3]?.primaryIntent !== "visit" || hasCommercialTool(turns[3]) || !hasSlot(turns[3], "diaHorario", /segunda|15/i)) failures.push("T4 nao registrou visita segunda 15h preservando o foco");
      if (hasCommercialTool(turns[4]) || !hasSlot(turns[4], "cpf", /known/) || !hasSlot(turns[4], "birthDate", /known/)) failures.push("T5 nao registrou CPF/data como refs opacas");
      if (turns[5]?.primaryIntent !== "request_human" || !hasEffect(turns[5], "handoff") || !hasEffect(turns[5], "notify_seller")) failures.push("T6 nao planejou handoff explicito");
      return failures;
    },
  };

  const fastback: Scenario = {
    id: "bruno-fastback-objection",
    label: "Bruno real B - Fastback, objecao, opcionais, pivot, troca, visita e humano",
    sourceRef: CARVALHO_BNDV,
    stockLabel: "BNDV/Carvalho",
    ad: findAd("Fastback Audace T200 1.0 2025"),
    expectedModel: "Fastback",
    switchTo: "sedan hibrido",
    steps: [
      ["Ola! Tenho interesse e queria mais informacoes, por favor."],
      ["E hibrido", "Ta bem rodado p 25"],
      ["120.000. Estou procurando um bem economico"],
      ["Gostaria de ver esse prata. E ver os opcionais q ele oferece"],
      ["O banco e de couro?"],
      ["Na verdade quero um sedan hibrido ate 120 mil"],
      ["Tenho um C4 Lounge 2014 com 109900 km para troca"],
      ["Quero visitar sabado de manha"],
      ["CPF 111.444.777-35", "nascimento 01/10/1990"],
      ["Me transfere para um vendedor"],
    ],
    expect(turns) {
      const failures = common(turns);
      if (!/fastback/i.test(turns[0]?.response ?? "")) failures.push("T1 nao conectou a abertura ao Fastback do anuncio");
      if (hasCommercialTool(turns[1]) && !hasTool(turns[1], "vehicle_details")) failures.push("T2 usou tool comercial errada para responder objecao/atributo");
      const pivotInput = compactJson(turns[5]?.tools.find((item) => item.tool === "stock_search")?.input ?? {});
      if (!hasTool(turns[5], "stock_search") || !/"tipo":"sedan"/.test(pivotInput) || !/"hibrido":true/.test(pivotInput)) failures.push("T6 pivot nao buscou sedan hibrido com o requisito de propulsao preservado");
      if (hasCommercialTool(turns[6]) || !hasSlot(turns[6], "veiculoTroca", /C4|Lounge|2014|109900/i)) failures.push("T7 contaminou compra ou nao registrou o C4 de troca");
      if (turns[7]?.primaryIntent !== "visit" || hasCommercialTool(turns[7])) failures.push("T8 visita acionou estoque ou nao foi entendida");
      if (!hasSlot(turns[8], "cpf", /known/) || !hasSlot(turns[8], "birthDate", /known/)) failures.push("T9 nao registrou PII opaca");
      if (turns[9]?.primaryIntent !== "request_human" || !hasEffect(turns[9], "handoff")) failures.push("T10 nao transferiu sob pedido explicito");
      return failures;
    },
  };

  const ecosport: Scenario = {
    id: "bruno-ecosport-typo",
    label: "Bruno real C - Ecosporte, rejeicao por km, novo SUV, financiamento, visita e humano",
    sourceRef: CARVALHO_BNDV,
    stockLabel: "BNDV/Carvalho",
    ad: findAd("nossos carros revisados e com garantia"),
    expectedModel: null,
    switchTo: "SUV automatico",
    steps: [
      ["Ola! Tenho interesse e queria mais informacoes, por favor."],
      ["Ola, b dia", "tenho interesse nesta ecosporte"],
      ["Ta com quantos km?", "tem fotos?"],
      ["nao obrigado, a kilometragem nao me agrada"],
      ["Quero um SUV automatico ate 90 mil"],
      ["gostei do segundo"],
      ["voces financiam?"],
      ["nao tenho entrada", "parcela ate 1800"],
      ["quero agendar visita pra segunda a tarde"],
      ["CPF 111.444.777-35", "data de nascimento 01/10/1990"],
      ["quero falar com atendente humano"],
    ],
    expect(turns) {
      const failures = common(turns);
      if (!/modelo|tipo|faixa|procura/i.test(turns[0]?.response ?? "") || /qual (?:e|é) seu nome/i.test(turns[0]?.response ?? "")) failures.push("T1 anuncio generico nao abriu com discovery comercial");
      if (!hasTool(turns[1], "stock_search") || !/ecosport/i.test(compactJson(turns[1]?.tools.find((item) => item.tool === "stock_search")?.input ?? {}))) failures.push("T2 nao entendeu 'ecosporte' como EcoSport");
      if (!hasTool(turns[2], "vehicle_details") || !hasEffect(turns[2], "send_media")) failures.push("T3 nao respondeu km e fotos do mesmo EcoSport");
      if (hasCommercialTool(turns[3])) failures.push("T4 rejeicao do EcoSport acionou tool comercial");
      if (!hasTool(turns[4], "stock_search") || !/suv/.test(norm(compactJson(turns[4]?.tools.find((item) => item.tool === "stock_search")?.input ?? {})))) failures.push("T5 nao buscou novo SUV automatico ate 90 mil");
      if (!turns[5]?.selectedKey) failures.push("T6 nao selecionou o segundo veiculo");
      if (hasCommercialTool(turns[6]) || hasCommercialTool(turns[7]) || !hasSlot(turns[7], "entrada", /0/) || !hasSlot(turns[7], "parcelaDesejada", /1800/)) failures.push("T7/T8 financiamento acionou estoque ou perdeu entrada/parcela");
      if (turns[8]?.primaryIntent !== "visit" || !hasSlot(turns[8], "diaHorario", /segunda|tarde/i)) failures.push("T9 nao registrou visita");
      if (!hasSlot(turns[9], "cpf", /known/) || !hasSlot(turns[9], "birthDate", /known/)) failures.push("T10 nao registrou PII opaca");
      if (turns[10]?.primaryIntent !== "request_human" || !hasEffect(turns[10], "handoff")) failures.push("T11 nao transferiu para humano");
      return failures;
    },
  };

  return [hb20, fastback, ecosport];
}

function mdTable(turns: TurnLog[]): string {
  const rows = turns.map((t) => {
    const tools = t.tools.map((x) => {
      const n = x.itemCount != null ? `(${x.itemCount})` : "";
      return `${x.tool}${n} ${compactJson(x.input).slice(0, 110)}`;
    }).join("<br>") || "-";
    const effects = t.effects.map((e) => `${e.kind}${e.vehicleKey ? `(${e.vehicleKey})` : ""}${e.photoCount != null ? `[${e.photoCount}]` : ""}`).join("<br>") || "-";
    const slots = t.slotsDelta.map((item) => `${item.slot}=${item.to}`).join("<br>") || "-";
    const feedback = [...t.policyFeedback, ...t.controlFeedback].map((item) => sanitize(item).slice(0, 120)).join("<br>") || "-";
    return `| ${t.turn} | ${sanitize(t.lead).replace(/\|/g, "\\|")} | ${sanitize(t.response).replace(/\|/g, "\\|").slice(0, 260)} | ${t.primaryIntent ?? "-"} | ${tools.replace(/\|/g, "\\|")} | ${effects.replace(/\|/g, "\\|")} | ${slots.replace(/\|/g, "\\|")} | ${t.adVehicle ?? "-"} | ${t.selectedKey ?? "-"} | ${t.responseSource ?? "-"} | ${t.reasonCode ?? "-"} | ${t.brainSteps}/${t.llmCalls} | ${feedback.replace(/\|/g, "\\|")} | ${t.terminalSafe ? "SIM" : "nao"} |`;
  });
  return ["| T | lead | resposta | intent | tools | effects | slotsDelta | adVehicle | selectedKey | source | reason | steps/calls | feedback | terminalSafe |", "|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|", ...rows].join("\n");
}

async function main(): Promise<void> {
  loadServiceEnv();
  const started = new Date().toISOString();
  console.log("AUDIT loading real ad context");
  const allScenarios = await buildScenarios();
  const selectedId = process.env.AUDIT_SCENARIO?.trim();
  const scenarios = selectedId ? allScenarios.filter((scenario) => scenario.id === selectedId) : allScenarios;
  if (scenarios.length === 0) throw new Error(`AUDIT_SCENARIO_NOT_FOUND:${selectedId}`);
  const report: string[] = [
    "# F2.54 - Auditoria real Bruno/BNDV no Pedro v3 DeepSeek",
    "",
    `Inicio: ${started}`,
    "",
    "Runtime avaliado: Pedro v3 Douglas (prompt/cerebro).",
    "Modelo: DeepSeek Chat real, via gateway temporario autenticado (segredo nao exposto).",
    "Ads e falas iniciais: reais, extraidos de 3 conversas recentes do Carvalho/Bruno.",
    "Estoque: BNDV da conta de origem dos anuncios; runtime/prompt: Pedro v3 piloto; efeitos externos: OFF.",
    "",
  ];
  let failures = 0;
  for (const s of scenarios) {
    console.log(`AUDIT running ${s.id}`);
    const adSummary = [s.ad.greeting, s.ad.title, s.ad.body, s.ad.sourceUrl].filter(Boolean).join(" | ");
    report.push(`## ${s.label}`, "", `Modelo esperado pelo anuncio: **${s.expectedModel ?? "generico/institucional"}**`, "", `Ad: ${sanitize(adSummary).slice(0, 800)}`, "");
    try {
      const turns = await runScenario(s);
      const v = s.expect(turns, s);
      failures += v.length;
      report.push(v.length ? `Resultado: **FAIL** (${v.length})` : "Resultado: **PASS**", "");
      for (const item of v) report.push(`- ${item}`);
      if (v.length) report.push("");
      report.push(mdTable(turns), "");
    } catch (error) {
      failures++;
      report.push("Resultado: **ERROR**", "", `- ${(error as Error).message}`, "");
    }
  }
  report.push("", `Falhas totais: ${failures}`);
  const out = resolve("eval/reports", `cross-agent-ad-audit-${started.replace(/[:.]/g, "-")}.md`);
  mkdirSync(resolve("eval/reports"), { recursive: true });
  writeFileSync(out, report.join("\n"), "utf8");
  console.log(`REPORT ${out}`);
  console.log(`RESULT ${failures === 0 ? "PASS" : "FAIL"} failures=${failures}`);
  if (failures) process.exitCode = 1;
}

await main();
