// read-ports.ts — F2.5.2A
//
// Contratos READ-ONLY do lado de leitura (read-side) do Pedro v3. Tudo aqui é
// puro (tipos + interfaces), sem I/O, sem rede, sem dependência de Supabase/v2.
// O Kernel NÃO depende deste arquivo; quem o consome são os adapters de leitura.
//
// Invariantes (R1-8): tenant e agente SEMPRE explícitos; nunca email/instanceId/
// "primeiro agente ativo" como seletor. Credenciais (R1-6) nunca entram aqui —
// só `SecretRef` opaco (ver credential-provider.ts).

import type { Awaitable } from "./ports.ts";
import type { SecretRef } from "./credential-provider.ts";
import type { TenantFunnelPolicy } from "./tenant-policy-contract.ts";
import type { AgentResponseSchedule } from "./agent-response-schedule.ts";
import type { AgentProfileType } from "./agent-profile.ts";

// Seletor canônico e único de tenant+agente.
export type TenantAgentRef = {
  readonly tenantId: string;
  readonly agentId: string;
};

// Fonte efetiva do prompt (R1-10).
export type PromptSource = "raw_system_prompt" | "funnel_generated";

// Provedor de estoque selecionado por metadata. "none" = sem integração de estoque ativa.
export type StockProvider = "revendamais" | "bndv";
export type SelectedStockProvider = StockProvider | "none";

// Config imutável do tenant/agente para o runtime. NUNCA contém credencial:
// o estoque é referenciado por `stockSecretRef` (opaco) — o segredo é resolvido
// só no ponto de uso futuro (R1-6).
export type TenantRuntimeConfig = {
  readonly tenantId: string;
  readonly agentId: string;
  readonly agentName: string;
  /** Perfil operacional escolhido no portal; personalidade e condução continuam no prompt. */
  readonly agentType?: AgentProfileType;
  readonly companyName: string | null;          // "" normalizado vira null
  readonly instanceId: string | null;           // null no piloto (sem WhatsApp ligado)
  readonly promptText: string;
  readonly promptSource: PromptSource;
  readonly model: string | null;
  readonly temperature: number | null;
  readonly sdrGoal: string | null;
  readonly qualificationQuestions: readonly string[] | null;
  /** Políticas estruturadas do funil; contexto para a LLM, não roteamento da engine. */
  readonly tenantPolicies?: readonly TenantFunnelPolicy[];
  readonly sellsMotorcycles: boolean;
  readonly blockedCategories: readonly string[];
  readonly ragRestricted: boolean;
  /** Per-agent automatic-response window. CRM ingestion and manual handoff are independent. */
  readonly responseSchedule?: AgentResponseSchedule;
  readonly stockProvider: SelectedStockProvider; // revendamais vence bndv (R1 / decisão do dono)
  readonly stockSecretRef: SecretRef | null;     // opaco; null quando stockProvider="none"
  readonly versionStamp: string;                 // updatedAt do agente — futura invalidação de cache
};

// Erros tipados de configuração — fail-closed, sem correção silenciosa (R1-8).
// `detail` é SEMPRE seguro: nunca contém conteúdo de prompt nem material secreto.
export type ReadConfigErrorCode =
  | "MISSING_TENANT_OR_AGENT"
  | "AGENT_NOT_FOUND"            // inexistente OU de outro tenant (fail-closed, não distingue)
  | "AGENT_INACTIVE"
  | "SOURCE_OWNERSHIP_MISMATCH"  // 2ª camada: dados retornados não pertencem ao ref
  | "READ_SOURCE_FAILURE"        // exceção do gateway convertida fail-closed (sem vazar msg)
  | "PROMPT_SOURCE_EMPTY"        // a fonte de prompt selecionada está vazia
  | "INVALID_MODEL"
  | "INVALID_TEMPERATURE"
  | "PROVIDER_METADATA_INCONSISTENT";

export type ReadConfigError = {
  readonly code: ReadConfigErrorCode;
  readonly detail?: string;
};

