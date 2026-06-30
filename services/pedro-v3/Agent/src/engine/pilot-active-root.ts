// pilot-active-root.ts — F2.6F
// Active pilot composition root for Pedro v3. It is still pilot-scoped and
// test-first: no global rollout, no fallback by email, no CRM/handoff dispatch.

import type { Clock, ConversationRoutingStore, Persistence } from "../domain/ports.ts";
import type { QueryLoopLimits } from "../domain/context.ts";
import { ingestPilotMessage } from "./pilot-ingest.ts";
import type { ClaimExtractor } from "../domain/decision.ts";
import type { Id } from "../domain/types.ts";
import type { NormalizedVehicle, TenantAgentRef, TenantConfigSource, TenantRuntimeConfig } from "../domain/read-ports.ts";
import type { StructuredConversationModel } from "../domain/conversation-model.ts";
import type { V2ReadDatabase, SecretDecryptor } from "../adapters/read/supabase-v2-read-adapter.ts";
import { V2DatabaseCredentialProvider, V2DatabaseReadGateway } from "../adapters/read/supabase-v2-read-adapter.ts";
import { V2TenantConfigSource } from "../adapters/read/tenant-config-source.ts";
import { ReadCache, type CacheOptions } from "../adapters/read/cache.ts";
import { SafeHttpClient } from "../adapters/read/http-client.ts";
import { V2StockLoader } from "../adapters/read/stock-loader.ts";
import { V2StockSource } from "../adapters/read/stock-source.ts";
import { V2VehiclePhotoSource } from "../adapters/read/photo-source.ts";
import { V2CrmReadSource } from "../adapters/read/crm-read-source.ts";
import { PromptBoundConversationAdapter } from "../adapters/llm/prompt-bound-conversation.ts";
import { createReadQueryRunner } from "./read-query-runner.ts";
import { ConversationTurnContextPreparer, StockTenantCatalogSource, type TenantCatalogSource } from "./turn-context-preparer.ts";
import { evaluatePedroV3PilotScope } from "../domain/pilot-scope.ts";
import type { OutboxRecord } from "../domain/effect-intent.ts";
import { runConversationTurn, type ConversationEngineResult } from "./conversation-engine.ts";
import { OutboxDispatcher } from "./outbox-dispatcher.ts";
import type { EffectGate } from "./effect-gate.ts";
import type { UazapiHttpTransport } from "../adapters/effects/uazapi-whatsapp-sender.ts";
import { createPilotWhatsAppDispatcher } from "../adapters/effects/pilot-whatsapp-runtime.ts";
import { V2WhatsAppInstanceCredentialProvider, V2WhatsAppInstanceSource } from "../adapters/effects/v2-whatsapp-instance-source.ts";

export type PilotActiveConfig = {
  readonly mode: "active";
  readonly tenantId: string;
  readonly agentId: string;
  readonly leadId?: string | null;
};

export type PilotActiveDeps = {
  readonly db: V2ReadDatabase;
  readonly decryptor: SecretDecryptor;
  readonly clock: Clock;
  readonly model?: StructuredConversationModel;
  readonly modelFactory?: (config: TenantRuntimeConfig) => StructuredConversationModel;
  readonly httpClient?: SafeHttpClient;
  readonly cacheOptions?: CacheOptions;
  readonly catalogSource?: TenantCatalogSource;
  readonly independentClaimExtractor?: ClaimExtractor;
  readonly whatsappTransport: UazapiHttpTransport;
  readonly allowedUazapiHosts: readonly string[];
};

export type PilotActiveTurnInput = {
  readonly persistence: Persistence & ConversationRoutingStore;
  readonly conversationId: Id;
  readonly to: string;
  readonly workerId: string;
  readonly turnId: Id;
  readonly eventId: Id;
  readonly messageText: string;
  readonly receivedAt?: string;
  readonly limits: QueryLoopLimits;
  readonly maxValidationAttempts: number;
};

// F2.7.6: processamento de UMA conversa (apos a janela), disparado pelo poller.
// NAO ingere (as mensagens ja estao no v3_inbox); so claim+decide+dispatch do bloco.
export type PilotActiveProcessInput = {
  readonly persistence: Persistence;
  readonly conversationId: Id;
  readonly to: string;
  readonly workerId: string;
  readonly turnId: Id;
  readonly limits: QueryLoopLimits;
  readonly maxValidationAttempts: number;
};

