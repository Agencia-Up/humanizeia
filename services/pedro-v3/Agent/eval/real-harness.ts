// ============================================================================
// eval/real-harness.ts — Suíte de avaliação conversacional REAL do Pedro v3.
//
// REUSA a fiação VIVA (mesma montagem do runtime/server.ts + pilot-active-root.ts):
//   OpenAiChatCompletionsModel REAL (gpt-4.1-mini) via FetchModelHttpTransport;
//   prompt/config REAIS (V2TenantConfigSource); estoque/fotos REAIS (V2StockLoader);
//   chave por tenant (BYOK/Vault) via resolveTenantOpenAiSecret.
// COM: InMemoryPersistence; ZERO dispatch externo (nunca cria o WhatsApp dispatcher).
//
// CICLO DE RECEIPT (correção da auditoria Codex): após cada runConversationTurn o eval
// simula o receipt "accepted" de cada efeito NOVO usando o MESMO commitEffectOutcome/reducer
// real — sem despachar, sem editar estado à mão, sem simular delivered no baseline. Assim
// append_assistant_turn/activate_objective aplicam (recentTurns + objetivo pendente ativo) e a
// resposta do turno seguinte consegue satisfazer o objetivo. Sem isso havia AMNÉSIA artificial.
//   - pilot-realistic (BASELINE): accepted p/ todos; send_media NÃO vira delivered (ledger não avança).
//   - ideal-delivered (opcional): send_media com delivered (só p/ inspecionar o ledger pretendido).
//
// PROVA de prompt: parseia o JSON enviado à OpenAI, extrai o system message e compara o prompt do
// portal INTEGRALMENTE (promptExact) + registra o SHA-256 (nunca o prompt inteiro no relatório).
// NUNCA loga chave, prompt completo, telefone, CPF ou dado pessoal (ver sanitize()).
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

import type { ModelHttpTransport, ModelHttpRequest, ModelHttpResponse } from "../src/adapters/llm/structured-json-model.ts";
import { FetchModelHttpTransport } from "../src/runtime/fetch-transports.ts";
import { SupabaseServiceGateway } from "../src/runtime/supabase-service-gateway.ts";
import { SupabaseReadOnlyDatabase } from "../src/adapters/read/supabase-read-database.ts";
import { resolveTenantAiSecret } from "../src/adapters/read/tenant-openai-key.ts";
import { createOpenAiModelFactory } from "../src/engine/openai-canary-root.ts";
import { AiRuntimeSecret, resolveAiProviderRuntime, resolveProviderEnvironmentSecret, type AiProviderRuntimeConfig, type RuntimeApiSecret } from "../src/runtime/ai-provider.ts";
import { V2PlaintextApiKeyReader } from "../src/adapters/read/v2-api-key-reader.ts";
import { V2DatabaseReadGateway, V2DatabaseCredentialProvider } from "../src/adapters/read/supabase-v2-read-adapter.ts";
import { V2TenantConfigSource } from "../src/adapters/read/tenant-config-source.ts";
import { ReadCache } from "../src/adapters/read/cache.ts";
import { SafeHttpClient } from "../src/adapters/read/http-client.ts";
import { V2StockLoader } from "../src/adapters/read/stock-loader.ts";
import { V2StockSource } from "../src/adapters/read/stock-source.ts";
import { V2VehiclePhotoSource } from "../src/adapters/read/photo-source.ts";
import { V2CrmReadSource } from "../src/adapters/read/crm-read-source.ts";
import { PromptBoundConversationAdapter } from "../src/adapters/llm/prompt-bound-conversation.ts";
import { createReadQueryRunner } from "../src/engine/read-query-runner.ts";
import { ConversationTurnContextPreparer, StockTenantCatalogSource } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy, type SdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import type { NormalizedVehicle, TenantAgentRef, TenantRuntimeConfig } from "../src/domain/read-ports.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import type { QueryCall, QueryResult } from "../src/domain/decision.ts";
import type { EffectResult, EffectReceipt } from "../src/domain/decision.ts";
import { InMemoryPersistence, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";

// ── Piloto exclusivo ─────────────────────────────────────────────────────────
export const PILOT_TENANT = "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0";
export const PILOT_AGENT = "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185";
export const PILOT_MODEL = "gpt-4.1-mini";

export type EvalMode = "pilot-realistic" | "ideal-delivered";

// ── .env loader (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) sem logar valores ──
export function loadServiceEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url)); // .../Agent/eval
  const candidates = [resolve(here, "../../../.env"), resolve(here, "../../../../.env"), resolve(here, "../../.env")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!(key in process.env) || !process.env[key]) process.env[key] = val;
    }
  }
}

