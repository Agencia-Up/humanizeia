// Temporary CTWA real-ad audit.
// Runs Pedro v3 central_active (LLM real, stock real, effects OFF) against real ctwa_ad
// examples pulled from wa_chat_history for Icom/BNDV and Avant/RevendaMais.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { SupabaseServiceGateway } from "../src/runtime/supabase-service-gateway.ts";
import { SupabaseReadOnlyDatabase } from "../src/adapters/read/supabase-read-database.ts";
import { V2DatabaseReadGateway, V2DatabaseCredentialProvider } from "../src/adapters/read/supabase-v2-read-adapter.ts";
import { V2PlaintextApiKeyReader } from "../src/adapters/read/v2-api-key-reader.ts";
import { SafeHttpClient } from "../src/adapters/read/http-client.ts";
import { ReadCache } from "../src/adapters/read/cache.ts";
import { V2StockLoader } from "../src/adapters/read/stock-loader.ts";
import { V2StockSource } from "../src/adapters/read/stock-source.ts";
import { V2VehiclePhotoSource } from "../src/adapters/read/photo-source.ts";
import { V2CrmReadSource } from "../src/adapters/read/crm-read-source.ts";
import { createReadQueryRunner } from "../src/engine/read-query-runner.ts";
import { ConversationTurnContextPreparer, StockTenantCatalogSource } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createOpenAiModelFactory, OpenAiRuntimeSecret } from "../src/engine/openai-canary-root.ts";
import { FetchModelHttpTransport } from "../src/runtime/fetch-transports.ts";
import { OpenAiAgentBrain } from "../src/adapters/llm/openai-agent-brain.ts";
import { PromptBoundConversationAdapter } from "../src/adapters/llm/prompt-bound-conversation.ts";
import { PromptTenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { InMemoryPersistence, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { createInitialState, type AdContext } from "../src/domain/conversation-state.ts";
import { makeSecretRef } from "../src/domain/credential-provider.ts";
import type { TenantAgentRef, TenantRuntimeConfig, NormalizedVehicle } from "../src/domain/read-ports.ts";
import type { AgentBrainPort, AgentBrainStep, AgentToolObservation, TurnFrame, CentralQueryCall } from "../src/domain/agent-brain.ts";
import type { QueryCall, QueryResult, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import { redact } from "../src/domain/effect-intent.ts";
import { loadServiceEnv, CountingModelHttpTransport, RetryingModelHttpTransport, sanitize } from "./real-harness.ts";

const MODEL = "gpt-4.1-mini";
const ICOM: TenantAgentRef = { tenantId: "f49fd48a-4386-4009-95f3-26a5100b84f7", agentId: "aee7e916-31b1-431c-ba6f-f38178fd4899" };
const AVANT: TenantAgentRef = { tenantId: "7e23b020-0377-4120-a6a4-502701d62208", agentId: "03421f26-f4e3-48f1-a791-24fc438e9b3d" };
const LIMITS = { maxSteps: 4, totalTimeoutMs: 200_000, proposeTimeoutMs: 90_000, queryTimeoutMs: 25_000, composeTimeoutMs: 40_000 } as const;
const ALLOWED_TOOLS = ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"] as const;

type AdRow = { created_at: string; content: string; metadata: Record<string, unknown> };
type ToolLog = { tool: string; input: Record<string, unknown>; ok: boolean; itemCount?: number; keys?: string[] };
type EffectLog = { kind: string; vehicleKey?: string; photoCount?: number; status: string };
type TurnLog = {
  turn: number; lead: string; response: string; status: string; reasonCode?: string; responseSource?: string;
  adVehicle?: string | null; tools: ToolLog[]; effects: EffectLog[]; llmCalls: number; terminalSafe: boolean;
  selectedKey?: string | null; stockInput?: string;
};
type Scenario = {
  id: string; label: string; ref: TenantAgentRef; ad: AdContext; steps: string[][];
  expect: (turns: TurnLog[]) => string[];
};

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
function has(s: string, needle: string): boolean { return norm(s).includes(norm(needle)); }

async function restRows<T>(table: string, params: URLSearchParams): Promise<T[]> {
  const url = requiredEnv("SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${url}/rest/v1/${table}?${params}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`REST_${table}_${res.status}:${await res.text()}`);
  return await res.json() as T[];
}

function adFromMetadata(meta: Record<string, unknown>): AdContext | null {
  const raw = (meta.ctwa_ad ?? meta.ad_context ?? meta.externalAdReply) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
  const media = Array.isArray((meta as { media?: unknown }).media) ? (meta as { media: unknown[] }).media : [];
  const imageUrls = media.map((m) => str((m as Record<string, unknown>)?.file ?? (m as Record<string, unknown>)?.url)).filter((v): v is string => !!v && !v.startsWith("data:"));
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

async function recentAds(ref: TenantAgentRef, limit = 1000): Promise<AdContext[]> {
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
    const fingerprint = [ad.greeting, ad.title, ad.body, ad.sourceUrl].filter(Boolean).join(" | ").slice(0, 500);
    if (!fingerprint || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    ads.push(ad);
  }
  return ads;
}

async function buildAssembly(ref: TenantAgentRef) {
  const url = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const allowedHosts = [hostOf(url)];
  const serviceGateway = new SupabaseServiceGateway({ url, serviceRoleKey, allowedHosts, timeoutMs: 20_000, maxResponseBytes: 8 * 1024 * 1024 });
  const readDb = SupabaseReadOnlyDatabase.create({ url, apiKey: serviceRoleKey, allowedHosts, timeoutMs: 15_000, maxResponseBytes: 4 * 1024 * 1024 });
  const gateway = new V2DatabaseReadGateway(readDb);

  const agent = await gateway.getOwnedAgent(ref);
  if (!agent) throw new Error(`AGENT_NOT_FOUND:${ref.agentId}`);
  const integrations = await gateway.listActiveStockIntegrationMetadata(ref);
  const chosen = integrations.find((r) => r.isActive && r.provider.toLowerCase() === "revendamais") ??
    integrations.find((r) => r.isActive && r.provider.toLowerCase() === "bndv") ?? null;
  if (!chosen) throw new Error(`NO_ACTIVE_STOCK:${ref.agentId}`);
  const provider = chosen.provider.toLowerCase() as "revendamais" | "bndv";
  const stockSecretRef = makeSecretRef({ tenantId: ref.tenantId, integrationId: chosen.id, provider, purpose: "stock_feed" });
  const runtimeConfig: TenantRuntimeConfig = {
    tenantId: ref.tenantId,
    agentId: ref.agentId,
    agentName: agent.name,
    companyName: agent.companyName?.trim() || null,
    instanceId: agent.instanceId ?? null,
    promptText: agent.systemPrompt?.trim() || "Atenda o lead como consultor automotivo.",
    promptSource: "raw_system_prompt",
    model: typeof agent.model === "string" ? agent.model : null,
    temperature: typeof agent.temperature === "number" ? agent.temperature : null,
    sdrGoal: agent.sdrGoal ?? null,
    qualificationQuestions: agent.qualificationQuestions ? [...agent.qualificationQuestions] : null,
    sellsMotorcycles: !!agent.sellsMotorcycles,
    blockedCategories: [...(agent.blockedCategories ?? [])],
    ragRestricted: !!agent.ragRestricted,
    stockProvider: provider,
    stockSecretRef,
    versionStamp: `audit:${agent.updatedAt}:${provider}:${chosen.updatedAt ?? "-"}`,
  };

  let openAiSecret: OpenAiRuntimeSecret;
  if (process.env.EVAL_OPENAI_API_KEY?.trim()) {
    openAiSecret = OpenAiRuntimeSecret.fromString(process.env.EVAL_OPENAI_API_KEY.trim());
  } else {
    const raw = await serviceGateway.rpc<unknown>("get_platform_ai_key", { p_provider: "openai" });
    const key = typeof raw === "string" ? raw.trim() : "";
    if (!key || /\s/.test(key)) throw new Error("PLATFORM_OPENAI_KEY_INVALID");
    openAiSecret = OpenAiRuntimeSecret.fromString(key);
  }

  const credentialProvider = new V2DatabaseCredentialProvider(readDb, new V2PlaintextApiKeyReader());
  const clock = { now: () => new Date().toISOString() };
  const cache = new ReadCache<NormalizedVehicle[]>(clock as never, { ttlMs: 60_000, maxItems: 8, enabled: true });
  const loader = new V2StockLoader(gateway, credentialProvider, cache, new SafeHttpClient());
  const stockSource = new V2StockSource(loader);
  const photoSource = new V2VehiclePhotoSource(loader);
  const crmSource = new V2CrmReadSource(gateway);
  const runQueryBase = createReadQueryRunner(ref, { stock: stockSource, vehicleDetails: stockSource, vehiclePhotos: photoSource, crm: crmSource });

  const brainTransport = new CountingModelHttpTransport(new RetryingModelHttpTransport(new FetchModelHttpTransport()));
  brainTransport.fullPrompt = runtimeConfig.promptText;
  const brain = new OpenAiAgentBrain(openAiSecret, brainTransport, runtimeConfig.promptText, {
    model: MODEL, temperature: 0.1, maxCompletionTokens: 1_200, timeoutMs: 60_000, allowedTools: [...ALLOWED_TOOLS],
  });
  const composeTransport = new CountingModelHttpTransport(new RetryingModelHttpTransport(new FetchModelHttpTransport()));
  composeTransport.fullPrompt = runtimeConfig.promptText;
  const composeModel = createOpenAiModelFactory({
    openAiSecret, modelTransport: composeTransport,
    modelOptions: { modelOverride: MODEL, temperatureOverride: 0.3, timeoutMs: 30_000, maxResponseBytes: 2 * 1024 * 1024, maxCompletionTokens: 1_200 },
  })(runtimeConfig);

  return {
    ref,
    runtimeConfig,
    promptSha: createHash("sha256").update(runtimeConfig.promptText, "utf8").digest("hex"),
    brain,
    brainTransport,
    composeLlm: new PromptBoundConversationAdapter(runtimeConfig, composeModel),
    composeTransport,
    runQueryBase,
    contextPreparer: new ConversationTurnContextPreparer(ref, new PromptBoundConversationAdapter(runtimeConfig, composeModel), new StockTenantCatalogSource(stockSource)),
    sdrPolicy: buildSdrQualificationPolicy(runtimeConfig),
    businessInfo: new PromptTenantBusinessInfoSource(runtimeConfig),
  };
}

class RecordingBrain implements AgentBrainPort {
  tools: string[] = [];
  adVehicle: string | null = null;
  constructor(private readonly inner: AgentBrainPort) {}
  reset(): void { this.tools = []; this.adVehicle = null; }
  async proposeNextStep(frame: TurnFrame, obs: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    this.adVehicle = frame.signals.adVehicle ?? null;
    const step = await this.inner.proposeNextStep(frame, obs);
    if (step.kind === "query") this.tools.push((step.call as CentralQueryCall).tool);
    return step;
  }
}

function wrapQuery(inner: (call: QueryCall) => Promise<QueryResult>, log: ToolLog[]): (call: QueryCall) => Promise<QueryResult> {
  return async (call) => {
    const res = await inner(call);
    const base: ToolLog = { tool: call.tool, input: { ...(call.input as Record<string, unknown>) }, ok: res.ok };
    if (res.ok && res.tool === "stock_search") log.push({ ...base, itemCount: res.data.items.length, keys: res.data.items.slice(0, 8).map((v) => v.vehicleKey) });
    else if (res.ok && res.tool === "vehicle_photos_resolve") log.push({ ...base, itemCount: res.data.photoIds.length, keys: [res.data.vehicleKey] });
    else if (res.ok && res.tool === "vehicle_details") log.push({ ...base, keys: [res.data.vehicle.vehicleKey] });
    else log.push(base);
    return res;
  };
}

async function runScenario(s: Scenario): Promise<TurnLog[]> {
  const a = await buildAssembly(s.ref);
  const base = { ms: Date.parse("2026-07-07T09:00:00.000Z") };
  const clock = { now: () => new Date(base.ms).toISOString() };
  const persistence = new InMemoryPersistence(clock as never, new FakeIdGen());
  const convId = `realad-${s.id}-${Date.now()}`;
  const tx = persistence.begin();
  tx.casState(convId, 0, createInitialState({ conversationId: convId, tenantId: s.ref.tenantId, agentId: s.ref.agentId, leadId: null, now: clock.now() }));
  const seeded = tx.commit();
  if (!seeded.ok) throw new Error(`SEED_FAILED:${seeded.reason}`);
  const brain = new RecordingBrain(a.brain);
  const turns: TurnLog[] = [];
  let seq = 0;
  for (let i = 0; i < s.steps.length; i++) {
    const burst = s.steps[i];
    for (const msg of burst) {
      seq++;
      const raw = i === 0 && seq === 1 ? { text: msg, adContext: s.ad } : { text: msg };
      await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw: redact(raw as never) as never, receivedAt: clock.now() });
    }
    base.ms += 1_000;
    const toolLog: ToolLog[] = [];
    brain.reset();
    const beforeCalls = a.brainTransport.count + a.composeTransport.count;
    const turnId = `${convId}-t${i + 1}`;
    const r = await runCentralConversationTurn({
      persistence, clock: clock as never, brain, llm: a.composeLlm, runQuery: wrapQuery(a.runQueryBase, toolLog), businessInfo: a.businessInfo,
      contextPreparer: a.contextPreparer, conversationId: convId, tenantId: s.ref.tenantId, agentId: s.ref.agentId, leadId: null,
      workerId: "real-ad-audit", turnId, leaseTtlMs: 120_000, portalPromptSha256: a.promptSha,
      limits: LIMITS, maxValidationAttempts: 3, brainMaxSteps: 6, allowedTools: [...ALLOWED_TOOLS],
      providerCapability: { send_message: "none", send_media: "none" },
      singleAuthor: true, llmFirst: true,
    });
    while (true) {
      const claimed = await persistence.claimOutbox(convId, "real-ad-audit", 120_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock: clock as never, conversationId: convId, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result });
      }
    }
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
      selectedKey: r.status === "committed" ? r.resolvedVehicleKey : null,
      stockInput: JSON.stringify(toolLog.filter((x) => x.tool === "stock_search").slice(-1)[0]?.input ?? {}),
    });
    base.ms += 30_000;
  }
  return turns;
}

