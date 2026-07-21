// tenant-config-source.ts — F2.5.2A / A.1
//
// Carrega a TenantRuntimeConfig a partir do V2ReadGateway, com validação tipada
// fail-closed e SEM correção silenciosa. NÃO acessa credenciais: constrói apenas um
// `SecretRef` opaco para o estoque e NUNCA chama CredentialProvider.
//
// A.1 — endurecimento:
//  - 2ª camada de propriedade: revalida tenantId/agentId nos dados retornados;
//  - exceções do gateway → READ_SOURCE_FAILURE (nunca propaga error.message cru);
//  - metadata de estoque validada estruturalmente (id/tenant/provider/timestamp/dup);
//  - versionStamp composto (prompt do portal + funil/políticas + provider/integração);
//  - config imutável de verdade (arrays clonados + Object.freeze recursivo).

import type {
  ConfigResult,
  ReadConfigError,
  ReadConfigErrorCode,
  SelectedStockProvider,
  StockProvider,
  TenantAgentRef,
  TenantConfigSource,
  TenantRuntimeConfig,
} from "../../domain/read-ports.ts";
import { makeSecretRef } from "../../domain/credential-provider.ts";
import type { SecretRef } from "../../domain/credential-provider.ts";
import { normalizeTenantPolicies } from "../../../../../../src/lib/pedroFunnelPolicyContract.ts";
import {
  assertTenantAgentRef,
  type OwnedAgentRow,
  type StockIntegrationMetadataRow,
  type V2ReadGateway,
} from "./v2-read-gateway.ts";

function fail(code: ReadConfigErrorCode, detail?: string): ConfigResult {
  const error: ReadConfigError = detail === undefined ? { code } : { code, detail };
  return { ok: false, error };
}

function isCompleteRef(ref: TenantAgentRef | null | undefined): ref is TenantAgentRef {
  return !!ref &&
    typeof ref.tenantId === "string" && ref.tenantId.trim() !== "" &&
    typeof ref.agentId === "string" && ref.agentId.trim() !== "";
}

// Envolve UMA chamada do gateway; qualquer exceção vira falha fail-closed SEM
// nunca ler/propagar error.message (que poderia conter segredo/prompt).
async function tryGateway<T>(fn: () => T | Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() };
  } catch {
    return { ok: false };
  }
}

function normalizeCompany(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// model: null permitido (não especificado); string não-vazia ok; resto inválido.
function validateModel(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string" || value.trim() === "") return { ok: false };
  return { ok: true, value };
}

// temperature: null permitido; número finito em [0,2] ok; resto inválido.
function validateTemperature(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) return { ok: false };
  return { ok: true, value };
}