function requiredEnv(name: string): string { const v = process.env[name]?.trim(); if (!v) throw new Error(`ENV_${name}_MISSING`); return v; }
function hostOf(url: string): string { const p = new URL(url); if (p.protocol !== "https:" || p.username || p.password) throw new Error("SUPABASE_URL_INVALID"); return p.hostname.toLowerCase(); }
function safeHost(url: string): string { try { return new URL(url).host; } catch { return "invalid"; } }

// ── Transporte que CONTA as chamadas reais + prova o prompt INTEGRAL (SHA-256/match) ──
export type LlmCallRecord = {
  readonly seq: number; readonly host: string; readonly status: number; readonly ms: number;
  readonly model?: string; readonly promptTokens?: number; readonly completionTokens?: number;
  readonly promptExact?: boolean; readonly error?: string;
};

export class CountingModelHttpTransport implements ModelHttpTransport {
  readonly calls: LlmCallRecord[] = [];
  #seq = 0;
  fullPrompt = ""; // prompt REAL do portal (comparacao integral); nunca logado
  constructor(private readonly inner: ModelHttpTransport) {}

  get count(): number { return this.calls.length; }
  get okCount(): number { return this.calls.filter((c) => c.status >= 200 && c.status < 300).length; }
  get allPromptExact(): boolean { return this.calls.length > 0 && this.calls.every((c) => c.promptExact === true); }
  get promptSha(): string { return this.fullPrompt ? createHash("sha256").update(this.fullPrompt, "utf8").digest("hex") : ""; }

  async postJson(url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    const seq = ++this.#seq;
    const started = Date.now();
    const host = safeHost(url);
    const promptExact = this.#checkPromptExact(request);
    try {
      const res = await this.inner.postJson(url, request);
      this.calls.push({ seq, host, status: res.status, ms: Date.now() - started, promptExact, ...extractUsage(res.bodyText) });
      return res;
    } catch (err) {
      this.calls.push({ seq, host, status: 0, ms: Date.now() - started, promptExact, error: String((err as Error)?.message ?? err).slice(0, 120) });
      throw err;
    }
  }