export type PilotActiveProcessResult = {
  readonly status: "committed" | "commit_failed" | "no_op";
  readonly engine: ConversationEngineResult;
  readonly outboxBeforeDispatch: readonly OutboxRecord[];
  readonly outboxAfterDispatch: readonly OutboxRecord[];
  readonly dispatched: number;
};

export type PilotActiveTurnResult =
  | { readonly status: "duplicate"; readonly inserted: false; readonly turnId: Id; readonly dispatched: 0 }
  // F2.7.6: ingestao aceita, processamento adiado p/ o poller (debounce). Bridge: ingested=true + status!=commit_failed -> "accepted".
  | { readonly status: "accepted"; readonly inserted: true; readonly dispatched: 0 }
  | (PilotActiveProcessResult & { readonly inserted: true });

export class PilotActiveRootError extends Error {
  constructor(public readonly code:
    | "PILOT_ACTIVE_SCOPE_DENIED"
    | "MODEL_NOT_CONFIGURED"
    | "TENANT_CONFIG_INVALID"
    | "AGENT_WITHOUT_INSTANCE"
    | "INSTANCE_NOT_FOUND"
    | "INSTANCE_PROVIDER_UNSUPPORTED"
    | "INSTANCE_OWNERSHIP_MISMATCH") {
    super(code);
    this.name = "PilotActiveRootError";
  }
}

class StaticTenantConfigSource implements TenantConfigSource {
  constructor(private readonly config: TenantRuntimeConfig) {}
  async load(ref: TenantAgentRef) {
    if (ref.tenantId !== this.config.tenantId || ref.agentId !== this.config.agentId) {
      return { ok: false as const, error: { code: "AGENT_NOT_FOUND" as const } };
    }
    return { ok: true as const, config: this.config };
  }
}

class ConversationOnlyActiveGate implements EffectGate {
  constructor(private readonly conversationId: string) {}
  isActiveMode(conversationId: string): boolean {
    return conversationId === this.conversationId;
  }
}

export class PilotActiveRoot {
  private constructor(
    readonly ref: TenantAgentRef,
    private readonly leadId: string | null,
    private readonly runtimeConfig: TenantRuntimeConfig,
    private readonly clock: Clock,
    private readonly llm: PromptBoundConversationAdapter,
    private readonly runQuery: ReturnType<typeof createReadQueryRunner>,
    private readonly contextPreparer: ConversationTurnContextPreparer,
    private readonly configSource: TenantConfigSource,
    private readonly instanceSource: V2WhatsAppInstanceSource,
    private readonly credentialProvider: V2WhatsAppInstanceCredentialProvider,
    private readonly whatsappTransport: UazapiHttpTransport,
    private readonly photoSource: V2VehiclePhotoSource,
    private readonly allowedUazapiHosts: readonly string[],
  ) {}

  get tenantConfig(): TenantRuntimeConfig {
    return this.runtimeConfig;
  }

  static async create(config: PilotActiveConfig, deps: PilotActiveDeps): Promise<PilotActiveRoot> {
    const scope = evaluatePedroV3PilotScope({ tenantId: config.tenantId, agentId: config.agentId, mode: config.mode });
    if (!scope.enabled || scope.mode !== "active") throw new PilotActiveRootError("PILOT_ACTIVE_SCOPE_DENIED");

    const ref: TenantAgentRef = { tenantId: config.tenantId, agentId: config.agentId };
    const gateway = new V2DatabaseReadGateway(deps.db);
    const configSource = new V2TenantConfigSource(gateway);
    const loaded = await configSource.load(ref);
    if (!loaded.ok) throw new PilotActiveRootError("TENANT_CONFIG_INVALID");
    const runtimeConfig = loaded.config;
    if (!runtimeConfig.instanceId) throw new PilotActiveRootError("AGENT_WITHOUT_INSTANCE");

    const model = deps.modelFactory?.(runtimeConfig) ?? deps.model;
    if (!model) throw new PilotActiveRootError("MODEL_NOT_CONFIGURED");

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

    const instanceSource = new V2WhatsAppInstanceSource(deps.db);
    const instance = await instanceSource.loadOwnedInstance(ref, runtimeConfig.instanceId);
    if (!instance) throw new PilotActiveRootError("INSTANCE_NOT_FOUND");
    if (instance.provider !== "uazapi") throw new PilotActiveRootError("INSTANCE_PROVIDER_UNSUPPORTED");

    const llm = new PromptBoundConversationAdapter(runtimeConfig, model);
    const catalogSource = deps.catalogSource ?? new StockTenantCatalogSource(stockSource);
    const contextPreparer = new ConversationTurnContextPreparer(ref, llm, catalogSource, deps.independentClaimExtractor);

    return new PilotActiveRoot(
      ref,
      config.leadId ?? null,
      runtimeConfig,
      deps.clock,
      llm,
      runQuery,
      contextPreparer,
      new StaticTenantConfigSource(runtimeConfig),
      instanceSource,
      new V2WhatsAppInstanceCredentialProvider(deps.db, deps.decryptor),
      deps.whatsappTransport,
      photoSource,
      deps.allowedUazapiHosts,
    );
  }