function baseViolations(turns: TurnLog[]): string[] {
  const out: string[] = [];
  for (const t of turns) {
    if (t.status !== "committed") out.push(`T${t.turn}: status=${t.status}`);
    if (t.terminalSafe) out.push(`T${t.turn}: terminalSafe=true`);
    if (t.responseSource === "technical_fallback") out.push(`T${t.turn}: technical_fallback`);
    if (/nao consegui confirmar|não consegui confirmar|consegue reformular/i.test(t.response)) out.push(`T${t.turn}: fallback genérico`);
    if (/\brevenda(?:mais)?:\d+|\bbndv:[^\s]+/i.test(t.response)) out.push(`T${t.turn}: chave interna vazou`);
    // Fix D (gate forte de CONDUÇÃO): telefone no WhatsApp; beco de busca vazia (promete "outras opções" sem listar nada).
    if (/\b(telefone|celular|numero para contato|número para contato|whatsapp para contato)\b/i.test(t.response)) out.push(`T${t.turn}: pediu telefone no WhatsApp`);
    if (/quer que eu (veja|procure|busque) outr|quer que eu veja outras op(c|ç)oes|quer ver outras op/i.test(t.response) && !/r\$\s?\d/i.test(t.response)) out.push(`T${t.turn}: busca vazia terminou em "quer outras opções?" sem conduzir/listar (beco SDR)`);
  }
  return out;
}

