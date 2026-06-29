// Canary shadow composition root. It binds the tenant prompt to the structured
// conversation model and prepares interpretation/catalog/claims inside the lease.
// No external dispatcher is registered and the harness remains EffectGate OFF.

import type { Clock, Persistence } from "../domain/ports.ts";
import type { QueryLoopLimits } from "../domain/context.ts";
import type { ClaimExtractor } from "../domain/decision.ts";
import type { Id } from "../domain/types.ts";
import type { NormalizedVehicle, TenantAgentRef, TenantRuntimeConfig } from "../domain/read-ports.ts";
import type { StructuredConversationModel } from "../domain/conversation-model.ts";
import type { QueryRunner } from "./decision-engine.ts";
import type { EffectGate } from "./effect-gate.ts";
import { InMemoryEffectGate } from "./effect-gate.ts";
import {
  V2DatabaseCredentialProvider,
  V2DatabaseReadGateway,
  type SecretDecryptor,
  type V2ReadDatabase,
} from "../adapters/read/supabase-v2-read-adapter.ts";
import { V2TenantConfigSource } from "../adapters/read/tenant-config-source.ts";
import { ReadCache, type CacheOptions } from "../adapters/read/cache.ts";
import { SafeHttpClient } from "../adapters/read/http-client.ts";
import { V2StockLoader } from "../adapters/read/stock-loader.ts";
import { V2StockSource } from "../adapters/read/stock-source.ts";
import { V2VehiclePhotoSource } from "../adapters/read/photo-source.ts";
import { V2CrmReadSource } from "../adapters/read/crm-read-source.ts";
import { PromptBoundConversationAdapter } from "../adapters/llm/prompt-bound-conversation.ts";
import { createReadQueryRunner } from "./read-query-runner.ts";
import {
  ConversationTurnContextPreparer,
  StockTenantCatalogSource,
  type TenantCatalogSource,
} from "./turn-context-preparer.ts";
import {
  runShadowHarnessTurn,
  type ShadowExpected,
  type ShadowHarnessResult,
} from "./shadow-harness.ts";

export type CanaryShadowConfig = {
  readonly mode: "shadow";
  readonly tenantId: string;
  readonly agentId: string;
  readonly leadId?: string | null;
};

export type CanaryReadDeps = {
  readonly db: V2ReadDatabase;
  readonly decryptor: SecretDecryptor;
  readonly clock: Clock;
  readonly model?: StructuredConversationModel;
  readonly modelFactory?: (config: TenantRuntimeConfig) => StructuredConversationModel;
  readonly httpClient?: SafeHttpClient;
  readonly cacheOptions?: CacheOptions;
  readonly effectGate?: EffectGate;
  readonly catalogSource?: TenantCatalogSource;
  readonly independentClaimExtractor?: ClaimExtractor;
};

export type CanaryTurnInput = {
  readonly persistence: Persistence;
  readonly clock: Clock;
  readonly conversationId: Id;
  readonly workerId: string;
  readonly turnId: Id;
  readonly eventId: Id;
  readonly messageText: string;
  readonly receivedAt?: string;
  readonly limits: QueryLoopLimits;
  readonly maxValidationAttempts: number;
  readonly expected?: ShadowExpected;
};

export class CanaryConfigError extends Error {
  constructor(public readonly code: string) {
    super(`CANARY_CONFIG_INVALID:${code}`);
    this.name = "CanaryConfigError";
  }
}

export function assertCanaryGateShadow(gate: EffectGate, scopeId: string): void {
  if (gate.isActiveMode(scopeId)) throw new Error("CANARY_GATE_MUST_BE_SHADOW");
}

export class CanaryShadowRoot {
  readonly promptBoundToLlm = true as const;

  private constructor(
    readonly ref: TenantAgentRef,
    readonly runQuery: QueryRunner,
    private readonly leadId: string | null,
    private readonly runtimeConfig: TenantRuntimeConfig,
    private readonly llm: PromptBoundConversationAdapter,
    private readonly contextPreparer: ConversationTurnContextPreparer,
    private readonly effectGate: EffectGate,
  ) {}