  // F2.7.6: ingestao (dedupe + roteamento) e processamento agora sao SEPARADOS.
  // runTurn (sincrono, usado em teste e como fallback) faz os dois; em PRODUCAO o
  // /v1/pilot/turn so ingere e o poller chama processConversation. Comportamento identico.
  async runTurn(input: PilotActiveTurnInput): Promise<PilotActiveTurnResult> {
    const ingest = await ingestPilotMessage(input.persistence, this.clock, {
      eventId: input.eventId,
      conversationId: input.conversationId,
      agentId: this.ref.agentId,
      leadId: this.leadId,
      toAddr: input.to,
      messageText: input.messageText,
      receivedAt: input.receivedAt,
    });
    if (ingest.decision === "duplicate") {
      return { status: "duplicate", inserted: false, turnId: input.turnId, dispatched: 0 };
    }
    const processed = await this.processConversation({
      persistence: input.persistence,
      conversationId: input.conversationId,
      to: input.to,
      workerId: input.workerId,
      turnId: input.turnId,
      limits: input.limits,
      maxValidationAttempts: input.maxValidationAttempts,
    });
    return { ...processed, inserted: true };
  }

  // F2.7.6: claim do BLOCO pendente (a janela de debounce ja passou) -> decide -> dispatch.
  // As mensagens ja foram ingeridas; claimBurst(cutoff=now) agrega TODAS as pendentes num turno.
  async processConversation(input: PilotActiveProcessInput): Promise<PilotActiveProcessResult> {
    const engine = await runConversationTurn({
      persistence: input.persistence,
      clock: this.clock,
      llm: this.llm,
      runQuery: this.runQuery,
      contextPreparer: this.contextPreparer,
      conversationId: input.conversationId,
      tenantId: this.ref.tenantId,
      agentId: this.ref.agentId,
      leadId: this.leadId,
      workerId: input.workerId,
      turnId: input.turnId,
      leaseTtlMs: 60_000,
      limits: input.limits,
      maxValidationAttempts: input.maxValidationAttempts,
      providerCapability: { send_message: "none", send_media: "none" },
    });

    const outboxBeforeDispatch = await input.persistence.listOutbox(input.conversationId);
    let dispatched = 0;
    if (engine.status === "committed") {
      const dispatcherRuntime = await createPilotWhatsAppDispatcher({
        ref: this.ref,
        conversationId: input.conversationId,
        to: input.to,
        allowedUazapiHosts: this.allowedUazapiHosts,
      }, {
        configSource: this.configSource,
        instanceSource: this.instanceSource,
        credentialProvider: this.credentialProvider,
        httpTransport: this.whatsappTransport,
        photoSource: this.photoSource,
        clock: this.clock,
      });
      if (!dispatcherRuntime.ok) {
        throw new PilotActiveRootError(dispatcherRuntime.error);
      }
      const gate = new ConversationOnlyActiveGate(input.conversationId);
      const dispatcher = new OutboxDispatcher(
        input.persistence,
        this.clock,
        dispatcherRuntime.dispatcher,
        gate,
        `${input.workerId}:active-dispatcher`,
      );
      dispatched = await dispatcher.dispatchConversation(input.conversationId);
    }

    const outboxAfterDispatch = await input.persistence.listOutbox(input.conversationId);
    return {
      status: engine.status,
      engine,
      outboxBeforeDispatch,
      outboxAfterDispatch,
      dispatched,
    };
  }
}