  #checkPromptExact(request: ModelHttpRequest): boolean {
    if (!this.fullPrompt || typeof request.body !== "string") return false;
    try {
      const sys = (JSON.parse(request.body) as { messages?: { role?: string; content?: string }[] })?.messages?.find((m) => m.role === "system")?.content;
      return typeof sys === "string" && sys.includes(this.fullPrompt); // prompt do portal presente INTEGRALMENTE
    } catch { return false; }
  }
}
function extractUsage(bodyText: string): { model?: string; promptTokens?: number; completionTokens?: number } {
  try {
    const j = JSON.parse(bodyText) as { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { model: typeof j?.model === "string" ? j.model : undefined, promptTokens: j?.usage?.prompt_tokens, completionTokens: j?.usage?.completion_tokens };
  } catch { return {}; }
}

// ── Retry/backoff SÓ NO TRANSPORTE DO HARNESS (Seção 9) ──────────────────────
// O eval real depende da OpenAI; sob rate-limit (429) ou instabilidade (5xx) os turnos caíam no fallback e
// o judge despencava — contaminando o GATE (não é qualidade do agente). Este wrapper re-tenta APENAS o
// transporte HTTP (uma chamada de modelo), NUNCA reexecuta o turno nem efeitos. Só 429/5xx são transitórios;
// 4xx (exceto 429) é definitivo e NÃO re-tenta. Respeita o "try again in Xs" do corpo do 429 (a OpenAI não
// expõe header aqui) e senão faz backoff exponencial com jitter. Ao esgotar, PROPAGA a falha (não esconde).
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, Math.max(0, ms))); }
function backoffMs(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** (attempt - 1));
  return Math.floor(exp / 2 + Math.random() * (exp / 2)); // jitter em [exp/2, exp]
}
function retryAfterFromBody(bodyText: string): number | null {
  const s = /try again in ([\d.]+)s\b/i.exec(bodyText);
  if (s) return Math.ceil(Number(s[1]) * 1000) + 250;
  const ms = /try again in (\d+)ms\b/i.exec(bodyText);
  if (ms) return Number(ms[1]) + 100;
  return null;
}
export type RetryAttemptLog = { readonly at: number; readonly status: number; readonly delayMs: number; readonly kind: "http" | "throw" };
export class RetryingModelHttpTransport implements ModelHttpTransport {
  readonly attempts: RetryAttemptLog[] = [];
  #exhausted = 0;
  constructor(
    private readonly inner: ModelHttpTransport,
    private readonly opts: { readonly maxAttempts?: number; readonly baseDelayMs?: number; readonly maxDelayMs?: number; readonly perAttemptTimeoutMs?: number } = {},
  ) {}
  #finalNon2xx = 0;
  get retries(): number { return this.attempts.length; }
  get exhaustedFailures(): number { return this.#exhausted; }
  get finalFailures(): number { return this.#finalNon2xx; } // respostas FINAIS com status != 2xx (Codex: exigir 2xx)
  #done(res: ModelHttpResponse): ModelHttpResponse { if (res.status < 200 || res.status >= 300) this.#finalNon2xx++; return res; }

  async postJson(url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    const maxAttempts = this.opts.maxAttempts ?? 5;
    const base = this.opts.baseDelayMs ?? 800;
    const max = this.opts.maxDelayMs ?? 20_000;
    for (let attempt = 1; ; attempt++) {
      let res: ModelHttpResponse;
      try {
        // AbortSignal/timeout NOVO por tentativa (Codex): senão a 1ª tentativa consome o signal e as retries
        // nascem já abortadas. Sobrescreve o signal do request a cada tentativa (padrão 45s).
        const perAttempt = { ...request, signal: AbortSignal.timeout(this.opts.perAttemptTimeoutMs ?? 45_000) } as ModelHttpRequest;
        res = await this.inner.postJson(url, perAttempt);
      } catch (err) {
        // Falha de transporte (rede/timeout): transitória. Re-tenta até o limite; ao esgotar, RE-LANÇA.
        if (attempt >= maxAttempts) { this.#exhausted++; throw err; }
        const delay = backoffMs(attempt, base, max);
        this.attempts.push({ at: Date.now(), status: 0, delayMs: delay, kind: "throw" });
        await sleep(delay);
        continue;
      }
      // Só 429 e 5xx são transitórios; demais 4xx (auth/schema) são definitivos e NÃO re-tentam. E 429 de
      // insufficient_quota (billing esgotado) é DEFINITIVO — re-tentar só desperdiça (Codex): devolve na hora.
      const isQuotaExhausted = res.status === 429 && /insufficient_quota|exceeded your current quota|check your plan and billing/i.test(res.bodyText);
      if ((res.status !== 429 && res.status < 500) || isQuotaExhausted) return this.#done(res);
      if (attempt >= maxAttempts) { this.#exhausted++; return this.#done(res); } // esgotou -> devolve a falha (não esconde)
      const delay = retryAfterFromBody(res.bodyText) ?? backoffMs(attempt, base, max);
      this.attempts.push({ at: Date.now(), status: res.status, delayMs: delay, kind: "http" });
      await sleep(delay);
    }
  }
}

// ── Montagem REAL (réplica de pilot-active-root.create, sem instância/dispatch) ─
export type RealAssembly = {
  readonly ref: TenantAgentRef;
  readonly runtimeConfig: TenantRuntimeConfig;
  readonly portalPrompt: string; // prompt real (em memória; nunca vai pro relatório)
  readonly promptSha: string;
  readonly llm: PromptBoundConversationAdapter;
  readonly runQuery: QueryRunner;
  readonly contextPreparer: ConversationTurnContextPreparer;
  readonly sdrPolicy: SdrQualificationPolicy;
  readonly transport: CountingModelHttpTransport;
  readonly retryTransport: RetryingModelHttpTransport; // Seção 9: retries/backoff do transporte do agente
  readonly judgeRetryTransport: RetryingModelHttpTransport; // idem p/ o judge
  readonly chat: (system: string, user: string) => Promise<string>;
  readonly aiProvider: AiProviderRuntimeConfig;
  // R13 Inc2/G: exposto p/ o AgentBrain REAL (central-real-harness) materializar a chave no seu próprio transporte
  // contador (prova de chamada + prompt integral do brain), sem re-resolver a chave.
  readonly openAiSecret: RuntimeApiSecret;
};

export async function buildRealAssembly(clock: { now(): string }): Promise<RealAssembly> {
  return buildRealAssemblyFor({ tenantId: PILOT_TENANT, agentId: PILOT_AGENT }, clock);
}

// Allows production-equivalent canaries for another explicitly selected tenant
// without changing the legacy Douglas eval contract.
export async function buildRealAssemblyFor(ref: TenantAgentRef, clock: { now(): string }): Promise<RealAssembly> {
  const url = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const allowedHosts = [hostOf(url)];
  const aiProvider = resolveAiProviderRuntime(process.env);

  const serviceGateway = new SupabaseServiceGateway({ url, serviceRoleKey, allowedHosts, timeoutMs: 20_000, maxResponseBytes: 8 * 1024 * 1024 });
  const readDb = SupabaseReadOnlyDatabase.create({ url, apiKey: serviceRoleKey, allowedHosts, timeoutMs: 15_000, maxResponseBytes: 4 * 1024 * 1024 });
  // Override da chave OpenAI SÓ NO HARNESS (a BYOK do tenant do piloto esgotou; a de PLATAFORMA — a mesma do
  // Pedro v2, Bruno/Wander — tem saldo). Produção segue usando resolveTenantOpenAiSecret. 3 fontes, em ordem:
  //  1) EVAL_OPENAI_API_KEY (env/.env): usa a chave crua (nunca hardcodada nem logada, só a fonte);
  //  2) EVAL_USE_PLATFORM_KEY=1: lê a chave de PLATAFORMA do Vault (get_platform_ai_key) — sem manusear segredo;
  //  3) default: BYOK do tenant (comportamento atual).
  const evalKeyName = aiProvider.provider === "deepseek" ? "EVAL_DEEPSEEK_API_KEY" : "EVAL_OPENAI_API_KEY";
  const evalKeyOverride = process.env[evalKeyName]?.trim();
  let openAiSecret: RuntimeApiSecret;
  let keySource: string;
  if (evalKeyOverride) {
    openAiSecret = AiRuntimeSecret.fromString(aiProvider.provider, evalKeyOverride);
    keySource = `${evalKeyName} (override do harness)`;
  } else if (resolveProviderEnvironmentSecret(process.env, aiProvider.provider)) {
    openAiSecret = resolveProviderEnvironmentSecret(process.env, aiProvider.provider)!;
    keySource = `${aiProvider.provider} (env do servico)`;
  } else if (process.env.EVAL_USE_PLATFORM_KEY === "1") {
    const raw = await serviceGateway.rpc<unknown>("get_platform_ai_key", { p_provider: aiProvider.provider });
    const key = typeof raw === "string" ? raw.trim() : "";
    if (!key || /\s/.test(key) || key.length > 512) throw new Error("EVAL_PLATFORM_KEY_INVALID");
    openAiSecret = AiRuntimeSecret.fromString(aiProvider.provider, key);
    keySource = `PLATAFORMA via Vault get_platform_ai_key (${aiProvider.provider})`;
  } else {
    openAiSecret = await resolveTenantAiSecret({ gateway: serviceGateway, tenantId: PILOT_TENANT, provider: aiProvider.provider });
    keySource = `tenant (resolveTenantAiSecret: ${aiProvider.provider}, BYOK->plataforma)`;
  }
  console.log(`config IA: provider=${aiProvider.provider} model=${aiProvider.model} fonte=${keySource}`);

  const retryTransport = new RetryingModelHttpTransport(new FetchModelHttpTransport());
  const transport = new CountingModelHttpTransport(retryTransport);
  const modelFactory = createOpenAiModelFactory({
    openAiSecret,
    modelTransport: transport,
    modelOptions: {
      endpointUrl: aiProvider.endpointUrl,
      allowedHosts: [...aiProvider.allowedHosts],
      tokenParameter: aiProvider.tokenParameter,
      modelOverride: aiProvider.model,
      timeoutMs: 30_000,
      maxResponseBytes: 2 * 1024 * 1024,
      maxCompletionTokens: 1_200,
    },
  });

  const gateway = new V2DatabaseReadGateway(readDb);
  const loaded = await new V2TenantConfigSource(gateway).load(ref);
  if (!loaded.ok) throw new Error(`TENANT_CONFIG_INVALID:${(loaded as { error?: { code?: string } }).error?.code ?? "?"}`);
  const runtimeConfig = loaded.config;
  transport.fullPrompt = runtimeConfig.promptText; // comparacao integral por chamada

  const model = modelFactory(runtimeConfig);
  const credentialProvider = new V2DatabaseCredentialProvider(readDb, new V2PlaintextApiKeyReader());
  const cache = new ReadCache<NormalizedVehicle[]>(clock as never, { ttlMs: 60_000, maxItems: 8, enabled: true });
  const loader = new V2StockLoader(gateway, credentialProvider, cache, new SafeHttpClient());
  const stockSource = new V2StockSource(loader);
  const photoSource = new V2VehiclePhotoSource(loader);
  const crmSource = new V2CrmReadSource(gateway);
  const runQuery = createReadQueryRunner(ref, { stock: stockSource, vehicleDetails: stockSource, vehiclePhotos: photoSource, crm: crmSource });

  const llm = new PromptBoundConversationAdapter(runtimeConfig, model);
  const contextPreparer = new ConversationTurnContextPreparer(ref, llm, new StockTenantCatalogSource(stockSource));
  const sdrPolicy = buildSdrQualificationPolicy(runtimeConfig);

  // Chat DIRETO p/ o JUDGE (mesma chave real, transporte SEPARADO — nao conta como agente). Também com
  // retry/backoff: o GATE exige TODAS as chamadas do judge concluídas — um 429 no judge não pode reprovar.
  const judgeTransport = new RetryingModelHttpTransport(new FetchModelHttpTransport());
  const chat = async (system: string, user: string): Promise<string> => openAiSecret.materialize(async (apiKey) => {
    const tokenLimit = { [aiProvider.tokenParameter]: 900 };
    const res = await judgeTransport.postJson(aiProvider.endpointUrl, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: aiProvider.model, temperature: 0, response_format: { type: "json_object" }, ...tokenLimit, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(40_000),
    } as never);
    try { return (JSON.parse(res.bodyText)?.choices?.[0]?.message?.content as string) ?? "{}"; } catch { return "{}"; }
  });

  return { ref, runtimeConfig, portalPrompt: runtimeConfig.promptText, promptSha: transport.promptSha, llm, runQuery, contextPreparer, sdrPolicy, transport, retryTransport, judgeRetryTransport: judgeTransport, chat, openAiSecret, aiProvider };
}

// ── Sanitização (nunca vaza chave/prompt/telefone/CPF/dado pessoal) ──────────
export function sanitize(text: string): string {
  if (!text) return text;
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***")
    .replace(/\beyJ[A-Za-z0-9_.-]{10,}\b/g, "jwt-***")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "***CPF***")
    // Telefone BR: EXIGE DDD (2 díg) OU 9-inicial de celular — assim "Peugeot 2008 2015" (modelo+ano, 4+4
    // dígitos sem DDD) NUNCA vira telefone. Codex: o judge precisa da conversa semanticamente íntegra.
    .replace(/\b(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9\d{4}[-\s]?\d{4}\b/g, "***TEL***")   // celular c/ DDD (11 díg)
    .replace(/\b(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?[2-5]\d{3}[-\s]?\d{4}\b/g, "***TEL***") // fixo c/ DDD (10 díg)
    .replace(/\b9\d{4}[-\s]\d{4}\b/g, "***TEL***");                                     // celular s/ DDD (9XXXX-XXXX)
}

// ── Driver: ingere rajadas -> runConversationTurn (efeitos OFF) -> SIMULA accepted -> captura ─
export const EVAL_LIMITS = { maxSteps: 4, totalTimeoutMs: 70_000, proposeTimeoutMs: 25_000, queryTimeoutMs: 20_000, composeTimeoutMs: 25_000 } as const;

export type ToolLog = { tool: string; input: Record<string, unknown>; ok: boolean; itemCount?: number; keys?: string[] };
export type SlotDelta = { slot: string; from: string; to: string };
export type OutboxLog = { kind: string; vehicleKey?: string; photoCount?: number; status: string; receiptLevel?: string };
export type TurnCapture = {
  turnIndex: number; turnId: string; leadText: string; agentText: string; status: string;
  action?: string; reasonCode?: string; reasonSummary?: string; confidence?: number; terminalSafe?: boolean;
  llmCallsInTurn: number; latencyMs: number; tools: ToolLog[]; slotsDelta: SlotDelta[]; outbox: OutboxLog[];
  renderedOffer: { ordinal: number; vehicleKey: string }[]; promptExactInTurn: boolean;
  recentTurnsCount: number; recentAgentTexts: string[]; activeObjective?: { slot?: string; type?: string; status?: string } | null; commitErrors: string[]; error?: string;
  selectedFocusKey?: string | null; objectiveDeferrals?: number;
};

function recordingRunner(inner: QueryRunner, log: ToolLog[]): QueryRunner {
  return (async (call: QueryCall): Promise<QueryResult> => {
    const res = await inner(call);
    const rec: ToolLog = { tool: call.tool, input: { ...(call.input as Record<string, unknown>) }, ok: res.ok };
    if (res.ok && res.tool === "stock_search") { rec.itemCount = res.data.items.length; rec.keys = res.data.items.slice(0, 12).map((v) => v.vehicleKey); }
    else if (res.ok && res.tool === "vehicle_photos_resolve") { rec.itemCount = res.data.photoIds.length; rec.keys = [res.data.vehicleKey]; }
    else if (res.ok && res.tool === "vehicle_details") { rec.keys = [res.data.vehicle.vehicleKey]; }
    log.push(rec);
    return res;
  }) as QueryRunner;
}

type StateShape = { slots?: Record<string, { status?: string; value?: unknown; ref?: unknown }>; recentTurns?: { role?: string; text?: string }[]; currentObjective?: { slot?: string; type?: string; status?: string } | null; lastRenderedOfferContext?: { items?: { ordinal: number; vehicleKey: string }[] } };
function slotSummary(state: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const slots = (state as StateShape)?.slots ?? {};
  for (const k of Object.keys(slots)) { const s = slots[k]; if (s?.status && s.status !== "unknown") out[k] = `${s.status}:${JSON.stringify(s.value ?? s.ref ?? null)}`; }
  return out;
}
function diffSlots(before: unknown, after: unknown): SlotDelta[] {
  const b = slotSummary(before), a = slotSummary(after);
  const d: SlotDelta[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) d.push({ slot: k, from: b[k] ?? "-", to: a[k] ?? "-" });
  return d;
}

export async function runConversation(assembly: RealAssembly, convId: string, steps: readonly (readonly string[])[], mode: EvalMode = "pilot-realistic"): Promise<TurnCapture[]> {
  const base = { ms: Date.parse("2026-07-01T09:00:00.000Z") };
  const clock = { now: () => new Date(base.ms).toISOString() };
  const persistence = new InMemoryPersistence(clock as never, new FakeIdGen());
  const seed = persistence.begin();
  seed.casState(convId, 0, createInitialState({ conversationId: convId, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, leadId: null, now: clock.now() }));
  const seeded = seed.commit();
  if (!seeded.ok) throw new Error(`eval_seed_failed: ${seeded.reason}`);

  const captures: TurnCapture[] = [];
  let eventSeq = 0, turnSeq = 0;

  for (const burst of steps) {
    const before = (await persistence.load(convId))?.state;
    for (const msg of burst) { eventSeq += 1; await persistence.tryInsert({ eventId: `${convId}-e${eventSeq}`, conversationId: convId, raw: redact({ text: msg }) as never, receivedAt: clock.now() }); }
    base.ms += 1_000; // cutoff > received_at -> agrega a rajada inteira num turno.
    const tools: ToolLog[] = [];
    const llmBefore = assembly.transport.count;
    turnSeq += 1;
    const turnId = `eval-${convId}-t${turnSeq}`;
    const startedWall = Date.now();
    let res: { status?: string; composedText?: string; decision?: { action?: string; reasonCode?: string; reasonSummary?: string; confidence?: number }; terminalSafe?: boolean } = {};
    let error: string | undefined;
    try {
      res = await runConversationTurn({
        persistence, clock: clock as never, llm: assembly.llm, runQuery: recordingRunner(assembly.runQuery, tools),
        contextPreparer: assembly.contextPreparer, conversationId: convId, tenantId: PILOT_TENANT, agentId: PILOT_AGENT,
        leadId: null, workerId: "eval-worker", turnId, leaseTtlMs: 60_000, limits: EVAL_LIMITS,
        maxValidationAttempts: 3, providerCapability: { send_message: "none", send_media: "none" }, sdrPolicy: assembly.sdrPolicy,
      } as never) as never;
    } catch (err) { error = String((err as Error)?.message ?? err).slice(0, 200); }
    const latencyMs = Date.now() - startedWall;

    // ── SIMULA RECEIPT (correção Codex): claim + commitEffectOutcome REAIS (replica o dispatcher SEM despachar).
    //    O record nasce 'pending'; o commit exige claim (processing+token) antes — idêntico à produção.
    //    Loop igual ao OutboxDispatcher: dependentes só liberam após o prévio satisfazer (Issue C reproduzida).
    //    pilot-realistic: accepted p/ todos (mídia NÃO vira delivered). ideal-delivered: send_media delivered.
    const commitErrors: string[] = [];
    while (true) {
      const claimed = await persistence.claimOutbox(convId, "eval-worker", 60_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string; payload?: { photoIds?: string[] } }[]) {
        const useDelivered = mode === "ideal-delivered" && rec.kind === "send_media";
        const level: "accepted" | "delivered" = useDelivered ? "delivered" : "accepted";
        const perItem = useDelivered ? (rec.payload?.photoIds ?? []).map((id) => ({ photoId: id, status: "succeeded" as const })) : undefined;
        const receipt = { effectId: rec.effectId, level, providerMessageId: `eval-${rec.effectId}`, at: clock.now(), ...(perItem ? { perItem } : {}) } as EffectReceipt;
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        const c = await commitEffectOutcome({ persistence, clock: clock as never, conversationId: convId, effectId: rec.effectId, result });
        if (!c.ok) commitErrors.push(`${rec.effectId}: ${c.reason}`);
      }
    }

    // ── Recarrega o estado APÓS os outcomes (memória atualizada p/ o próximo turno). ──
    const after = (await persistence.load(convId))?.state as StateShape | undefined;
    const allOutbox = await persistence.listOutbox(convId) as unknown as { turnId: string; kind: string; status: string; receiptLevel?: string | null; payload?: { vehicleKey?: string; photoIds?: string[] } }[];
    const outboxLog: OutboxLog[] = allOutbox.filter((r) => r.turnId === turnId).map((r) => ({
      kind: r.kind, vehicleKey: r.payload?.vehicleKey,
      photoCount: Array.isArray(r.payload?.photoIds) ? r.payload!.photoIds!.length : undefined,
      status: r.status, receiptLevel: r.receiptLevel ?? undefined,
    }));
    const rendered = after?.lastRenderedOfferContext?.items ?? [];
    const turnCalls = assembly.transport.calls.slice(llmBefore);
    const recentAgent = (after?.recentTurns ?? []).filter((x) => x.role === "agent").map((x) => sanitize(String(x.text ?? "")).slice(0, 60));

    captures.push({
      turnIndex: turnSeq, turnId, leadText: sanitize(burst.join(" | ")), agentText: sanitize(res.composedText ?? ""),
      status: res.status ?? (error ? "error" : "unknown"), action: res.decision?.action, reasonCode: res.decision?.reasonCode,
      reasonSummary: sanitize(res.decision?.reasonSummary ?? ""), // Codex: registra o motivo/policyId de cada terminal_safe
      confidence: res.decision?.confidence, terminalSafe: res.terminalSafe, llmCallsInTurn: assembly.transport.count - llmBefore,
      latencyMs, tools, slotsDelta: diffSlots(before, after), outbox: outboxLog,
      renderedOffer: rendered.map((it) => ({ ordinal: it.ordinal, vehicleKey: it.vehicleKey })),
      promptExactInTurn: turnCalls.length === 0 ? true : turnCalls.every((c) => c.promptExact === true),
      recentTurnsCount: (after?.recentTurns ?? []).length, recentAgentTexts: recentAgent.slice(-4),
      activeObjective: after?.currentObjective ? { slot: after.currentObjective.slot, type: after.currentObjective.type, status: after.currentObjective.status } : null,
      selectedFocusKey: (after as { vehicleContext?: { selected?: { key?: string } } } | undefined)?.vehicleContext?.selected?.key ?? null,
      objectiveDeferrals: (after as { currentObjective?: { deferrals?: number } } | undefined)?.currentObjective?.deferrals ?? 0,
      commitErrors, error,
    });
    base.ms += 30_000; // janela entre steps.
  }
  return captures;
}