function scenariosFromAds(icomAds: AdContext[], avantAds: AdContext[]): Scenario[] {
  const icomOnix = icomAds.find((a) => has([a.greeting, a.title, a.body].filter(Boolean).join(" "), "onix")) ?? icomAds[0];
  const icomHb20 = icomAds.find((a) => has([a.greeting, a.title, a.body].filter(Boolean).join(" "), "hb20")) ?? icomAds[1] ?? icomAds[0];
  const avantFb = avantAds.find((a) => has(a.source ?? "", "facebook")) ?? avantAds[0];
  const avantIg = avantAds.find((a) => has(a.source ?? "", "instagram")) ?? avantAds[1] ?? avantAds[0];
  return [
    {
      id: "icom-onix-bndv", label: "Icom/BNDV anúncio Onix, depois troca para HB20", ref: ICOM, ad: icomOnix,
      steps: [["Olá! Tenho interesse e queria mais informações, por favor."], ["esse ainda tem?"], ["me manda fotos dele"], ["na verdade quero HB20 até 80 mil"]],
      expect(turns) {
        const v = baseViolations(turns);
        if (!turns.slice(0, 2).some((t) => has(t.adVehicle ?? "", "onix"))) v.push("o cérebro não recebeu signals.adVehicle=Onix do anúncio");
        if (!turns.slice(0, 2).some((t) => t.tools.some((x) => x.tool === "stock_search"))) v.push("não buscou estoque para o anúncio Onix");
        if (!turns.slice(0, 2).some((t) => has(t.response, "onix"))) v.push("não tratou o Onix do anúncio");
        // Fix C: "fotos dele" do anúncio -> envia (match único) OU pergunta qual dos candidatos (>1). NUNCA re-lista genérico.
        if (turns[2] && !turns[2].effects.some((e) => e.kind === "send_media") && !/de qual|qual (voc|vc)|op(c|ç)(o|õ)es do an|essas op(c|ç)|qual (você|voce)/i.test(turns[2].response)) v.push("T3 pedido de fotos do anúncio: nem send_media nem clarify de candidatos (re-listou/ignorou)");
        if (!turns[3]?.tools.some((x) => x.tool === "stock_search" && has(JSON.stringify(x.input), "hb20"))) v.push("mudança para HB20 não acionou busca HB20");
        // Turno atual VENCE o anúncio: não pode ficar preso no Onix quando o lead pediu HB20.
        if (turns[3] && has(turns[3].response, "onix") && !has(turns[3].response, "hb20")) v.push("T4: ficou PRESO no Onix do anúncio em vez de conduzir o HB20 pedido");
        return v;
      },
    },
    {
      id: "icom-hb20-bndv", label: "Icom/BNDV anúncio HB20, depois troca para SUV", ref: ICOM, ad: icomHb20,
      steps: [["Olá! Tenho interesse e queria mais informações, por favor."], ["qual o valor dele?"], ["na verdade quero um SUV automático até 100 mil"]],
      expect(turns) {
        const v = baseViolations(turns);
        if (!turns.slice(0, 2).some((t) => has(t.adVehicle ?? "", "hb20") || has(t.adVehicle ?? "", "hyundai"))) v.push("o cérebro não recebeu signals.adVehicle=HB20 do anúncio");
        if (!turns.slice(0, 2).some((t) => t.tools.some((x) => x.tool === "stock_search" || x.tool === "vehicle_details"))) v.push("não usou tool para o veículo do anúncio HB20");
        if (!turns.slice(0, 2).some((t) => has(t.response, "hb20") || has(t.response, "hyundai"))) v.push("não tratou o HB20 do anúncio");
        const t3Input = JSON.stringify(turns[2]?.tools.find((x) => x.tool === "stock_search")?.input ?? {});
        if (!has(t3Input, "suv")) v.push(`mudança para SUV não preservou tipo=suv na busca (${t3Input})`);
        if (!/100000|100 mil|100k/i.test(t3Input + " " + turns[2]?.response)) v.push("mudança para SUV até 100k não aplicou teto");
        return v;
      },
    },
    {
      id: "avant-generic-fb-rm", label: "Avant/RevendaMais anúncio genérico Facebook, lead pede Compass", ref: AVANT, ad: avantFb,
      steps: [["Olá! Tenho interesse e queria mais informações, por favor."], ["tem Compass até 100 mil?"], ["me manda fotos do segundo"]],
      expect(turns) {
        const v = baseViolations(turns);
        if (turns[0] && /compass|onix|hb20|kicks/i.test(turns[0].response) && !turns[0].tools.some((x) => x.tool === "stock_search")) v.push("anúncio genérico inventou veículo sem busca");
        // Fix B: anúncio genérico T1 -> DESCOBERTA comercial, nunca abrir pedindo nome.
        if (turns[0] && /\bseu\s+nome\b/i.test(turns[0].response)) v.push("T1 (anúncio genérico) abriu pedindo NOME em vez de descoberta comercial");
        if (turns[0] && !/modelo|tipo|suv|sedan|hatch|picape|faixa|procura|op(c|ç)(a|õ)|orcament|orçament|qual carro/i.test(turns[0].response)) v.push("T1 (anúncio genérico) não fez descoberta comercial (modelo/tipo/faixa)");
        const t2Input = JSON.stringify(turns[1]?.tools.find((x) => x.tool === "stock_search")?.input ?? {});
        if (!has(t2Input, "compass")) v.push(`pedido Compass não acionou busca Compass (${t2Input})`);
        if (!turns[2]?.effects.some((e) => e.kind === "send_media") && !/qual|segundo/i.test(turns[2]?.response ?? "")) v.push("foto do segundo não enviou mídia nem pediu esclarecimento útil");
        return v;
      },
    },
    {
      id: "avant-generic-ig-rm", label: "Avant/RevendaMais anúncio genérico Instagram, lead muda para Onix", ref: AVANT, ad: avantIg,
      steps: [["Olá!"], ["quero um SUV até 90 mil"], ["na verdade tem Onix?"], ["onde fica a loja?"]],
      expect(turns) {
        const v = baseViolations(turns);
        // Fix B: anúncio genérico -> abertura não pode ser burocrática (nome); persona/saudação é aceitável.
        if (turns[0] && /\bseu\s+nome\b/i.test(turns[0].response)) v.push("T1 (anúncio genérico) abriu pedindo NOME");
        const t2Input = JSON.stringify(turns[1]?.tools.find((x) => x.tool === "stock_search")?.input ?? {});
        if (!has(t2Input, "suv")) v.push(`pedido SUV não acionou busca SUV (${t2Input})`);
        const t3Input = JSON.stringify(turns[2]?.tools.find((x) => x.tool === "stock_search")?.input ?? {});
        if (!has(t3Input, "onix")) v.push(`mudança para Onix não acionou busca Onix (${t3Input})`);
        // P0-4: ao trocar para um MODELO específico (Onix), o tipo antigo (suv) não pode ficar STALE na busca.
        if (has(t3Input, `"tipo":"suv"`) || has(t3Input, `"tipo": "suv"`)) v.push(`T3: manteve tipo=suv STALE ao trocar para Onix (não largou o tipo antigo) (${t3Input})`);
        if (!turns[3]?.tools.some((x) => x.tool === "tenant_business_info") && !/loja|endereco|endereço|avenida|rua/i.test(turns[3]?.response ?? "")) v.push("pergunta de loja não respondeu institucional");
        return v;
      },
    },
  ];
}

