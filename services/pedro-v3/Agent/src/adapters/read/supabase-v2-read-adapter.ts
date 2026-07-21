import type {
  CredentialProvider,
  ResolveSecretResult,
  SecretRef,
} from "../../domain/credential-provider.ts";
import type { TenantAgentRef } from "../../domain/read-ports.ts";
import {
  assertTenantAgentRef,
  type OwnedAgentRow,
  type OwnedCrmLeadRow,
  type OwnedFunnelConfigRow,
  type StockIntegrationMetadataRow,
  type V2ReadGateway,
} from "./v2-read-gateway.ts";

export type V2TableName =
  | "wa_ai_agents"
  | "agent_funnel_config"
  | "platform_integrations"
  | "ai_crm_leads"
  | "wa_instances";

export type V2ColumnName =
  | "id"
  | "user_id"
  | "agent_id"
  | "instance_id"
  | "name"
  | "system_prompt"
  | "use_funnel_config"
  | "company_name"
  | "model"
  | "temperature"
  | "sdr_goal"
  | "qualification_questions"
  | "sells_motorcycles"
  | "blocked_categories"
  | "rag_restricted"
  | "is_active"
  | "updated_at"
  | "generated_system_prompt"
  | "tenant_policies"
  | "platform"
  | "provider"
  | "api_key_encrypted"
  | "lead_name"
  | "client_name"
  | "vehicle_interest"
  | "stage"
  | "created_at"
  | "instance_name"
  | "api_url"
  | "api_key";

export type V2WhereEquals = Readonly<Record<string, string | boolean>>;

export interface V2ReadDatabase {
  selectOne(table: V2TableName, columns: readonly V2ColumnName[], where: V2WhereEquals): Promise<Record<string, unknown> | null>;
  selectMany(table: V2TableName, columns: readonly V2ColumnName[], where: V2WhereEquals): Promise<readonly Record<string, unknown>[]>;
}

export interface SecretDecryptor {
  decryptApiKey(ciphertext: string, context: { readonly tenantId: string; readonly integrationId: string; readonly provider: string }): Promise<string | null>;
}

const AGENT_COLUMNS = Object.freeze([
  "id",
  "user_id",
  "instance_id",
  "name",
  "system_prompt",
  "use_funnel_config",
  "company_name",
  "model",
  "temperature",
  "sdr_goal",
  "qualification_questions",
  "sells_motorcycles",
  "blocked_categories",
  "rag_restricted",
  "is_active",
  "updated_at",
] satisfies readonly V2ColumnName[]);

const FUNNEL_COLUMNS = Object.freeze([
  "agent_id",
  "user_id",
  "generated_system_prompt",
  "tenant_policies",
  "updated_at",
] satisfies readonly V2ColumnName[]);

const STOCK_METADATA_COLUMNS = Object.freeze([
  "id",
  "user_id",
  "platform",
  "is_active",
  "updated_at",
] satisfies readonly V2ColumnName[]);

const CRM_COLUMNS = Object.freeze([
  "id",
  "user_id",
  "agent_id",
  "lead_name",
  "client_name",
  "vehicle_interest",
  "stage",
  "created_at",
  "updated_at",
] satisfies readonly V2ColumnName[]);

const SECRET_COLUMNS = Object.freeze([
  "id",
  "user_id",
  "platform",
  "api_key_encrypted",
  "is_active",
] satisfies readonly V2ColumnName[]);

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapAgentRow(row: Record<string, unknown>): OwnedAgentRow {
  return {
    id: asString(row.id) ?? "",
    tenantId: asString(row.user_id) ?? "",
    name: asString(row.name) ?? "",
    instanceId: asString(row.instance_id),
    systemPrompt: asString(row.system_prompt),
    useFunnelConfig: asBoolean(row.use_funnel_config),
    companyName: asString(row.company_name),
    model: row.model ?? null,
    temperature: row.temperature ?? null,
    sdrGoal: asString(row.sdr_goal),
    qualificationQuestions: Array.isArray(row.qualification_questions) ? asStringArray(row.qualification_questions) : null,
    sellsMotorcycles: asBoolean(row.sells_motorcycles),
    blockedCategories: asStringArray(row.blocked_categories),
    ragRestricted: asBoolean(row.rag_restricted),
    isActive: asBoolean(row.is_active),
    updatedAt: asString(row.updated_at) ?? "",
  };
}

