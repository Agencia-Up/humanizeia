// fake-v2-read-gateway.ts — F2.5.2A / A.1
//
// Implementação FAKE e DETERMINÍSTICA do V2ReadGateway, sem rede e sem Supabase.
// O fake HONESTO valida propriedade (tenant) como o real fará. Guarda os segredos
// de integração numa estrutura SEPARADA (`integrationSecrets`) que NUNCA é retornada
// por `listActiveStockIntegrationMetadata` — assim os testes provam que carregar
// configuração não vaza credencial mesmo quando o fake "conhece" o segredo.
//
// Para provar a 2ª camada de propriedade do TenantConfigSource (A.1-#1), os testes
// usam gateways "mentirosos" ad-hoc (que devolvem dados de outro tenant); este fake
// honesto não os simula — ele filtra corretamente.

import {
  assertTenantAgentRef,
  type OwnedAgentRow,
  type OwnedFunnelConfigRow,
  type OwnedCrmLeadRow,
  type StockIntegrationMetadataRow,
  type V2ReadGateway,
} from "../v2-read-gateway.ts";
import type { TenantAgentRef } from "../../../domain/read-ports.ts";

export type IntegrationSecret = { readonly feed_url: string; readonly api_token: string };

export type FakeV2Seed = {
  readonly agents: readonly OwnedAgentRow[];
  readonly funnels: readonly OwnedFunnelConfigRow[];
  // metadata por tenant (já SEM segredo; cada linha carrega seu próprio tenantId)
  readonly integrationsByTenant: Readonly<Record<string, readonly StockIntegrationMetadataRow[]>>;
  // segredos por integrationId — NUNCA expostos pelo gateway (só o CredentialProvider usaria)
  readonly integrationSecrets?: Readonly<Record<string, IntegrationSecret>>;
  readonly crmLeads?: readonly OwnedCrmLeadRow[];
};

export class FakeV2ReadGateway implements V2ReadGateway {
  constructor(private readonly seed: FakeV2Seed) {}

  // Exposto só para asserção em teste — confirma que o segredo existe no fake mas
  // jamais sai pelo gateway. Não é parte do contrato V2ReadGateway.
  secretCanaryValues(): string[] {
    const out: string[] = [];
    for (const s of Object.values(this.seed.integrationSecrets ?? {})) {
      out.push(s.feed_url, s.api_token);
    }
    return out;
  }

  async getOwnedAgent(ref: TenantAgentRef): Promise<OwnedAgentRow | null> {
    assertTenantAgentRef(ref);
    const found = this.seed.agents.find((a) => a.id === ref.agentId && a.tenantId === ref.tenantId);
    return found ?? null;
  }

  async getOwnedFunnelConfig(ref: TenantAgentRef): Promise<OwnedFunnelConfigRow | null> {
    assertTenantAgentRef(ref);
    const found = this.seed.funnels.find((f) => f.agentId === ref.agentId && f.tenantId === ref.tenantId);
    return found ?? null;
  }


  async getOwnedCrmLead(ref: TenantAgentRef, leadId: string): Promise<OwnedCrmLeadRow | null> {
    assertTenantAgentRef(ref);
    if (typeof leadId !== "string" || leadId.trim() === "") return null;
    const found = (this.seed.crmLeads ?? []).find((lead) =>
      lead.id === leadId && lead.tenantId === ref.tenantId && lead.agentId === ref.agentId
    );
    return found ?? null;
  }
  async listActiveStockIntegrationMetadata(ref: TenantAgentRef): Promise<StockIntegrationMetadataRow[]> {
    assertTenantAgentRef(ref);
    const rows = this.seed.integrationsByTenant[ref.tenantId] ?? [];
    // retorna só ATIVAS e SOMENTE metadata (cópia rasa; nunca segredo)
    return rows
      .filter((r) => r.isActive)
      .map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        provider: r.provider,
        isActive: r.isActive,
        updatedAt: r.updatedAt,
      }));
  }
}
