// ============================================================================
// tenant-business-info.ts — R13 Inc2/D. QueryTool `tenant_business_info` (endereço/horário/unidade).
//
// FONTE FACTUAL do tenant. Regra de ouro (Brain/11 §D + invariante 9): responde do que está CONFIGURADO;
// SEM fonte factual -> resposta honesta (o cérebro diz "vou confirmar"), NUNCA inventa. Por isso a fonte real
// deriva SÓ de campos ESTRUTURADOS do TenantRuntimeConfig — jamais faz parsing do prompt livre (que fabricaria
// endereço). A observação é TRANSITÓRIA (AgentToolObservation); a memória persistida (ToolResultMemory) leva só
// estrutura sanitizada (tool/status/topic), nunca o valor/PII.
// ============================================================================
import type { TenantAgentRef, TenantRuntimeConfig } from "../domain/read-ports.ts";
import type { AgentToolObservation, BusinessInfoTopic, StoreInfoFact, ToolResultMemory } from "../domain/agent-brain.ts";

export type TenantBusinessInfo = {
  readonly address: string | null;
  readonly hours: string | null;
  readonly unit: string | null;
  readonly source: string; // proveniência da fonte (rótulo seguro; nunca segredo/PII)
};

export interface TenantBusinessInfoSource {
  getBusinessInfo(ref: TenantAgentRef): Promise<TenantBusinessInfo>;
}

// Fonte REAL: SÓ campos estruturados do config. companyName -> unit. address/hours não têm coluna estruturada no
// piloto -> null (o cérebro responde honesto). NUNCA parseia o promptText (não inventa endereço/horário).
export class RuntimeConfigBusinessInfoSource implements TenantBusinessInfoSource {
  constructor(private readonly config: TenantRuntimeConfig) {}
  async getBusinessInfo(_ref: TenantAgentRef): Promise<TenantBusinessInfo> {
    const unit = this.config.companyName && this.config.companyName.trim() ? this.config.companyName.trim() : null;
    return { address: null, hours: null, unit, source: "tenant_runtime_config" };
  }
}

// ============================================================================
// R13-D/3 — TenantBusinessFacts: fatos OBJETIVOS do tenant extraídos do prompt/config com PROVENANCE tipada.
// O prompt do portal É a configuração do tenant (dado válido, provenance=portal_prompt) — logo pode ser citado sem
// tool. A extração é CONSERVADORA: só rótulos de ALTA confiança (label explícito + valor com cara de endereço/horário).
// Campo ausente/duvidoso -> null (NUNCA inventa; o cérebro ainda tem o prompt integral no system e responde de lá).
// ============================================================================
export type BusinessFactProvenance = "portal_prompt" | "config" | "absent";
export type BusinessFact = { readonly value: string | null; readonly provenance: BusinessFactProvenance };
export type TenantBusinessFacts = {
  readonly company: BusinessFact;
  readonly address: BusinessFact;
  readonly hours: BusinessFact;
  readonly unit: BusinessFact;
};

function cleanFragment(raw: string, max = 140): string {
  return raw.replace(/\s+/g, " ").trim().replace(/[;.]+$/, "").slice(0, max).trim();
}
// Endereço plausível: tem vírgula OU uma palavra de logradouro (rua/av/avenida/rodovia/estrada/praça/alameda) + algo.
function looksLikeAddress(v: string): boolean {
  const n = v.toLowerCase();
  return v.length >= 8 && v.length <= 140 && (/,/.test(v) || /\b(rua|r\.|av\.?|avenida|rodovia|rod\.|estrada|praca|praça|alameda|travessa|bairro|jardim|centro)\b/.test(n));
}
// Horário plausível: tem "h"/"hora" ou dias da semana ou faixa de horas.
function looksLikeHours(v: string): boolean {
  const n = v.toLowerCase();
  return v.length >= 4 && v.length <= 140 && (/\b\d{1,2}\s*h\b|\bhoras?\b|\b\d{1,2}:\d{2}\b|\bsegunda|\bseg\b|\bsabado|\bsábado|\bdomingo|\bdias? uteis|\bdias? úteis/.test(n));
}
function firstLabeled(prompt: string, labels: RegExp, ok: (v: string) => boolean): string | null {
  const m = labels.exec(prompt);
  if (!m) return null;
  // valor = do fim do rótulo até o fim da linha (ou 140 chars).
  const rest = prompt.slice(m.index + m[0].length);
  const line = rest.split(/\r?\n/)[0] ?? "";
  const value = cleanFragment(line);
  return value && ok(value) ? value : null;
}