export type ConfigResult =
  | { readonly ok: true; readonly config: TenantRuntimeConfig }
  | { readonly ok: false; readonly error: ReadConfigError };

// Porta de carregamento de config — implementada por adapters/read.
export interface TenantConfigSource {
  load(ref: TenantAgentRef): Awaitable<ConfigResult>;
}

// ============================================================================
// ADIÇÕES F2.5.2B - ESTOQUE, DETALHES E FOTOS
// ============================================================================
import type { VehicleType, VehicleFact, TransmissionPreference } from "./types.ts";

export type TypedVehicleType = {
  readonly value: VehicleType;
  readonly confidence: number;
  readonly provenance: "source_field" | "derived" | "unknown";
};

// Shape normalizado do veículo cru vindo dos feeds/APIs de estoque antes dos filtros.
export type NormalizedVehicle = {
  readonly source: string;
  readonly externalVehicleId: string;
  readonly markName: string | null;
  readonly modelName: string | null;
  readonly versionName: string | null;
  readonly year: number | null;
  readonly km: number | null;
  readonly saleValue: number | null;
  readonly color: string | null;
  readonly fuelName: string | null;
  readonly transmissionName: string | null;
  readonly pictureJs: string | null;
  readonly category: string | null;
  readonly bodyType: string | null;
};

export type StockSearchFilters = {
  readonly tipo?: VehicleType;
  readonly cambio?: TransmissionPreference;
  // Propulsão explicitamente solicitada pelo lead. Hoje só modelamos híbrido,
  // pois é o requisito recorrente cujo contrário (combustão comum) não pode ser
  // apresentado como compatível.
  readonly hibrido?: boolean;
  readonly precoMax?: number;
  readonly modelo?: string;
  readonly marca?: string;   // busca por fabricante (markName). Canonicalizado pelo engine (volks->volkswagen).
  readonly anos?: readonly number[];   // F2.28: anos RÍGIDOS (filtro duro; carro fora do ano nunca é match).
  readonly includeMotorcycles?: boolean;   // F2.29: default FALSE -> motos NUNCA entram em lista de carro (salvo lead pedir moto).
  readonly popular?: boolean;
  readonly broad?: boolean;
  readonly excludeKeys?: readonly string[];
};

export type StockSearchResult = {
  readonly items: readonly VehicleFact[];
  readonly filtersUsed: StockSearchFilters;
};

export interface StockSource {
  search(ref: TenantAgentRef, filters: StockSearchFilters): Awaitable<StockSearchResult>;
}

export interface VehicleDetailSource {
  getDetails(ref: TenantAgentRef, vehicleKey: string): Awaitable<VehicleFact | null>;
}

export type PhotoResolveResult = {
  readonly vehicleKey: string;
  readonly ambiguous: boolean;
  readonly photoIds: readonly string[];
  // ⭐CADEIA DE MÍDIA (2026-07-19): o SNAPSHOT resolvido (id + url) na MESMA leitura que produziu os ids.
  // É ele que viaja até o envio, para o dispatcher não precisar reler o feed AO VIVO e descartar as fotos na
  // menor deriva. Opcional só por compatibilidade com fontes/fakes antigos; o adapter real sempre preenche.
  readonly media?: readonly { readonly id: string; readonly url: string }[];
};

export interface VehiclePhotoSource {
  resolvePhotos(ref: TenantAgentRef, vehicleKey: string): Awaitable<PhotoResolveResult>;
  resolveUrls(ref: TenantAgentRef, vehicleKey: string, photoIds: readonly string[]): Awaitable<readonly string[]>;
}

// ============================================================================
// ADICOES F2.5.2C - CRM READ-ONLY E QUERY RUNNER
// ============================================================================
export type CrmLeadSummary = {
  readonly leadId: string;
  readonly name: string | null;
  readonly vehicleInterest?: string | null;
  readonly stage?: string | null;
  readonly createdAt?: string | null;
  readonly updatedAt?: string | null;
};

export interface CrmReadSource {
  readLead(ref: TenantAgentRef, leadId: string): Awaitable<CrmLeadSummary | null>;
}
