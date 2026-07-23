import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { PostgresPersistence } from "../adapters/persistence/postgres-store.ts";
import { decodeSensitiveVaultKey, SupabaseSensitiveVault } from "../adapters/persistence/sensitive-vault.ts";
import { SupabaseReadOnlyDatabase } from "../adapters/read/supabase-read-database.ts";
import { V2PlaintextApiKeyReader } from "../adapters/read/v2-api-key-reader.ts";
import { PilotActiveRoot, type PilotBrainMode } from "../engine/pilot-active-root.ts";
import { SupabaseCrmLeadStore } from "../adapters/effects/supabase-crm-lead-store.ts";
import { SupabaseTransferStore } from "../adapters/effects/supabase-transfer-store.ts";
import { FollowupCandidateStore } from "../adapters/effects/followup-candidate-store.ts";
import { resolveConversationLeadBinding } from "../engine/crm-lead-binding.ts";
import { ingestPilotMessage } from "../engine/pilot-ingest.ts";
import { applyProviderDeliveryReceipt } from "../engine/provider-delivery-receipt.ts";
import { createOpenAiModelFactory } from "../engine/openai-canary-root.ts";
import { OpenAiAgentBrain } from "../adapters/llm/openai-agent-brain.ts";
import type { TenantRuntimeConfig } from "../domain/read-ports.ts";
import { allowedToolsForAgentProfile } from "../domain/agent-profile.ts";
import { resolveTenantAiSecret } from "../adapters/read/tenant-openai-key.ts";
import { resolveDebounceConfig, type DebounceConfig } from "../engine/debounce-policy.ts";
import { DebouncePoller } from "./debounce-poller.ts";
import { parsePedroV3ActiveScopes, PEDRO_V3_GLOBAL_ROLLOUT, type PedroV3ActiveScope } from "../domain/pilot-scope.ts";
import type { SettledConversation } from "../domain/ports.ts";
import { RealClock } from "./real-clock.ts";
import { sanitizeTurnError } from "./sanitize-error.ts";
import { evaluateFollowup, type FollowupEvaluationReason } from "../engine/followup-policy.ts";
import { isWithinAgentResponseSchedule } from "../domain/agent-response-schedule.ts";
import { PEDRO_V3_RUNTIME_RELEASE } from "./runtime-release.ts";
import { findSettledAcrossScopes } from "./settled-scope-finder.ts";
import { FetchModelHttpTransport, FetchUazapiHttpTransport, RetryingModelHttpTransport } from "./fetch-transports.ts";
import { resolveAiProviderRuntime, resolveProviderEnvironmentSecret, type AiProviderRuntimeConfig } from "./ai-provider.ts";
import { SupabaseServiceGateway } from "./supabase-service-gateway.ts";
import { SupabaseKnowledgeSource } from "../adapters/read/supabase-knowledge-source.ts";
import {
  PilotHttpApp,
  PilotTurnRuntimeError,
  type PilotHttpResponse,
  type PilotReceiptPayload,
  type PilotReceiptRunner,
  type PilotTurnPayload,
  type PilotTurnRunner,
} from "./pilot-http-app.ts";

const PILOT_TURN_LIMITS = {
  maxSteps: 4,
  totalTimeoutMs: 70_000,
  proposeTimeoutMs: 25_000,
  queryTimeoutMs: 20_000,
  composeTimeoutMs: 25_000,
} as const;

const MAX_REQUEST_BYTES = 32 * 1024;



// R13-D/4: modo do cérebro do piloto (default OFF). central_active só vale dentro do escopo do piloto (Douglas),
// que o próprio runtime já garante (PEDRO_V3_PILOT_TENANT_ID). Rollback imediato = voltar a env p/ off.
function resolveBrainMode(): PilotBrainMode {
  const value = process.env.PEDRO_V3_BRAIN_MODE?.trim();
  // LLM-first is the default. `off` remains an explicit rollback only.
  return value === "off" || value === "central_active" || value === "central_shadow" ? value : "central_active";
}

class RuntimeConfigError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RuntimeConfigError";
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new RuntimeConfigError(`ENV_${name}_MISSING`);
  return value;
}