function mapFunnelRow(row: Record<string, unknown>): OwnedFunnelConfigRow {
  return {
    agentId: asString(row.agent_id) ?? "",
    tenantId: asString(row.user_id) ?? "",
    generatedSystemPrompt: asString(row.generated_system_prompt),
    tenantPolicies: row.tenant_policies ?? [],
    updatedAt: asString(row.updated_at),
  };
}

function mapIntegrationRow(row: Record<string, unknown>): StockIntegrationMetadataRow {
  return {
    id: asString(row.id) ?? "",
    tenantId: asString(row.user_id) ?? "",
    provider: asString(row.platform) ?? "",
    isActive: asBoolean(row.is_active),
    updatedAt: asString(row.updated_at),
  };
}

function mapCrmRow(row: Record<string, unknown>): OwnedCrmLeadRow {
  return {
    id: asString(row.id) ?? "",
    tenantId: asString(row.user_id) ?? "",
    agentId: asString(row.agent_id) ?? "",
    leadName: asString(row.lead_name),
    clientName: asString(row.client_name),
    vehicleInterest: asString(row.vehicle_interest),
    stage: asString(row.stage),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function isStockProvider(value: string): value is "revendamais" | "bndv" {
  return value === "revendamais" || value === "bndv";
}

export class V2DatabaseReadGateway implements V2ReadGateway {
  constructor(private readonly db: V2ReadDatabase) {}

  async getOwnedAgent(ref: TenantAgentRef): Promise<OwnedAgentRow | null> {
    assertTenantAgentRef(ref);
    const row = await this.db.selectOne("wa_ai_agents", AGENT_COLUMNS, {
      id: ref.agentId,
      user_id: ref.tenantId,
    });
    return row ? mapAgentRow(row) : null;
  }

  async getOwnedFunnelConfig(ref: TenantAgentRef): Promise<OwnedFunnelConfigRow | null> {
    assertTenantAgentRef(ref);
    const row = await this.db.selectOne("agent_funnel_config", FUNNEL_COLUMNS, {
      agent_id: ref.agentId,
      user_id: ref.tenantId,
    });
    return row ? mapFunnelRow(row) : null;
  }

  async listActiveStockIntegrationMetadata(ref: TenantAgentRef): Promise<StockIntegrationMetadataRow[]> {
    assertTenantAgentRef(ref);
    const rows = await this.db.selectMany("platform_integrations", STOCK_METADATA_COLUMNS, {
      user_id: ref.tenantId,
      is_active: true,
    });
    return rows.map(mapIntegrationRow);
  }

  async getOwnedCrmLead(ref: TenantAgentRef, leadId: string): Promise<OwnedCrmLeadRow | null> {
    assertTenantAgentRef(ref);
    if (typeof leadId !== "string" || leadId.trim() === "") return null;
    const row = await this.db.selectOne("ai_crm_leads", CRM_COLUMNS, {
      id: leadId,
      user_id: ref.tenantId,
      agent_id: ref.agentId,
    });
    return row ? mapCrmRow(row) : null;
  }
}

export class V2DatabaseCredentialProvider implements CredentialProvider {
  constructor(
    private readonly db: V2ReadDatabase,
    private readonly decryptor: SecretDecryptor,
  ) {}

  async resolve(ref: SecretRef): Promise<ResolveSecretResult> {
    const row = await this.db.selectOne("platform_integrations", SECRET_COLUMNS, {
      id: ref.integrationId,
      user_id: ref.tenantId,
      is_active: true,
    });

    if (!row) return { ok: false, error: "SECRET_NOT_FOUND" };

    const tenantId = asString(row.user_id);
    if (tenantId !== ref.tenantId) return { ok: false, error: "SECRET_OWNERSHIP_MISMATCH" };

    const provider = asString(row.platform)?.toLowerCase() ?? "";
    if (!isStockProvider(provider) || provider !== ref.provider) {
      return { ok: false, error: "SECRET_PROVIDER_MISMATCH" };
    }

    const encrypted = asString(row.api_key_encrypted);
    if (!encrypted) return { ok: false, error: "SECRET_NOT_FOUND" };

    const material = await this.decryptor.decryptApiKey(encrypted, {
      tenantId: ref.tenantId,
      integrationId: ref.integrationId,
      provider,
    });

    if (!material) return { ok: false, error: "SECRET_NOT_FOUND" };
    return { ok: true, secret: { purpose: ref.purpose, material } };
  }
}