  get tenantConfig(): TenantRuntimeConfig {
    return this.runtimeConfig;
  }

  get authoritativePromptText(): string {
    return this.runtimeConfig.promptText;
  }

  static async create(config: CanaryShadowConfig, deps: CanaryReadDeps): Promise<CanaryShadowRoot> {
    if (config?.mode !== "shadow") throw new Error("CANARY_REQUIRES_SHADOW_MODE");
    if (
      typeof config.tenantId !== "string" || config.tenantId.trim() === "" ||
      typeof config.agentId !== "string" || config.agentId.trim() === ""
    ) {
      throw new Error("CANARY_REQUIRES_EXPLICIT_TENANT_AGENT");
    }

    const ref: TenantAgentRef = { tenantId: config.tenantId, agentId: config.agentId };
    const effectGate = deps.effectGate ?? new InMemoryEffectGate();
    assertCanaryGateShadow(effectGate, `${ref.tenantId}:${ref.agentId}`);

    const gateway = new V2DatabaseReadGateway(deps.db);
    const loaded = await new V2TenantConfigSource(gateway).load(ref);
    if (!loaded.ok) throw new CanaryConfigError(loaded.error.code);
    const runtimeConfig = loaded.config;
    const model = deps.modelFactory?.(runtimeConfig) ?? deps.model;
    if (!model) throw new CanaryConfigError("MODEL_NOT_CONFIGURED");

    const credentialProvider = new V2DatabaseCredentialProvider(deps.db, deps.decryptor);
    const cache = new ReadCache<NormalizedVehicle[]>(
      deps.clock,
      deps.cacheOptions ?? { ttlMs: 60_000, maxItems: 8, enabled: true },
    );
    const httpClient = deps.httpClient ?? new SafeHttpClient();
    const loader = new V2StockLoader(gateway, credentialProvider, cache, httpClient);
    const stockSource = new V2StockSource(loader);
    const photoSource = new V2VehiclePhotoSource(loader);
    const crmSource = new V2CrmReadSource(gateway);
    const runQuery = createReadQueryRunner(ref, {
      stock: stockSource,
      vehicleDetails: stockSource,
      vehiclePhotos: photoSource,
      crm: crmSource,
    });

    const llm = new PromptBoundConversationAdapter(runtimeConfig, model);
    const catalogSource = deps.catalogSource ?? new StockTenantCatalogSource(stockSource);
    const contextPreparer = new ConversationTurnContextPreparer(ref, llm, catalogSource, deps.independentClaimExtractor);

    return new CanaryShadowRoot(
      ref,
      runQuery,
      config.leadId ?? null,
      runtimeConfig,
      llm,
      contextPreparer,
      effectGate,
    );
  }

  async runTurn(input: CanaryTurnInput): Promise<ShadowHarnessResult> {
    // Recheck the shared gate on every turn to avoid a create/run TOCTOU gap.
    assertCanaryGateShadow(this.effectGate, `${this.ref.tenantId}:${this.ref.agentId}`);
    assertCanaryGateShadow(this.effectGate, input.conversationId);

    const result = await runShadowHarnessTurn({
      persistence: input.persistence,
      clock: input.clock,
      llm: this.llm,
      runQuery: this.runQuery,
      contextPreparer: this.contextPreparer,
      conversationId: input.conversationId,
      tenantId: this.ref.tenantId,
      agentId: this.ref.agentId,
      leadId: this.leadId,
      workerId: input.workerId,
      turnId: input.turnId,
      eventId: input.eventId,
      messageText: input.messageText,
      receivedAt: input.receivedAt,
      limits: input.limits,
      maxValidationAttempts: input.maxValidationAttempts,
      expected: input.expected,
    });

    if (result.dispatchAttempts !== 0) throw new Error("CANARY_SHADOW_DISPATCH_DETECTED");
    return result;
  }
}