function isValidTimestampOrNull(value: unknown): boolean {
  if (value === null) return true;
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

type StockSelection = {
  provider: SelectedStockProvider;
  secretRef: SecretRef | null;
  integrationId: string | null;
  integrationUpdatedAt: string | null;
};

// Seleciona o provider de estoque por metadata (RevendaMais > BNDV), validando
// estruturalmente cada linha ATIVA. NÃO toca credenciais. Sem fallback silencioso.
function selectStock(
  ref: TenantAgentRef,
  rows: StockIntegrationMetadataRow[],
):
  | { ok: true; selection: StockSelection }
  | { ok: false; code: "PROVIDER_METADATA_INCONSISTENT" | "SOURCE_OWNERSHIP_MISMATCH"; detail: string } {
  const active = rows.filter((r) => r.isActive);
  const seen = new Set<string>();
  for (const r of active) {
    if (r.tenantId !== ref.tenantId) {
      return { ok: false, code: "SOURCE_OWNERSHIP_MISMATCH", detail: "integração não pertence ao tenant do ref" };
    }
    if (typeof r.id !== "string" || r.id.trim() === "") {
      return { ok: false, code: "PROVIDER_METADATA_INCONSISTENT", detail: "id de integração vazio" };
    }
    const p = typeof r.provider === "string" ? r.provider.toLowerCase() : "";
    if (p !== "revendamais" && p !== "bndv") {
      return { ok: false, code: "PROVIDER_METADATA_INCONSISTENT", detail: "provider de estoque desconhecido" };
    }
    if (!isValidTimestampOrNull(r.updatedAt)) {
      return { ok: false, code: "PROVIDER_METADATA_INCONSISTENT", detail: "timestamp de integração inválido" };
    }
    if (seen.has(p)) {
      return { ok: false, code: "PROVIDER_METADATA_INCONSISTENT", detail: "provider de estoque duplicado" };
    }
    seen.add(p);
  }
  const revenda = active.find((r) => r.provider.toLowerCase() === "revendamais");
  const bndv = active.find((r) => r.provider.toLowerCase() === "bndv");
  const chosen = revenda ?? bndv ?? null; // precedência RevendaMais; sem fallback silencioso
  if (!chosen) {
    return { ok: true, selection: { provider: "none", secretRef: null, integrationId: null, integrationUpdatedAt: null } };
  }
  const provider = chosen.provider.toLowerCase() as StockProvider;
  const secretRef = makeSecretRef({ tenantId: ref.tenantId, integrationId: chosen.id, provider, purpose: "stock_feed" });
  return { ok: true, selection: { provider, secretRef, integrationId: chosen.id, integrationUpdatedAt: chosen.updatedAt } };
}

export class V2TenantConfigSource implements TenantConfigSource {
  constructor(private readonly gateway: V2ReadGateway) {}

  async load(ref: TenantAgentRef): Promise<ConfigResult> {
    if (!isCompleteRef(ref)) return fail("MISSING_TENANT_OR_AGENT");

    const agentCall = await tryGateway(() => this.gateway.getOwnedAgent(ref));
    if (!agentCall.ok) return fail("READ_SOURCE_FAILURE", "falha ao ler o agente");
    const agent: OwnedAgentRow | null = agentCall.value;
    if (!agent) return fail("AGENT_NOT_FOUND");

    // 2ª camada de propriedade: não confiar só na promessa do gateway.
    if (agent.id !== ref.agentId || agent.tenantId !== ref.tenantId) {
      return fail("SOURCE_OWNERSHIP_MISMATCH", "agente retornado não pertence ao ref");
    }
    if (!agent.isActive) return fail("AGENT_INACTIVE");

    const model = validateModel(agent.model);
    if (!model.ok) return fail("INVALID_MODEL", "model fora do contrato (string não-vazia ou null)");

    const temperature = validateTemperature(agent.temperature);
    if (!temperature.ok) return fail("INVALID_TEMPERATURE", "temperature fora do contrato (0..2 ou null)");

    // Prompt (sem fallback silencioso; nunca expõe conteúdo em erro).
    // `wa_ai_agents.system_prompt` é a fonte única do texto que o cliente editou
    // no portal e que a LLM recebe. O Funil continua sendo carregado quando
    // habilitado para fornecer tenantPolicies, mas generated_system_prompt é
    // apenas um artefato derivado. Usá-lo como autoridade criava duas versões:
    // a tela mostrava o prompt novo e o runtime podia executar o antigo.
    const promptText = agent.systemPrompt?.trim() ?? "";
    if (promptText === "") return fail("PROMPT_SOURCE_EMPTY", "system_prompt vazio");
    const promptSource: TenantRuntimeConfig["promptSource"] = "raw_system_prompt";
    let funnelUpdatedAt: string | null = null;
    let tenantPolicies = normalizeTenantPolicies([]);
    if (agent.useFunnelConfig) {
      const fcCall = await tryGateway(() => this.gateway.getOwnedFunnelConfig(ref));
      if (!fcCall.ok) return fail("READ_SOURCE_FAILURE", "falha ao ler o funil");
      const fc = fcCall.value;
      if (fc && (fc.agentId !== ref.agentId || fc.tenantId !== ref.tenantId)) {
        return fail("SOURCE_OWNERSHIP_MISMATCH", "funil retornado não pertence ao ref");
      }
      funnelUpdatedAt = fc?.updatedAt ?? null;
      tenantPolicies = normalizeTenantPolicies(fc?.tenantPolicies);
    }

    const stockCall = await tryGateway(() => this.gateway.listActiveStockIntegrationMetadata(ref));
    if (!stockCall.ok) return fail("READ_SOURCE_FAILURE", "falha ao ler integrações de estoque");
    const stock = selectStock(ref, stockCall.value);
    if (!stock.ok) return fail(stock.code, stock.detail);
    const sel = stock.selection;

    // versionStamp composto e determinístico (sem prompt nem segredo): muda quando
    // muda qualquer fonte efetiva (agente, funil-quando-usado, provider/integração).
    const versionStamp = [
      `agent:${agent.updatedAt}`,
      `funnel:${agent.useFunnelConfig ? (funnelUpdatedAt ?? "-") : "-"}`,
      `stock:${sel.provider}:${sel.integrationId ?? "-"}:${sel.integrationUpdatedAt ?? "-"}`,
    ].join("|");

    const config: TenantRuntimeConfig = Object.freeze({
      tenantId: ref.tenantId,
      agentId: ref.agentId,
      agentName: agent.name,
      companyName: normalizeCompany(agent.companyName),
      instanceId: agent.instanceId ?? null,
      promptText,
      promptSource,
      model: model.value,
      temperature: temperature.value,
      sdrGoal: agent.sdrGoal ?? null,
      qualificationQuestions: agent.qualificationQuestions
        ? Object.freeze([...agent.qualificationQuestions])
        : null,
      tenantPolicies: Object.freeze(tenantPolicies),
      sellsMotorcycles: !!agent.sellsMotorcycles,
      blockedCategories: Object.freeze([...(agent.blockedCategories ?? [])]),
      ragRestricted: !!agent.ragRestricted,
      stockProvider: sel.provider,
      stockSecretRef: sel.secretRef, // já frozen em makeSecretRef
      versionStamp,
    });
    return { ok: true, config };
  }
}

// Reexport do guard para quem instanciar o gateway real querer reaproveitar.
export { assertTenantAgentRef };