function mdTable(turns: TurnLog[]): string {
  const rows = turns.map((t) => {
    const tools = t.tools.map((x) => `${x.tool}${x.itemCount != null ? `(${x.itemCount})` : ""}`).join(", ") || "-";
    const effects = t.effects.map((e) => `${e.kind}${e.vehicleKey ? `(${e.vehicleKey})` : ""}${e.photoCount != null ? `[${e.photoCount}]` : ""}`).join(", ") || "-";
    const stockIn = t.stockInput && t.stockInput !== "{}" ? sanitize(t.stockInput).replace(/\|/g, "\\|").slice(0, 90) : "-";
    return `| ${t.turn} | ${sanitize(t.lead).replace(/\|/g, "\\|")} | ${sanitize(t.response).replace(/\|/g, "\\|").slice(0, 200)} | ${tools} | ${effects} | ${t.adVehicle ?? "-"} | ${stockIn} | ${t.selectedKey ?? "-"} | ${t.responseSource ?? "-"} | ${t.terminalSafe ? "SIM" : "não"} |`;
  });
  return ["| T | lead | resposta | tools | effects | adVehicle | stockInput | selectedKey | source | terminalSafe |", "|---:|---|---|---|---|---|---|---|---|---|", ...rows].join("\n");
}

async function main(): Promise<void> {
  loadServiceEnv();
  process.env.EVAL_USE_PLATFORM_KEY = process.env.EVAL_USE_PLATFORM_KEY || "1";
  const icomAds = await recentAds(ICOM);
  const avantAds = await recentAds(AVANT);
  if (icomAds.length < 2) throw new Error(`Poucos anúncios Icom: ${icomAds.length}`);
  if (avantAds.length < 1) throw new Error(`Poucos anúncios Avant: ${avantAds.length}`);
  const scenarios = scenariosFromAds(icomAds, avantAds);
  const started = new Date().toISOString();
  const report: string[] = [`# Auditoria CTWA com anúncios reais`, ``, `Início: ${started}`, ``, `Icom ads distintos: ${icomAds.length}. Avant ads distintos: ${avantAds.length} (Avant só tem 1 criativo distinto recente; usei Facebook/Instagram quando disponível).`, ``];
  let failures = 0;
  for (const s of scenarios) {
    const adText = [s.ad.greeting, s.ad.title, s.ad.body, s.ad.sourceUrl].filter(Boolean).join(" | ");
    report.push(`## ${s.label}`, ``, `Ad: ${sanitize(adText).slice(0, 700)}`, ``);
    let turns: TurnLog[] = [];
    try {
      turns = await runScenario(s);
      const v = s.expect(turns);
      if (v.length) failures += v.length;
      report.push(v.length ? `Resultado: **FAIL** (${v.length})` : `Resultado: **PASS**`, ``);
      for (const item of v) report.push(`- ${item}`);
      if (v.length) report.push(``);
      report.push(mdTable(turns), ``);
    } catch (e) {
      failures++;
      report.push(`Resultado: **ERROR**`, ``, `- ${(e as Error).message}`, ``);
    }
  }
  report.push(``, `Falhas totais: ${failures}`);
  const out = resolve("eval/reports", `real-ad-audit-${started.replace(/[:.]/g, "-")}.md`);
  mkdirSync(resolve("eval/reports"), { recursive: true });
  writeFileSync(out, report.join("\n"), "utf8");
  console.log(`REPORT ${out}`);
  console.log(`RESULT ${failures === 0 ? "PASS" : "FAIL"} failures=${failures}`);
  if (failures) process.exitCode = 1;
}

await main();