function commaList(name: string): readonly string[] {
  const values = requiredEnv(name).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (values.length === 0) throw new RuntimeConfigError(`ENV_${name}_INVALID`);
  return Object.freeze([...new Set(values)]);
}

function supabaseHost(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RuntimeConfigError("ENV_SUPABASE_URL_INVALID");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new RuntimeConfigError("ENV_SUPABASE_URL_INVALID");
  }
  return parsed.hostname.toLowerCase();
}

class ProductionPilotRunner implements PilotTurnRunner, PilotReceiptRunner {
  readonly #supabaseUrl: string;
  readonly #serviceRoleKey: string;
  readonly #aiProvider: AiProviderRuntimeConfig;
  readonly #allowedUazapiHosts: readonly string[];
  #activeScopes: readonly PedroV3ActiveScope[];
  #activeScopesRefreshedAt = 0;
  #activeScopesRefresh: Promise<void> | null = null;
  readonly #clock = new RealClock();
  readonly #debounce: DebounceConfig;
  // FASE 1 CRM + Opção A: UMA instância (stateless) implementa as DUAS portas — CrmLeadStore (update
  // fill-only do dispatcher) e CrmLeadIdentityStore (resolução/criação do vínculo). null = flag OFF:
  // zero SELECT/INSERT no CRM, comportamento byte-idêntico ao atual.
  readonly #crmLeadStore: SupabaseCrmLeadStore | null;
  readonly #transferStore: SupabaseTransferStore | null;
  readonly #handoffEnabled: boolean;
  readonly #followupEnabled: boolean;
  readonly #sensitiveVault: SupabaseSensitiveVault | null;
  #followupDiagnostics: {
    lastTickAt: string | null;
    checked: number;
    due: number;
    planned: number;
    failed: number;
    lastFailure: string | null;
    skipped: Partial<Record<FollowupEvaluationReason, number>>;
  } = { lastTickAt: null, checked: 0, due: 0, planned: 0, failed: 0, lastFailure: null, skipped: {} };
  #turnSeq = 0;
  #pollDiagnostics: {
    lastFindAt: string | null;
    succeededScopes: number;
    failedScopes: number;
    lastFailure: string | null;
  } = { lastFindAt: null, succeededScopes: 0, failedScopes: 0, lastFailure: null };

  constructor() {
    this.#supabaseUrl = requiredEnv("SUPABASE_URL");
    this.#serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    // F2.6J: a chave OpenAI NAO vem de env global. E resolvida por tenant (BYOK) via Vault/RPC.
    this.#aiProvider = resolveAiProviderRuntime(process.env);
    this.#allowedUazapiHosts = commaList("PEDRO_V3_ALLOWED_UAZAPI_HOSTS");
    let configuredScopes: readonly PedroV3ActiveScope[] = [];
    try {
      configuredScopes = parsePedroV3ActiveScopes(process.env.PEDRO_V3_ACTIVE_SCOPES);
    } catch (error) {
      // Global rollout does not depend on the legacy allowlist. Keep the
      // process alive if a stale/malformed variable is still present; the
      // parser remains strict for explicit legacy use and its own tests.
      console.error("pedro_v3_active_scopes_invalid_ignored", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    // In the global rollout an absent env var must not leave the workers with
    // only the historical pilot. Keep explicit scopes as a bootstrap fallback
    // until the first database discovery completes.
    this.#activeScopes = PEDRO_V3_GLOBAL_ROLLOUT
      ? (process.env.PEDRO_V3_ACTIVE_SCOPES?.trim() ? configuredScopes : [])
      : configuredScopes;
    // F2.7.6: janela de debounce + intervalo do poller (defaults 6000/12000/2000ms).
    this.#debounce = resolveDebounceConfig(process.env);
    this.#crmLeadStore = process.env.PEDRO_V3_CRM_WRITE?.trim() === "active"
      ? new SupabaseCrmLeadStore({
          url: this.#supabaseUrl,
          serviceRoleKey: this.#serviceRoleKey,
          allowedHosts: [supabaseHost(this.#supabaseUrl)],
        })
      : null;
    this.#handoffEnabled = process.env.PEDRO_V3_HANDOFF?.trim() === "active";
    this.#followupEnabled = process.env.PEDRO_V3_FOLLOWUP?.trim() === "active";
    const vaultKey = process.env.PEDRO_V3_SENSITIVE_VAULT_KEY?.trim();
    this.#sensitiveVault = vaultKey
      ? new SupabaseSensitiveVault({
          url: this.#supabaseUrl, serviceRoleKey: this.#serviceRoleKey,
          allowedHosts: [supabaseHost(this.#supabaseUrl)], encryptionKey: decodeSensitiveVaultKey(vaultKey),
          keyVersion: process.env.PEDRO_V3_SENSITIVE_VAULT_KEY_VERSION?.trim() || "v1",
        })
      : null;
    this.#transferStore = this.#handoffEnabled || this.#followupEnabled
      ? new SupabaseTransferStore({
          url: this.#supabaseUrl,
          serviceRoleKey: this.#serviceRoleKey,
          allowedHosts: [supabaseHost(this.#supabaseUrl)],
        })
      : null;
  }

  get debounceConfig(): DebounceConfig {
    return this.#debounce;
  }

  get activeScopes(): readonly PedroV3ActiveScope[] {
    return this.#activeScopes;
  }

  #scopeFor(tenantId: string | null | undefined, agentId: string | null | undefined): PedroV3ActiveScope | null {
    return this.#activeScopes.find((scope) => scope.tenantId === tenantId && scope.agentId === agentId) ?? null;
  }

  #rememberScope(scope: { readonly tenantId: string; readonly agentId: string }): void {
    if (!PEDRO_V3_GLOBAL_ROLLOUT || !scope.tenantId.trim() || !scope.agentId.trim()) return;
    if (this.#activeScopes.some((item) => item.tenantId === scope.tenantId && item.agentId === scope.agentId)) return;
    this.#activeScopes = [...this.#activeScopes, { tenantId: scope.tenantId, agentId: scope.agentId }];
  }

  // The HTTP gate is global, but background workers still need concrete
  // tenant+agent pairs to query their isolated partitions.
  async #refreshActiveScopes(force = false): Promise<void> {
    if (!PEDRO_V3_GLOBAL_ROLLOUT) return;
    const now = Date.now();
    if (!force && now - this.#activeScopesRefreshedAt < 30_000) return;
    if (this.#activeScopesRefresh) return this.#activeScopesRefresh;
    this.#activeScopesRefresh = (async () => {
      try {
        const rows = await this.#gateway().selectMany(
          "wa_ai_agents",
          { is_active: true },
          { columns: "id,user_id", limit: 500 },
        );
        const discovered: PedroV3ActiveScope[] = [];
        const seen = new Set<string>();
        for (const row of rows) {
          const tenantId = typeof row.user_id === "string" ? row.user_id.trim() : "";
          const agentId = typeof row.id === "string" ? row.id.trim() : "";
          if (!tenantId || !agentId) continue;
          const key = `${tenantId}:${agentId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          discovered.push({ tenantId, agentId });
        }
        // Preserve a scope learned from a just-ingested request while replacing
        // the periodic snapshot, so refresh cannot create a response gap.
        const current = this.#activeScopes.filter((scope) => !seen.has(`${scope.tenantId}:${scope.agentId}`));
        this.#activeScopes = [...discovered, ...current];
        this.#activeScopesRefreshedAt = Date.now();
        console.log(JSON.stringify({ event: "pedro_v3_active_scopes_refreshed", count: this.#activeScopes.length }));
      } catch (error) {
        // Keep the last snapshot. Inbound turns also call #rememberScope, so a
        // newly active account still works while discovery is unavailable.
        console.error(JSON.stringify({ event: "pedro_v3_active_scopes_refresh_failed", reason: sanitizeTurnError(error instanceof Error ? error.message : String(error)) }));
      } finally {
        this.#activeScopesRefresh = null;
      }
    })();
    return this.#activeScopesRefresh;
  }

  get followupDiagnostics(): Readonly<Record<string, unknown>> {
    return {
      ...this.#followupDiagnostics,
      skipped: { ...this.#followupDiagnostics.skipped },
    };
  }

  get pollDiagnostics(): Readonly<Record<string, unknown>> {
    return { ...this.#pollDiagnostics };
  }

  #gateway(): SupabaseServiceGateway {
    return new SupabaseServiceGateway({
      url: this.#supabaseUrl,
      serviceRoleKey: this.#serviceRoleKey,
      allowedHosts: [supabaseHost(this.#supabaseUrl)],
      timeoutMs: 20_000,
      maxResponseBytes: 8 * 1024 * 1024,
    });
  }

  async applyReceipt(payload: PilotReceiptPayload) {
    this.#rememberScope({ tenantId: payload.tenantId, agentId: payload.agentId });
    const persistence = new PostgresPersistence(this.#gateway(), {
      tenantId: payload.tenantId,
      clock: this.#clock,
    });
    const result = await applyProviderDeliveryReceipt({
      persistence,
      clock: this.#clock,
      receipt: {
        providerMessageId: payload.providerMessageId,
        status: payload.status,
        at: payload.occurredAt,
      },
    });
    // Um receipt delivered pode liberar crm/handoff/notify. Sem este flush a
    // cadeia ficaria parada ate a proxima mensagem do lead.
    if (result.status === "applied" && result.conversationId) {
      try {
        const scope = this.#scopeFor(payload.tenantId, payload.agentId);
        if (!scope) throw new Error("ACTIVE_SCOPE_DENIED");
        const root = await this.#createRoot(scope, null, this.#gateway());
        await root.flushConversationEffects({
          persistence,
          conversationId: result.conversationId,
          to: "receipt-flush",
          workerId: "receipt-flush",
        });
      } catch (error) {
        console.error(JSON.stringify({ event: "pedro_v3_receipt_flush_failed", conversationId: result.conversationId, reason: sanitizeTurnError(error instanceof Error ? error.message : String(error)) }));
      }
    }
    return result;
  }

  // F2.7.6: /v1/pilot/turn agora SO INGERE (rapido). O processamento real (decidir +
  // despachar) fica p/ o poller quando a conversa "assenta" (debounce). Resposta
  // {status:"accepted", ingested:true} -> o bridge mantem routed: pedro_v3 (contrato intacto).
  async run(payload: PilotTurnPayload) {
    this.#rememberScope({ tenantId: payload.tenantId, agentId: payload.agentId });
    const persistence = new PostgresPersistence(this.#gateway(), {
      tenantId: payload.tenantId,
      clock: this.#clock,
    });
    try {
      const ingest = await ingestPilotMessage(persistence, this.#clock, {
        eventId: payload.eventId,
        conversationId: payload.conversationId,
        agentId: payload.agentId,
        leadId: payload.leadId ?? null,
        leadNameHint: payload.leadNameHint ?? null,   // ⭐SEM inv.7: viaja no raw do inbox (como o adContext)
        toAddr: payload.to,
        messageText: payload.messageText,
        receivedAt: payload.receivedAt,
        adContext: payload.adReferral,   // F2.32 (CTWA): forwardado pelo bridge; guardado no raw do inbox
        mediaContext: payload.mediaContext,
        tenantId: payload.tenantId,
        sensitiveVault: this.#sensitiveVault,
      });
      if (ingest.decision === "duplicate") {
        return { status: "duplicate" as const, inserted: false as const, turnId: payload.turnId, dispatched: 0 as const };
      }
      return { status: "accepted" as const, inserted: true as const, dispatched: 0 as const };
    } catch {
      // Falha ANTES de ingerir (rota/banco): ingested=false -> bridge faz fallback p/ o v2.
      throw new PilotTurnRuntimeError("PILOT_TURN_FAILED", false);
    }
  }

  // Consulta cada escopo autorizado isoladamente. Nunca ha leitura cross-tenant.
  async findSettled(nowIso: string): Promise<SettledConversation[]> {
    await this.#refreshActiveScopes();
    const result = await findSettledAcrossScopes(this.#activeScopes, async (scope) => {
      const persistence = new PostgresPersistence(this.#gateway(), { tenantId: scope.tenantId, clock: this.#clock });
      const settled = await persistence.findSettledConversations(nowIso, this.#debounce.debounceMs, this.#debounce.maxWaitMs, 20);
      return settled
        .filter((item) => item.agentId === scope.agentId)
        .map((item) => ({ ...item, tenantId: scope.tenantId }));
    });
    const lastFailure = result.failures.at(-1);
    this.#pollDiagnostics = {
      lastFindAt: nowIso,
      succeededScopes: result.succeededScopes,
      failedScopes: result.failures.length,
      lastFailure: lastFailure ? sanitizeTurnError(lastFailure.error) : null,
    };
    for (const failure of result.failures) {
      console.error(JSON.stringify({
        event: "pedro_v3_settled_scope_failed",
        tenantId: failure.scope.tenantId,
        agentId: failure.scope.agentId,
        reason: sanitizeTurnError(failure.error),
      }));
    }
    return [...result.settled];
  }

  async #createRoot(scope: PedroV3ActiveScope, leadId: string | null, gateway: SupabaseServiceGateway): Promise<PilotActiveRoot> {
    const readDb = SupabaseReadOnlyDatabase.create({
      url: this.#supabaseUrl,
      apiKey: this.#serviceRoleKey,
      allowedHosts: [supabaseHost(this.#supabaseUrl)],
      timeoutMs: 15_000,
      maxResponseBytes: 4 * 1024 * 1024,
    });
    const aiSecret = resolveProviderEnvironmentSecret(process.env, this.#aiProvider.provider)
      ?? await resolveTenantAiSecret({ gateway, tenantId: scope.tenantId, provider: this.#aiProvider.provider });
    const brainMode = resolveBrainMode();
    // R13-D/4: AgentBrain REAL (OpenAI) só é fabricado quando o modo pede. Planner em temp baixa (0.2). Segredo por
    // tenant (mesmo openAiSecret do compose); prompt integral vai no system do brain (prova por SHA no adapter).
    // ⭐Fase 4: transporte com retry/backoff (429/5xx/erro de rede, honra Retry-After, teto 2 retries). Compartilhado
    // pelo brain e pelo compose — o retry-storm nascia justamente do POST cru sem backoff.
    const modelTransport = new RetryingModelHttpTransport(new FetchModelHttpTransport());
    const agentBrainFactory = brainMode !== "off"
      ? (config: TenantRuntimeConfig) => new OpenAiAgentBrain(aiSecret, modelTransport, config.promptText, {
          model: this.#aiProvider.model,
          retryModel: this.#aiProvider.retryModel,
          endpointUrl: this.#aiProvider.endpointUrl,
          allowedHosts: this.#aiProvider.allowedHosts,
          tokenParameter: this.#aiProvider.tokenParameter,
          // ⭐Item 5: json_schema strict + envelope understanding tornam a saída mais verbosa; 1200 truncava (finish=length ->
          // "JSON inválido"). 2200 dá folga p/ understanding + draft com lista de ofertas sem cortar o JSON no meio.
          temperature: 0.2, maxCompletionTokens: this.#aiProvider.provider === "deepseek" ? 1_600 : 2_200, timeoutMs: 45_000,
          allowedTools: [...allowedToolsForAgentProfile(config.agentType)],
          handoffEnabled: this.#handoffEnabled,
          followupEnabled: this.#followupEnabled,
          semanticCriticEnabled: false,
          semanticCriticModel: "gpt-4.1",
        })
      : undefined;
    return PilotActiveRoot.create({
      mode: "active",
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      leadId,
      activeScopes: this.#activeScopes,
    }, {
      db: readDb,
      decryptor: new V2PlaintextApiKeyReader(),
      clock: this.#clock,
      modelFactory: createOpenAiModelFactory({
        openAiSecret: aiSecret,
        modelTransport,
        modelOptions: {
          endpointUrl: this.#aiProvider.endpointUrl,
          allowedHosts: this.#aiProvider.allowedHosts,
          modelOverride: this.#aiProvider.model,
          tokenParameter: this.#aiProvider.tokenParameter,
          timeoutMs: 30_000,
          maxResponseBytes: 2 * 1024 * 1024,
          maxCompletionTokens: 1_200,
        },
      }),
      whatsappTransport: new FetchUazapiHttpTransport(),
      allowedUazapiHosts: this.#allowedUazapiHosts,
      // UX de WhatsApp: presence falha aberta e nunca participa da decisao comercial da LLM.
      typingEnabled: process.env.PEDRO_V3_TYPING?.trim().toLowerCase() !== "off",
      brainMode,
      agentBrainFactory,
      knowledgeSource: new SupabaseKnowledgeSource(this.#supabaseUrl, this.#serviceRoleKey),
      // FASE 1 CRM (missão 2026-07-09): OFF por default (fail-closed). Liga SÓ com PEDRO_V3_CRM_WRITE=active
      // E SÓ para o tenant do piloto (Douglas) — o root já é pilot-scoped; o store filtra ownership no banco.
      crmLeadStore: this.#crmLeadStore,
      transferStore: this.#transferStore,
      handoffEnabled: this.#handoffEnabled,
      sensitiveVault: this.#sensitiveVault,
    });
  }

  // F2.7.6: processa UMA conversa assentada (claim do BLOCO -> decide -> dispatch).
  // Falha de bootstrap (ex.: sem chave do tenant) NAO derruba o poller: deixa pendente p/ o proximo tick.
  async processSettled(settled: SettledConversation): Promise<void> {
    const scope = this.#scopeFor(settled.tenantId, settled.agentId);
    if (!scope) {
      console.error(JSON.stringify({ event: "pedro_v3_settled_scope_denied", conversationId: settled.conversationId }));
      return;
    }
    const gateway = this.#gateway();
    const persistence = new PostgresPersistence(gateway, {
      tenantId: scope.tenantId,
      clock: this.#clock,
    });

    // ── Opção A (bloqueio leadId 2026-07-10): o bridge entrega leadId=null; o VÍNCULO lead↔conversa é
    //    resolvido AQUI, no composition root, com autoridade do banco+ownership (nunca payload). Flag OFF
    //    (#crmLeadStore null) => zero IO extra, leadId segue o da routing (null) como sempre. Falha de
    //    resolução NUNCA silencia o lead: o turno conversacional roda normalmente com CRM desligado. ──────
    let turnLeadId = settled.leadId;
    let crmWrite: { enabled: boolean; bootstrapSync: boolean } | undefined;
    if (this.#crmLeadStore != null) {
      let stateLeadId: string | null = null;
      try {
        const snapshot = await persistence.load(settled.conversationId);
        stateLeadId = snapshot?.state.leadId ?? null;   // fonte DURÁVEL do vínculo (a routing regride a cada ingest)
      } catch {
        stateLeadId = null;   // leitura falhou: segue como não-vinculado; o binding decide (transiente => CRM off)
      }
      const binding = await resolveConversationLeadBinding({
        identity: this.#crmLeadStore,
        ref: scope,
        toAddr: settled.toAddr,
        settledLeadId: settled.leadId,
        stateLeadId,
      });
      turnLeadId = binding.leadId;
      crmWrite = { enabled: binding.crmEnabled, bootstrapSync: binding.bootstrapSync };
      if (binding.note !== "bound_existing") {
        // Observabilidade SANITIZADA: nunca telefone/jid — só conversa (hash) + nota + uuid do lead.
        console.log(JSON.stringify({ event: "pedro_v3_crm_lead_binding", conversationId: settled.conversationId, note: binding.note, leadId: binding.leadId }));
      }
      if (binding.leadId != null && binding.leadId !== settled.leadId) {
        // Re-hidrata a routing (tenant-scoped via persistence). Best-effort: o RPC do ingest sobrescreve
        // lead_id com o null do bridge na PRÓXIMA mensagem — a fonte durável é o state (acima); isto só
        // melhora a observabilidade/settled dos próximos ticks até lá.
        try {
          await persistence.upsertRouting(settled.conversationId, settled.agentId, binding.leadId, settled.toAddr);
        } catch { /* best-effort: nunca bloqueia o turno */ }
      }
      if (binding.leadId != null && binding.crmEnabled) {
        try { await this.#crmLeadStore.touchOwnedLeadActivity(scope, binding.leadId, this.#clock.now()); }
        catch { /* atividade do CRM nunca silencia o lead */ }
      }
    }

    let root: PilotActiveRoot;
    try {
      root = await this.#createRoot(scope, turnLeadId, gateway);
    } catch (error) {
      console.error(JSON.stringify({
        event: "pedro_v3_root_bootstrap_failed",
        tenantId: scope.tenantId,
        agentId: scope.agentId,
        conversationId: settled.conversationId,
        reason: sanitizeTurnError(error),
      }));
      return;
    }
    // The message and CRM identity were already ingested/bound above. Outside
    // the tenant-configured window, leave the settled block pending: no LLM,
    // WhatsApp reply, follow-up, or automatic handoff is produced. Manual
    // transfer from the panel does not pass through this gate.
    if (!root.isAutomaticResponseAllowed(this.#clock.now())) {
      console.log(JSON.stringify({
        event: "pedro_v3_response_schedule_closed",
        tenantId: scope.tenantId,
        agentId: scope.agentId,
        conversationId: settled.conversationId,
      }));
      return;
    }
    this.#turnSeq += 1;
    const turnId = `poll-${this.#turnSeq}-${randomUUID()}`;
    const processed = await root.processConversation({
      persistence,
      conversationId: settled.conversationId,
      to: settled.toAddr,
      workerId: "poll-worker",
      turnId,
      limits: PILOT_TURN_LIMITS,
      maxValidationAttempts: 3, // R10: 1 tentativa + 2 retries c/ guidance específico -> menos terminal-safe
      blockAwaitMaxMs: this.#debounce.maxWaitMs, // TRAVA ANTI-PARCIAL (P0 bloco-do-lead): teto = maxWait do debounce
      crmWrite,
    });
    if (processed.status === "commit_failed" && processed.engine.status === "commit_failed") {
      console.error(JSON.stringify({
        event: "pedro_v3_turn_commit_failed",
        conversationId: settled.conversationId,
        reason: sanitizeTurnError(processed.engine.reason),
      }));
    }
  }

  async processDueFollowups(): Promise<{ checked: number; planned: number; failed: number }> {
    await this.#refreshActiveScopes();
    const tickAt = this.#clock.now();
    const skipped: Partial<Record<FollowupEvaluationReason, number>> = {};
    const skip = (reason: FollowupEvaluationReason) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
    if (!this.#followupEnabled || !this.#transferStore) {
      this.#followupDiagnostics = { lastTickAt: tickAt, checked: 0, due: 0, planned: 0, failed: 0, lastFailure: "worker_disabled", skipped };
      return { checked: 0, planned: 0, failed: 0 };
    }
    const gateway = this.#gateway();
    let checked = 0;
    let planned = 0;
    let failed = 0;
    let dueCount = 0;
    let lastFailure: string | null = null;
    for (const scope of this.#activeScopes) {
      try {
        const candidates = await new FollowupCandidateStore(gateway).list(scope);
        checked += candidates.length;
        const config = await this.#transferStore.loadAgentConfig(scope);
        if (!config?.rules.followup.enabled) {
          skip("rules_disabled");
          if (!config) lastFailure ??= "agent_config_missing";
          continue;
        }
        if (!isWithinAgentResponseSchedule(tickAt, config.responseSchedule)) {
          skip("outside_response_schedule");
          continue;
        }
        for (const candidate of candidates) {
          try {
            const persistence = new PostgresPersistence(gateway, { tenantId: scope.tenantId, clock: this.#clock });
            const outbox = await persistence.listOutbox(candidate.conversationId);
            const evaluation = evaluateFollowup({ state: candidate.state, outbox, rules: config.rules.followup, now: this.#clock.now() });
            if (!evaluation.due) { skip(evaluation.reason); continue; }
            dueCount += 1;
            const root = await this.#createRoot(scope, candidate.leadId, gateway);
            const result = await root.processFollowup({
              persistence, conversationId: candidate.conversationId, to: candidate.toAddr,
              workerId: "followup-worker", due: evaluation.due, rules: config.rules,
            });
            if (result.planned) {
              planned += 1;
            } else if (result.reason && result.reason !== "not_eligible") {
              failed += 1;
              lastFailure = result.reason;
              console.error(JSON.stringify({
                event: "pedro_v3_followup_not_planned",
                conversationId: candidate.conversationId,
                tenantId: scope.tenantId,
                stage: evaluation.due.stage,
                reason: sanitizeTurnError(result.reason),
              }));
            }
          } catch (error) {
            failed += 1;
            lastFailure = sanitizeTurnError(error instanceof Error ? error.message : String(error));
            console.error(JSON.stringify({ event: "pedro_v3_followup_failed", conversationId: candidate.conversationId, tenantId: scope.tenantId, reason: lastFailure }));
          }
        }
      } catch (error) {
        failed += 1;
        lastFailure = sanitizeTurnError(error instanceof Error ? error.message : String(error));
        console.error(JSON.stringify({ event: "pedro_v3_followup_scan_failed", tenantId: scope.tenantId, agentId: scope.agentId, reason: lastFailure }));
      }
    }
    this.#followupDiagnostics = { lastTickAt: tickAt, checked, due: dueCount, planned, failed, lastFailure, skipped };
    return { checked, planned, failed };
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, result: PilotHttpResponse): void {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}

const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new RuntimeConfigError("ENV_PORT_INVALID");

const runtime = new ProductionPilotRunner();
const app = new PilotHttpApp(requiredEnv("PEDRO_V3_BRIDGE_SECRET"), runtime, runtime, () => ({
  runtimeRelease: PEDRO_V3_RUNTIME_RELEASE,
  configuredBrainMode: resolveBrainMode(),
  aiProvider: resolveAiProviderRuntime(process.env).provider,
  aiModel: resolveAiProviderRuntime(process.env).model,
  crmWrite: process.env.PEDRO_V3_CRM_WRITE?.trim() === "active",
  handoff: process.env.PEDRO_V3_HANDOFF?.trim() === "active",
  followup: process.env.PEDRO_V3_FOLLOWUP?.trim() === "active",
  sensitiveVault: Boolean(process.env.PEDRO_V3_SENSITIVE_VAULT_KEY?.trim()),
  activeScopeCount: runtime.activeScopes.length,
  followupWorker: runtime.followupDiagnostics,
  conversationWorker: runtime.pollDiagnostics,
}), runtime.activeScopes);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const bodyText = request.method === "POST" ? await readBody(request) : "";
    const result = await app.handle({
      method: request.method ?? "GET",
      pathname: url.pathname,
      authorization: request.headers.authorization,
      contentType: request.headers["content-type"],
      bodyText,
    });
    send(response, result);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "REQUEST_TOO_LARGE";
    send(response, {
      status: tooLarge ? 413 : 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify({ ok: false, error: tooLarge ? "request_too_large" : "server_error", ingested: false }),
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({
    event: "pedro_v3_service_started",
    runtimeRelease: PEDRO_V3_RUNTIME_RELEASE,
    port,
    mode: "pilot",
    brainMode: resolveBrainMode(),
    activeScopeCount: runtime.activeScopes.length,
  }));
});

// F2.7.6: poller de debounce — processa as conversas que ja assentaram (quietas >= debounce
// OU pendente mais antiga >= max). Robusto: estado no Postgres (v3_inbox + routing), recupera
// no restart. Um tick nunca sobrepoe o anterior; falha de uma conversa nao derruba o laço.
const poller = new DebouncePoller(
  (nowIso) => runtime.findSettled(nowIso),
  (settled) => runtime.processSettled(settled),
  new RealClock(),
  (event) => {
    if (event.kind === "error") {
      console.error(JSON.stringify({ event: "pedro_v3_poll_error", context: event.context, reason: sanitizeTurnError(event.detail) }));
    }
  },
);
const stopPoller = poller.start(runtime.debounceConfig.pollIntervalMs);
console.log(JSON.stringify({
  event: "pedro_v3_debounce_poller_started",
  debounceMs: runtime.debounceConfig.debounceMs,
  maxWaitMs: runtime.debounceConfig.maxWaitMs,
  pollIntervalMs: runtime.debounceConfig.pollIntervalMs,
}));

let followupTickRunning = false;
const runFollowupTick = () => {
  if (followupTickRunning) return;
  followupTickRunning = true;
  void runtime.processDueFollowups()
    .then((result) => {
      if (result.checked > 0 || result.failed > 0) console.log(JSON.stringify({ event: "pedro_v3_followup_tick", ...result }));
    })
    .catch((error) => console.error(JSON.stringify({ event: "pedro_v3_followup_tick_failed", reason: sanitizeTurnError(error instanceof Error ? error.message : String(error)) })))
    .finally(() => { followupTickRunning = false; });
};
const followupTimer = setInterval(runFollowupTick, 60_000);
runFollowupTick();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    stopPoller();
    clearInterval(followupTimer);
    server.close(() => process.exit(0));
  });
}