// Extrai os fatos de negócio do config (estruturado) + prompt (rotulado, conservador). Nunca inventa.
export function extractTenantBusinessFacts(config: Pick<TenantRuntimeConfig, "companyName" | "promptText">): TenantBusinessFacts {
  const prompt = typeof config.promptText === "string" ? config.promptText : "";
  const companyValue = config.companyName && config.companyName.trim() ? config.companyName.trim() : null;
  const address = firstLabeled(prompt, /(?:endere[çc]o|localiza[çc][aã]o|fica(?:mos)?\s+(?:em|na|no|à|a))\s*[:\-]?\s*/i, looksLikeAddress);
  const hours = firstLabeled(prompt, /(?:hor[áa]rio(?:\s+de\s+(?:atendimento|funcionamento))?|funcionamento|atendemos|hor[áa]rios?)\s*[:\-]?\s*/i, looksLikeHours);
  const fact = (value: string | null, prov: BusinessFactProvenance): BusinessFact => (value ? { value, provenance: prov } : { value: null, provenance: "absent" });
  return {
    company: fact(companyValue, "config"),
    unit: fact(companyValue, "config"),
    address: fact(address, "portal_prompt"),
    hours: fact(hours, "portal_prompt"),
  };
}

// Fonte de business info baseada nos TenantBusinessFacts (prompt+config). Válida quando o fato existe; senão honesta.
export class PromptTenantBusinessInfoSource implements TenantBusinessInfoSource {
  private readonly facts: TenantBusinessFacts;
  constructor(config: Pick<TenantRuntimeConfig, "companyName" | "promptText">) { this.facts = extractTenantBusinessFacts(config); }
  async getBusinessInfo(_ref: TenantAgentRef): Promise<TenantBusinessInfo> {
    return {
      address: this.facts.address.value,
      hours: this.facts.hours.value,
      unit: this.facts.unit.value,
      source: "tenant_business_facts",
    };
  }
}

function topicValue(info: TenantBusinessInfo, topic: BusinessInfoTopic): string | null {
  if (topic === "address") return info.address;
  if (topic === "hours") return info.hours;
  return info.unit;
}

// Resolve a observação FACTUAL da tool. Valor presente -> StoreInfoFact (ok:true). Ausente -> ok:false
// NOT_CONFIGURED (o cérebro responde honesto). Falha da fonte -> ok:false READ_SOURCE_FAILURE (sanitizado).
export async function resolveTenantBusinessInfo(
  source: TenantBusinessInfoSource,
  ref: TenantAgentRef,
  topic: BusinessInfoTopic,
): Promise<AgentToolObservation> {
  let info: TenantBusinessInfo;
  try {
    info = await source.getBusinessInfo(ref);
  } catch {
    return { tool: "tenant_business_info", ok: false, error: { code: "READ_SOURCE_FAILURE", message: "tenant_business_info indisponivel" } };
  }
  const value = topicValue(info, topic);
  if (value == null || value.trim() === "") {
    return { tool: "tenant_business_info", ok: false, error: { code: "NOT_CONFIGURED", message: `sem valor factual configurado para ${topic}` } };
  }
  const fact: StoreInfoFact = { topic, value: value.trim(), source: info.source };
  return { tool: "tenant_business_info", ok: true, data: fact };
}

// ToolResultMemory sanitizada p/ a WorkingMemory (record_tool_result). Sem PII/valor cru — só a estrutura.
export function businessInfoToolResultMemory(topic: BusinessInfoTopic, ok: boolean, turnId: string): ToolResultMemory {
  return { tool: "tenant_business_info", status: ok ? "ok" : "not_found", turnId, factKeys: [topic] };
}
