// v2-read-gateway.ts — F2.5.2A
//
// Porta de LEITURA do Pedro v2 com MÉTODOS ESPECÍFICOS (R1-8). NÃO é um gateway
// genérico: não aceita nome livre de tabela nem filtro arbitrário. Cada método
// recebe `TenantAgentRef` e a implementação valida tenant + propriedade do agente.
//
// As linhas retornadas falam a linguagem do v3 (tenantId, não user_id). `model` e
// `temperature` vêm como `unknown` de propósito: o banco é entrada NÃO confiável e
// a validação/narrowing é responsabilidade do TenantConfigSource (sem correção
// silenciosa). As linhas de integração de estoque NUNCA trazem credencial (R1-6):
// só id/provider/isActive/updatedAt.
//
// NESTA FATIA (A) só existe o CONTRATO + a implementação FAKE (adapters/read/fakes).
// O adapter Supabase real entra na F2.5.2B/C (gated, com rede), atrás desta mesma porta.

import type { Awaitable } from "../../domain/ports.ts";
import type { TenantAgentRef } from "../../domain/read-ports.ts";

// wa_ai_agents (campos read-only usados pela config). tenantId = user_id mapeado.
export type OwnedAgentRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly instanceId: string | null;
  readonly systemPrompt: string | null;
  readonly useFunnelConfig: boolean;
  readonly companyName: string | null;
  readonly model: unknown;          // validado no TenantConfigSource (string|null esperado)
  readonly temperature: unknown;    // validado no TenantConfigSource (number|null esperado)
  readonly sdrGoal: string | null;
  readonly qualificationQuestions: readonly string[] | null;
  readonly sellsMotorcycles: boolean;
  readonly blockedCategories: readonly string[];
  readonly ragRestricted: boolean;
  readonly isActive: boolean;
  readonly updatedAt: string;
};

// agent_funnel_config (somente o prompt gerado + carimbo). tenantId = user_id.
export type OwnedFunnelConfigRow = {
  readonly agentId: string;
  readonly tenantId: string;
  readonly generatedSystemPrompt: string | null;
  readonly tenantPolicies?: unknown;
  readonly updatedAt: string | null;
};

// platform_integrations — METADATA somente. SEM api_key_encrypted / feed_url / token.
// tenantId = user_id mapeado; é dado de PROPRIEDADE (não segredo), validado na 2ª camada.
export type StockIntegrationMetadataRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly isActive: boolean;
  readonly updatedAt: string | null;
};

// ai_crm_leads - resumo seguro. NUNCA selecionar cpf/birth_date nesta porta.
export type OwnedCrmLeadRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly leadName: string | null;
  readonly clientName: string | null;
  readonly vehicleInterest: string | null;
  readonly stage: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

// Erro tipado do gateway (ex.: chamada sem tenant/agente). Mensagem sem segredo.
export class V2ReadGatewayError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "V2ReadGatewayError";
  }
}

export interface V2ReadGateway {
  // Retorna o agente SOMENTE se existir E pertencer ao tenant; senão null (fail-closed).
  getOwnedAgent(ref: TenantAgentRef): Awaitable<OwnedAgentRow | null>;
  // Funnel config do agente, validando propriedade; null se ausente/não-pertence.
  getOwnedFunnelConfig(ref: TenantAgentRef): Awaitable<OwnedFunnelConfigRow | null>;
  // Integrações de estoque ATIVAS do tenant (metadata, sem credencial).
  listActiveStockIntegrationMetadata(ref: TenantAgentRef): Awaitable<StockIntegrationMetadataRow[]>;
  // CRM read-only seguro por tenant+agent+leadId; sem cpf/birth_date.
  getOwnedCrmLead(ref: TenantAgentRef, leadId: string): Awaitable<OwnedCrmLeadRow | null>;
}

// Guard compartilhado: nenhuma API permite consulta sem tenantId + agentId (R1-8).
export function assertTenantAgentRef(ref: TenantAgentRef | null | undefined): asserts ref is TenantAgentRef {
  if (!ref || typeof ref.tenantId !== "string" || ref.tenantId.trim() === "" ||
      typeof ref.agentId !== "string" || ref.agentId.trim() === "") {
    throw new V2ReadGatewayError(
      "v2_read_gateway_requires_tenant_and_agent",
      "tenantId e agentId são obrigatórios em toda leitura",
    );
  }
}
