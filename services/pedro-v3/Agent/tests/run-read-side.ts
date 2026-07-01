// run-read-side.ts — F2.5.2A / A.1
//
// Testes dos contratos read-only + carregamento seguro de config + CredentialProvider/
// SecretRef + fakes, incluindo o endurecimento A.1 (2 camadas de propriedade, erros do
// gateway fail-closed sem vazar segredo, imutabilidade real, versionStamp composto,
// SecretRef tipado/validado, resolve fail-closed, validação de metadata).
// Sem LLM, sem banco real e sem efeitos externos. HTTP/CRM/QueryRunner aqui usam fakes offline.

import { V2TenantConfigSource } from "../src/adapters/read/tenant-config-source.ts";
import { FakeV2ReadGateway } from "../src/adapters/read/fakes/fake-v2-read-gateway.ts";
import { FakeCredentialProvider } from "../src/adapters/read/fakes/fake-credential-provider.ts";
import { SECRET_KEY_DENYLIST, makeSecretRef } from "../src/domain/credential-provider.ts";
import { assertTenantAgentRef } from "../src/adapters/read/v2-read-gateway.ts";
import type {
  OwnedAgentRow,
  OwnedFunnelConfigRow,
  OwnedCrmLeadRow,
  StockIntegrationMetadataRow,
  V2ReadGateway,
} from "../src/adapters/read/v2-read-gateway.ts";
import type { ConfigResult, NormalizedVehicle } from "../src/domain/read-ports.ts";

// F2.5.2B imports
import { V2StockSource } from "../src/adapters/read/stock-source.ts";
import { V2VehiclePhotoSource } from "../src/adapters/read/photo-source.ts";
import { ReadCache } from "../src/adapters/read/cache.ts";
import { V2StockLoader } from "../src/adapters/read/stock-loader.ts";
import { V2CrmReadSource } from "../src/adapters/read/crm-read-source.ts";
import {
  V2DatabaseCredentialProvider,
  V2DatabaseReadGateway,
  type SecretDecryptor,
  type V2ColumnName,
  type V2ReadDatabase,
  type V2TableName,
  type V2WhereEquals,
} from "../src/adapters/read/supabase-v2-read-adapter.ts";
import { createReadQueryRunner } from "../src/engine/read-query-runner.ts";
import {
  SafeHttpClient,
  isPrivateIp,
  DnsResolver,
  HttpTransport,
  Sleeper
} from "../src/adapters/read/http-client.ts";
import {
  decodeNormalizedVehicle,
  generateVehicleKey,
  classifyVehicleType,
  parseVehiclePhotos,
  generatePhotoId,
  isValidPhotoUrl
} from "../src/adapters/read/stock-normalizer.ts";
import { buildTenantCatalog, isVehicleKeyInCatalog } from "../src/engine/catalog-utils.ts";
import type { Clock } from "../src/domain/ports.ts";
import * as fs from "fs";
import * as path from "path";

let ok = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`  RED ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function expectThrow(name: string, fn: () => Promise<unknown>, contains: string): Promise<void> {
  try {
    await fn();
    check(name, false, "deveria lançar");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, message.includes(contains), message);
  }
}

function expectThrowSync(name: string, fn: () => unknown, contains: string): void {
  try {
    fn();
    check(name, false, "deveria lançar");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, message.includes(contains), message);
  }
}

function isErr(r: ConfigResult, code: string): boolean {
  return !r.ok && r.error.code === code;
}

// Deep-scan: procura CHAVE de campo proibida (match exato, minúsculo) em qualquer nível.
function findForbiddenKey(value: unknown, denylist: readonly string[]): string | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findForbiddenKey(item, denylist);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (denylist.includes(k.toLowerCase())) return k;
    const hit = findForbiddenKey(v, denylist);
    if (hit) return hit;
  }
  return null;
}

// Deep-scan: procura um VALOR string (canário de segredo) em qualquer nível.
function containsValue(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => containsValue(v, needle));
  return Object.values(value as Record<string, unknown>).some((v) => containsValue(v, needle));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────

type DbCall = {
  readonly op: "one" | "many";
  readonly table: V2TableName;
  readonly columns: readonly V2ColumnName[];
  readonly where: V2WhereEquals;
};

class RecordingV2ReadDatabase implements V2ReadDatabase {
  readonly calls: DbCall[] = [];

  constructor(
    private readonly rows: Partial<Record<V2TableName, readonly Record<string, unknown>[]>>,
    private readonly failWith?: string,
  ) {}

  async selectOne(table: V2TableName, columns: readonly V2ColumnName[], where: V2WhereEquals): Promise<Record<string, unknown> | null> {
    this.calls.push({ op: "one", table, columns, where });
    if (this.failWith) throw new Error(this.failWith);
    const found = this.findRows(table, where)[0] ?? null;
    return found ? this.project(found, columns) : null;
  }

  async selectMany(table: V2TableName, columns: readonly V2ColumnName[], where: V2WhereEquals): Promise<readonly Record<string, unknown>[]> {
    this.calls.push({ op: "many", table, columns, where });
    if (this.failWith) throw new Error(this.failWith);
    return this.findRows(table, where).map((row) => this.project(row, columns));
  }

  private findRows(table: V2TableName, where: V2WhereEquals): readonly Record<string, unknown>[] {
    return (this.rows[table] ?? []).filter((row) =>
      Object.entries(where).every(([key, value]) => row[key] === value),
    );
  }

  private project(row: Record<string, unknown>, columns: readonly V2ColumnName[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const column of columns) out[column] = row[column];
    return out;
  }
}
const TENANT_A = "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_RAW = "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185"; // "Aloan" — prompt cru
const AGENT_FUNNEL = "11111111-2222-4333-8444-555555555555"; // usa funil
const AGENT_INACTIVE = "99999999-9999-4999-8999-999999999999";
const AGENT_BADTEMP = "22222222-2222-4222-8222-222222222222";
const AGENT_BADMODEL = "33333333-3333-4333-8333-333333333333";
const AGENT_EMPTY_FUNNEL = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-06-28T12:00:00.000Z";
const LEAD_A = "123e4567-e89b-42d3-a456-426614174000";
const LEAD_B = "123e4567-e89b-42d3-a456-426614174001";

const PROMPT_CANARY = "PROMPT-CANARY-CONTENT-do-not-leak";
const SECRET_FEED = "https://feed.example/SECRET-CANARY-FEED?token=SECRET-CANARY-TOKEN";
const SECRET_TOKEN = "SECRET-CANARY-TOKEN";

function agent(over: Partial<OwnedAgentRow> & { id: string; tenantId: string }): OwnedAgentRow {
  return {
    name: "Aloan",
    instanceId: null,
    systemPrompt: "Você é o Aloan, SDR da loja.",
    useFunnelConfig: false,
    companyName: "",
    model: "gpt-4.1-mini",
    temperature: 0.7,
    sdrGoal: "agendar visita",
    qualificationQuestions: ["qual modelo?", "à vista ou financiado?"],
    sellsMotorcycles: false,
    blockedCategories: [],
    ragRestricted: false,
    isActive: true,
    updatedAt: NOW,
    ...over,
  };
}

const agents: OwnedAgentRow[] = [
  agent({ id: AGENT_RAW, tenantId: TENANT_A }),
  agent({ id: AGENT_FUNNEL, tenantId: TENANT_A, useFunnelConfig: true, systemPrompt: PROMPT_CANARY }),
  agent({ id: AGENT_INACTIVE, tenantId: TENANT_A, isActive: false }),
  agent({ id: AGENT_BADTEMP, tenantId: TENANT_A, temperature: 5 as unknown as number }),
  agent({ id: AGENT_BADMODEL, tenantId: TENANT_A, model: 123 as unknown as string }),
  agent({ id: AGENT_EMPTY_FUNNEL, tenantId: TENANT_A, useFunnelConfig: true, systemPrompt: PROMPT_CANARY }),
];

const funnels: OwnedFunnelConfigRow[] = [
  { agentId: AGENT_FUNNEL, tenantId: TENANT_A, generatedSystemPrompt: "Prompt gerado pelo funil.", updatedAt: NOW },
  { agentId: AGENT_EMPTY_FUNNEL, tenantId: TENANT_A, generatedSystemPrompt: "   ", updatedAt: NOW },
];

const RM: StockIntegrationMetadataRow = { id: "int-rm", tenantId: TENANT_A, provider: "revendamais", isActive: true, updatedAt: NOW };
const BNDV: StockIntegrationMetadataRow = { id: "int-bndv", tenantId: TENANT_A, provider: "bndv", isActive: true, updatedAt: NOW };

const seedBoth = {
  agents,
  funnels,
  integrationsByTenant: { [TENANT_A]: [RM, BNDV] },
  integrationSecrets: {
    "int-rm": { feed_url: SECRET_FEED, api_token: SECRET_TOKEN },
    "int-bndv": { feed_url: SECRET_FEED, api_token: SECRET_TOKEN },
  },
};

async function main(): Promise<void> {
  console.log("F2.5.2A/A.1 read-side:");

  const gateway = new FakeV2ReadGateway(seedBoth);
  const credSpy = new FakeCredentialProvider();
  const source = new V2TenantConfigSource(gateway);

  // ── básicos ───────────────────────────────────────────────────────────────
  const r1 = await source.load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("tenant correto carrega seu agente", r1.ok && r1.config.agentId === AGENT_RAW && r1.config.agentName === "Aloan", JSON.stringify(r1));

  const r2 = await source.load({ tenantId: TENANT_B, agentId: AGENT_RAW });
  check("cross-tenant falha fechado (AGENT_NOT_FOUND)", isErr(r2, "AGENT_NOT_FOUND"), JSON.stringify(r2));

  const r3 = await source.load({ tenantId: TENANT_A, agentId: "" });
  check("agentId vazio → MISSING_TENANT_OR_AGENT", isErr(r3, "MISSING_TENANT_OR_AGENT"), JSON.stringify(r3));

  const r4 = await source.load({ tenantId: TENANT_A, agentId: AGENT_INACTIVE });
  check("agente inativo → AGENT_INACTIVE", isErr(r4, "AGENT_INACTIVE"), JSON.stringify(r4));

  check("companyName vazio vira null", r1.ok && r1.config.companyName === null);
  check("prompt cru resolvido", r1.ok && r1.config.promptSource === "raw_system_prompt" && r1.config.promptText === "Você é o Aloan, SDR da loja.");

  const r7 = await source.load({ tenantId: TENANT_A, agentId: AGENT_FUNNEL });
  check("prompt de funil resolvido", r7.ok && r7.config.promptSource === "funnel_generated" && r7.config.promptText === "Prompt gerado pelo funil.", JSON.stringify(r7));

  const r8a = await source.load({ tenantId: TENANT_A, agentId: AGENT_EMPTY_FUNNEL });
  check("funil vazio → PROMPT_SOURCE_EMPTY", isErr(r8a, "PROMPT_SOURCE_EMPTY"), JSON.stringify(r8a));
  const r8b = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: "raw-empty", tenantId: TENANT_A, systemPrompt: "   " })], funnels: [], integrationsByTenant: {},
  })).load({ tenantId: TENANT_A, agentId: "raw-empty" });
  check("system_prompt vazio → PROMPT_SOURCE_EMPTY", isErr(r8b, "PROMPT_SOURCE_EMPTY"), JSON.stringify(r8b));
  check("erro de prompt vazio não vaza conteúdo do prompt", !containsValue(r8a, PROMPT_CANARY));

  // ── estoque ───────────────────────────────────────────────────────────────
  check("RevendaMais vence BNDV", r1.ok && r1.config.stockProvider === "revendamais" && r1.config.stockSecretRef?.integrationId === "int-rm");
  const r11 = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })], funnels: [], integrationsByTenant: { [TENANT_A]: [BNDV] },
  })).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("só BNDV ativo → bndv (sem inventar RevendaMais)", r11.ok && r11.config.stockProvider === "bndv" && r11.config.stockSecretRef?.integrationId === "int-bndv", JSON.stringify(r11));
  check("ambos ativos nunca selecionam BNDV (sem fallback)", r1.ok && r1.config.stockSecretRef?.provider === "revendamais");
  const rNone = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })], funnels: [], integrationsByTenant: { [TENANT_A]: [{ ...RM, isActive: false }] },
  })).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("sem estoque ativo → provider none + secretRef null", rNone.ok && rNone.config.stockProvider === "none" && rNone.config.stockSecretRef === null, JSON.stringify(rNone));

  // ── credenciais nunca vazam ─────────────────────────────────────────────────
  if (r1.ok) {
    check("config sem chave de credencial", findForbiddenKey(r1.config, SECRET_KEY_DENYLIST) === null, String(findForbiddenKey(r1.config, SECRET_KEY_DENYLIST)));
    const leaked = gateway.secretCanaryValues().some((s) => containsValue(r1.config, s)) || containsValue(r1.config, "SECRET-CANARY");
    check("config sem valor de credencial (canário)", !leaked);
    const keys = Object.keys(r1.config.stockSecretRef ?? {}).sort().join(",");
    check("SecretRef tem só os 4 campos opacos", keys === "integrationId,provider,purpose,tenantId", keys);
    check("SecretRef sem chave de credencial", findForbiddenKey(r1.config.stockSecretRef, SECRET_KEY_DENYLIST) === null);
  }
  check("CredentialProvider não é chamado no load", credSpy.resolveCount === 0, String(credSpy.resolveCount));

  // ── model/temperature ───────────────────────────────────────────────────────
  check("temperature fora de 0..2 → INVALID_TEMPERATURE", isErr(await source.load({ tenantId: TENANT_A, agentId: AGENT_BADTEMP }), "INVALID_TEMPERATURE"));
  check("model não-string → INVALID_MODEL", isErr(await source.load({ tenantId: TENANT_A, agentId: AGENT_BADMODEL }), "INVALID_MODEL"));
  const r15c = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: "t", tenantId: TENANT_A, temperature: "quente" as unknown as number })], funnels: [], integrationsByTenant: {},
  })).load({ tenantId: TENANT_A, agentId: "t" });
  check("temperature não-numérica → INVALID_TEMPERATURE", isErr(r15c, "INVALID_TEMPERATURE"));

  // ── determinismo + guard de tenant/agente ───────────────────────────────────
  const r16a = await source.load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  const r16b = await source.load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("fakes determinísticos (load idempotente)", JSON.stringify(r16a) === JSON.stringify(r16b));
  await expectThrow("gateway rejeita tenant vazio", () => gateway.getOwnedAgent({ tenantId: "", agentId: AGENT_RAW }), "tenantId e agentId");
  await expectThrow("gateway rejeita agentId vazio", () => gateway.getOwnedAgent({ tenantId: TENANT_A, agentId: "" }), "tenantId e agentId");
  await expectThrow("gateway rejeita estoque sem tenant", () => gateway.listActiveStockIntegrationMetadata({ tenantId: "", agentId: AGENT_RAW }), "tenantId e agentId");
  check("assertTenantAgentRef aceita ref completo", (() => { try { assertTenantAgentRef({ tenantId: TENANT_A, agentId: AGENT_RAW }); return true; } catch { return false; } })());

  // ── A.1 #1 — 2ª camada de propriedade (gateway mentiroso) ────────────────────
  const lyingTenantGw: V2ReadGateway = {
    async getOwnedAgent() { return agent({ id: AGENT_RAW, tenantId: "OUTRO-TENANT" }); },
    async getOwnedFunnelConfig() { return null; },
    async getOwnedCrmLead() { return null; },
    async listActiveStockIntegrationMetadata() { return []; },
  };
  check("gateway devolve agente de outro tenant → SOURCE_OWNERSHIP_MISMATCH",
    isErr(await new V2TenantConfigSource(lyingTenantGw).load({ tenantId: TENANT_A, agentId: AGENT_RAW }), "SOURCE_OWNERSHIP_MISMATCH"));

  const lyingAgentIdGw: V2ReadGateway = {
    async getOwnedAgent() { return agent({ id: "OUTRO-AGENTE", tenantId: TENANT_A }); },
    async getOwnedFunnelConfig() { return null; },
    async getOwnedCrmLead() { return null; },
    async listActiveStockIntegrationMetadata() { return []; },
  };
  check("gateway devolve agentId diferente → SOURCE_OWNERSHIP_MISMATCH",
    isErr(await new V2TenantConfigSource(lyingAgentIdGw).load({ tenantId: TENANT_A, agentId: AGENT_RAW }), "SOURCE_OWNERSHIP_MISMATCH"));

  const lyingFunnelGw: V2ReadGateway = {
    async getOwnedAgent(ref) { return agent({ id: ref.agentId, tenantId: ref.tenantId, useFunnelConfig: true }); },
    async getOwnedFunnelConfig() { return { agentId: "OUTRO", tenantId: "OUTRO", generatedSystemPrompt: "x", updatedAt: NOW }; },
    async getOwnedCrmLead() { return null; },
    async listActiveStockIntegrationMetadata() { return []; },
  };
  check("funnel de outro tenant → SOURCE_OWNERSHIP_MISMATCH",
    isErr(await new V2TenantConfigSource(lyingFunnelGw).load({ tenantId: TENANT_A, agentId: AGENT_FUNNEL }), "SOURCE_OWNERSHIP_MISMATCH"));

  const foreignIntegrationGw = new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })], funnels: [],
    integrationsByTenant: { [TENANT_A]: [{ id: "int-x", tenantId: TENANT_B, provider: "revendamais", isActive: true, updatedAt: NOW }] },
  });
  check("integração de outro tenant → SOURCE_OWNERSHIP_MISMATCH",
    isErr(await new V2TenantConfigSource(foreignIntegrationGw).load({ tenantId: TENANT_A, agentId: AGENT_RAW }), "SOURCE_OWNERSHIP_MISMATCH"));

  // ── A.1 #2 — erro do gateway fail-closed sem vazar segredo ────────────────────
  const throwingGw: V2ReadGateway = {
    async getOwnedAgent() { throw new Error("token=SECRET-CANARY prompt=PROMPT-CANARY"); },
    async getOwnedFunnelConfig() { throw new Error("x"); },
    async getOwnedCrmLead() { throw new Error("x"); },
    async listActiveStockIntegrationMetadata() { return []; },
  };
  const rThrow = await new V2TenantConfigSource(throwingGw).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("gateway que lança → READ_SOURCE_FAILURE", isErr(rThrow, "READ_SOURCE_FAILURE"), JSON.stringify(rThrow));
  check("erro do gateway não vaza canário (token/prompt)", !JSON.stringify(rThrow).includes("CANARY"), JSON.stringify(rThrow));

  // ── A.1 #3 — imutabilidade real ───────────────────────────────────────────────
  const seedMut = {
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A, blockedCategories: ["moto"], qualificationQuestions: ["q1", "q2"] })],
    funnels: [], integrationsByTenant: { [TENANT_A]: [RM] },
  };
  const rMut = await new V2TenantConfigSource(new FakeV2ReadGateway(seedMut)).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  if (rMut.ok) {
    check("config final está frozen", Object.isFrozen(rMut.config));
    check("qualificationQuestions frozen", Object.isFrozen(rMut.config.qualificationQuestions));
    check("blockedCategories frozen", Object.isFrozen(rMut.config.blockedCategories));
    check("stockSecretRef frozen", rMut.config.stockSecretRef !== null && Object.isFrozen(rMut.config.stockSecretRef));
    const before = JSON.stringify(rMut.config.blockedCategories) + "|" + JSON.stringify(rMut.config.qualificationQuestions);
    (seedMut.agents[0].blockedCategories as string[]).push("INJECTED");
    (seedMut.agents[0].qualificationQuestions as string[]).push("INJECTED");
    const after = JSON.stringify(rMut.config.blockedCategories) + "|" + JSON.stringify(rMut.config.qualificationQuestions);
    check("mutar arrays do seed após o load não altera a config", before === after, `${before} != ${after}`);
  } else {
    check("config final está frozen", false, "rMut não ok");
  }

  // ── A.1 #4 — versionStamp composto ────────────────────────────────────────────
  const fSeedA = {
    agents: [agent({ id: AGENT_FUNNEL, tenantId: TENANT_A, useFunnelConfig: true })],
    funnels: [{ agentId: AGENT_FUNNEL, tenantId: TENANT_A, generatedSystemPrompt: "p", updatedAt: "2026-06-28T10:00:00.000Z" }],
    integrationsByTenant: {},
  };
  const fSeedB = { ...fSeedA, funnels: [{ ...fSeedA.funnels[0], updatedAt: "2026-06-28T11:00:00.000Z" }] };
  const vsFa = await new V2TenantConfigSource(new FakeV2ReadGateway(fSeedA)).load({ tenantId: TENANT_A, agentId: AGENT_FUNNEL });
  const vsFb = await new V2TenantConfigSource(new FakeV2ReadGateway(fSeedB)).load({ tenantId: TENANT_A, agentId: AGENT_FUNNEL });
  check("versionStamp muda com funnel.updatedAt", vsFa.ok && vsFb.ok && vsFa.config.versionStamp !== vsFb.config.versionStamp);

  const vsRM = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })], funnels: [], integrationsByTenant: { [TENANT_A]: [RM] },
  })).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  const vsBNDV = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })], funnels: [], integrationsByTenant: { [TENANT_A]: [BNDV] },
  })).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("versionStamp muda com provider/integration", vsRM.ok && vsBNDV.ok && vsRM.config.versionStamp !== vsBNDV.config.versionStamp);
  const vsIntTs = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })], funnels: [], integrationsByTenant: { [TENANT_A]: [{ ...RM, updatedAt: "2026-06-28T22:00:00.000Z" }] },
  })).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("versionStamp muda com integration.updatedAt", vsRM.ok && vsIntTs.ok && vsRM.config.versionStamp !== vsIntTs.config.versionStamp);

  // ── A.1 #5 — makeSecretRef tipado/validado (sem ecoar valor) ─────────────────
  expectThrowSync("makeSecretRef rejeita provider desconhecido", () => makeSecretRef({ tenantId: TENANT_A, integrationId: "i", provider: "hackerprovider" as never, purpose: "stock_feed" }), "provider");
  let badMsg = "";
  try { makeSecretRef({ tenantId: TENANT_A, integrationId: "i", provider: "hackerprovider" as never, purpose: "stock_feed" }); } catch (e) { badMsg = e instanceof Error ? e.message : String(e); }
  check("makeSecretRef não ecoa o provider inválido", badMsg.includes("provider") && !badMsg.includes("hackerprovider"), badMsg);
  expectThrowSync("makeSecretRef rejeita tenantId vazio", () => makeSecretRef({ tenantId: "", integrationId: "i", provider: "revendamais", purpose: "stock_feed" }), "tenantId");
  expectThrowSync("makeSecretRef rejeita integrationId vazio", () => makeSecretRef({ tenantId: TENANT_A, integrationId: "", provider: "revendamais", purpose: "stock_feed" }), "integrationId");
  expectThrowSync("makeSecretRef rejeita purpose desconhecido", () => makeSecretRef({ tenantId: TENANT_A, integrationId: "i", provider: "revendamais", purpose: "evil" as never }), "purpose");

  // ── A.1 #6 — CredentialProvider fail-closed ───────────────────────────────────
  const credWith = new FakeCredentialProvider({ "int-rm": { tenantId: TENANT_A, provider: "revendamais", material: SECRET_TOKEN } });
  const refRM = makeSecretRef({ tenantId: TENANT_A, integrationId: "int-rm", provider: "revendamais", purpose: "stock_feed" });
  const okRes = await credWith.resolve(refRM);
  check("resolve com segredo presente → ok", okRes.ok && okRes.secret.material === SECRET_TOKEN);
  const missRes = await new FakeCredentialProvider().resolve(refRM);
  check("segredo ausente no fake → SECRET_NOT_FOUND (fail-closed)", !missRes.ok && missRes.error === "SECRET_NOT_FOUND");
  const ownRes = await credWith.resolve(makeSecretRef({ tenantId: TENANT_B, integrationId: "int-rm", provider: "revendamais", purpose: "stock_feed" }));
  check("tenant divergente → SECRET_OWNERSHIP_MISMATCH", !ownRes.ok && ownRes.error === "SECRET_OWNERSHIP_MISMATCH");
  const provRes = await credWith.resolve(makeSecretRef({ tenantId: TENANT_A, integrationId: "int-rm", provider: "bndv", purpose: "stock_feed" }));
  check("provider divergente → SECRET_PROVIDER_MISMATCH", !provRes.ok && provRes.error === "SECRET_PROVIDER_MISMATCH");

  // ── A.1 #7 — validação estrutural de metadata ─────────────────────────────────
  const rEmptyId = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })], funnels: [],
    integrationsByTenant: { [TENANT_A]: [{ id: "   ", tenantId: TENANT_A, provider: "revendamais", isActive: true, updatedAt: NOW }] },
  })).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("id de integração vazio → PROVIDER_METADATA_INCONSISTENT", isErr(rEmptyId, "PROVIDER_METADATA_INCONSISTENT"), JSON.stringify(rEmptyId));
  const rUnknownProv = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })], funnels: [],
    integrationsByTenant: { [TENANT_A]: [{ id: "int-z", tenantId: TENANT_A, provider: "randomplatform", isActive: true, updatedAt: NOW }] },
  })).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("provider desconhecido → PROVIDER_METADATA_INCONSISTENT", isErr(rUnknownProv, "PROVIDER_METADATA_INCONSISTENT"), JSON.stringify(rUnknownProv));
  const rBadTs = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })], funnels: [],
    integrationsByTenant: { [TENANT_A]: [{ id: "int-rm", tenantId: TENANT_A, provider: "revendamais", isActive: true, updatedAt: "not-a-date" }] },
  })).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("timestamp inválido → PROVIDER_METADATA_INCONSISTENT", isErr(rBadTs, "PROVIDER_METADATA_INCONSISTENT"), JSON.stringify(rBadTs));
  const rDup = await new V2TenantConfigSource(new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })], funnels: [],
    integrationsByTenant: { [TENANT_A]: [RM, { id: "int-rm-2", tenantId: TENANT_A, provider: "revendamais", isActive: true, updatedAt: NOW }] },
  })).load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("provider duplicado → PROVIDER_METADATA_INCONSISTENT", isErr(rDup, "PROVIDER_METADATA_INCONSISTENT"), JSON.stringify(rDup));

  // ============================================================================
  // TESTES ADVERSARIAIS F2.5.2B.1 - ESTOQUE, FOTOS, CARROCERIA, HTTP SEGURO, CACHE
  // ============================================================================
  console.log("\nF2.5.2B.1 estoque, carroceria, fotos, HTTP seguro e cache:");

  // 1. HTTP Seguro e SSRF
  check("isPrivateIp identifica IPs privados",
    isPrivateIp("127.0.0.1") === true &&
    isPrivateIp("10.0.0.1") === true &&
    isPrivateIp("192.168.1.1") === true &&
    isPrivateIp("172.16.5.5") === true &&
    isPrivateIp("169.254.169.254") === true &&
    isPrivateIp("::1") === true &&
    isPrivateIp("fc00::1") === true &&
    isPrivateIp("fe80::1234") === true &&
    isPrivateIp("8.8.8.8") === false &&
    isPrivateIp("104.244.42.1") === false
  );

  // Instancia fakes de DNS e Transporte
  class FakeDnsResolver implements DnsResolver {
    public resolveToPrivate = false;
    async resolve(hostname: string): Promise<string[]> {
      if (this.resolveToPrivate) return ["192.168.1.50"];
      if (hostname === "localhost" || hostname === "127.0.0.1") return ["127.0.0.1"];
      if (hostname === "app.revendamais.com.br") return ["104.244.42.1"];
      if (hostname === "api-estoque.azurewebsites.net") return ["104.244.42.2"];
      if (hostname === "evil.com") return ["200.200.200.200"];
      return ["8.8.8.8"];
    }
    async lookup(hostname: string): Promise<string> {
      const ips = await this.resolve(hostname);
      return ips[0];
    }
  }

  class FakeHttpTransport implements HttpTransport {
    constructor(public handler: (url: string, init?: RequestInit) => Promise<Response>) {}
    async fetch(url: string, init?: RequestInit): Promise<Response> {
      return this.handler(url, init);
    }
  }

  class FakeSleeper implements Sleeper {
    public sleptMs = 0;
    async sleep(ms: number): Promise<void> {
      this.sleptMs += ms;
    }
  }

  const dnsFake = new FakeDnsResolver();
  const sleeperFake = new FakeSleeper();

  // Testes de validação de URL no SafeHttpClient
  const client = new SafeHttpClient(dnsFake, new FakeHttpTransport(async () => new Response()), sleeperFake);

  // F2.7.2: http:// de host permitido e NORMALIZADO para https:// (em vez de rejeitado) — desbloqueia feeds
  // legados do v2 mantendo o invariante "so buscamos https". Host fora da allowlist segue bloqueado.
  check("URL HTTP de host permitido normaliza para HTTPS (F2.7.2)", client.validateUrl("http://app.revendamais.com.br/test", "revendamais").protocol === "https:");
  expectThrowSync("HTTP de host fora da allowlist segue bloqueado", () => client.validateUrl("http://evil.com/test", "revendamais"), "HOST_NOT_ALLOWED_BY_POLICY");
  expectThrowSync("Host fora da allowlist é bloqueado por provider", () => client.validateUrl("https://evil.com/test", "revendamais"), "HOST_NOT_ALLOWED_BY_POLICY");
  expectThrowSync("Host de outro provider é bloqueado", () => client.validateUrl("https://app.revendamais.com.br/test", "bndv"), "HOST_NOT_ALLOWED_BY_POLICY");
  check("Host permitido é aceito por provider", client.validateUrl("https://app.revendamais.com.br/test", "revendamais").hostname === "app.revendamais.com.br");

  // F2.7.2: o feed http:// e efetivamente BAIXADO como https:// (o transporte recebe a URL normalizada).
  let upgradedFetchUrl = "";
  const clientUpgrade = new SafeHttpClient(
    dnsFake,
    new FakeHttpTransport(async (u) => { upgradedFetchUrl = u; return new Response("[]", { headers: new Headers({ "content-type": "application/json" }) }); }),
    sleeperFake,
  );
  await clientUpgrade.safeFetch("http://app.revendamais.com.br/feed", { provider: "revendamais" });
  check("safeFetch baixa http como https (transporte recebe https)", upgradedFetchUrl.startsWith("https://app.revendamais.com.br/feed"), upgradedFetchUrl);

  // Teste de redirect com vazamento de Authorization
  const transportRedirectWithAuth = new FakeHttpTransport(async (url, init) => {
    if (url === "https://app.revendamais.com.br/feed") {
      return new Response("", {
        status: 302,
        headers: new Headers({ "location": "https://api-estoque.azurewebsites.net/other" })
      });
    }
    return new Response("{}");
  });
  const clientRedirect = new SafeHttpClient(dnsFake, transportRedirectWithAuth, sleeperFake);
  await expectThrow("redirect cross-origin com Authorization falha", () => clientRedirect.safeFetch("https://app.revendamais.com.br/feed", {
    provider: "revendamais",
    headers: { "Authorization": "Bearer 123" }
  }), "SSRF_REDIRECT_BLOCKED_SENSITIVE_HEADER");

  // Teste de GET com content-type inválido (não-JSON)
  const transportInvalidContentType = new FakeHttpTransport(async () => {
    return new Response("plain text data", {
      headers: new Headers({ "content-type": "text/plain" })
    });
  });
  const clientInvalidCT = new SafeHttpClient(dnsFake, transportInvalidContentType, sleeperFake);
  await expectThrow("GET com content-type inválido falha", () => clientInvalidCT.safeFetch("https://app.revendamais.com.br/feed", {
    provider: "revendamais"
  }), "INVALID_CONTENT_TYPE");

  // Teste de limite de bytes
  const transportTooLarge = new FakeHttpTransport(async () => {
    return new Response(new Uint8Array(20 * 1024 * 1024), { // 20 MB
      headers: new Headers({ "content-type": "application/json" })
    });
  });
  const clientTooLarge = new SafeHttpClient(dnsFake, transportTooLarge, sleeperFake);
  await expectThrow("limite de bytes lança erro", () => clientTooLarge.safeFetch("https://app.revendamais.com.br/feed", {
    provider: "revendamais"
  }), "RESPONSE_TOO_LARGE");

  // Teste de redirect para IP privado (através de DNS que muda a resolução)
  const dnsPrivate = new FakeDnsResolver();
  const transportPrivateRedirect = new FakeHttpTransport(async (url) => {
    if (url === "https://app.revendamais.com.br/feed") {
      dnsPrivate.resolveToPrivate = true; // Simula ataque SSRF de DNS rebinding/ip privado no redirect
      return new Response("", {
        status: 302,
        headers: new Headers({ "location": "https://app.revendamais.com.br/feed-private" })
      });
    }
    return new Response("{}");
  });
  const clientPrivateRedirect = new SafeHttpClient(dnsPrivate, transportPrivateRedirect, sleeperFake);
  await expectThrow("redirect para IP privado falha", () => clientPrivateRedirect.safeFetch("https://app.revendamais.com.br/feed", {
    provider: "revendamais"
  }), "SSRF_IP_BLOCKED");

  // 2. Normalização Fail-Closed e Classificador de Carrocerias factual
  const vValid = decodeNormalizedVehicle({
    vehicle_id: 12345,
    make: "Ford",
    base_model: "Ecosport",
    model: "Ecosport Freestyle 1.6",
    year: 2018,
    price: 65000,
    color: "Vermelho",
    category: "AUTOMÓVEL",
    body_type: "suv"
  }, "revendamais");
  check("decodeNormalizedVehicle decodifica válido", vValid.externalVehicleId === "12345" && vValid.saleValue === 65000 && vValid.year === 2018 && vValid.source === "revendamais");

  const t1 = classifyVehicleType(vValid.category, vValid.bodyType);
  check("carroceria direta da fonte mapeada como suv", t1.value === "suv" && t1.provenance === "source_field" && t1.confidence === 1.0);
  const rmUtility = classifyVehicleType("AUTOMÓVEL", "utilitario", "revendamais");
  const otherUtility = classifyVehicleType("AUTOMÓVEL", "utilitario", "bndv");
  check("taxonomia RevendaMais: utilitario factual vira pickup", rmUtility.value === "pickup" && rmUtility.provenance === "source_field");
  check("utilitario de outro provedor nao e promovido sem evidencia", otherUtility.value === "unknown");

  // Sem campo confiável: deve classificar como unknown
  const vNoBody = decodeNormalizedVehicle({
    vehicle_id: 54321,
    make: "Hyundai",
    base_model: "Creta",
    model: "Creta Action 1.6",
    year: 2021,
    price: 85000,
    category: "AUTOMÓVEL"
  }, "revendamais");
  const t2 = classifyVehicleType(vNoBody.category, vNoBody.bodyType);
  check("sem campo factual vira unknown", t2.value === "unknown" && t2.provenance === "unknown");

  // 3. Chaves estáveis baseadas em source e colisão de fingerprint
  const { key: key1 } = generateVehicleKey(vValid);
  check("chave gerada por externalVehicleId usa source", key1 === "revendamais:12345");

  const vNoId1 = decodeNormalizedVehicle({
    make: "Ford",
    base_model: "Ka",
    model: "Ka SE 1.0",
    year: 2019,
    price: 45000,
    color: "Prata",
    fuel: "Flex",
    gear: "Manual"
  }, "revendamais");
  const { key: key2, fingerprintUsed: fpUsed } = generateVehicleKey(vNoId1);
  check("chave gerada por fingerprint quando falta ID", fpUsed === true && key2.startsWith("revendamais:fp-"));

  // 4. Teste de Invalidação de Cache com Promise pendente
  const fakeClock: Clock = {
    now: () => NOW
  };
  const testCache = new ReadCache<NormalizedVehicle[]>(fakeClock, { enabled: true, ttlMs: 60000, maxItems: 100 });

  let resolvePromiseFn: (val: NormalizedVehicle[]) => void = () => {};
  const promisePending = new Promise<NormalizedVehicle[]>(resolve => {
    resolvePromiseFn = resolve;
  });

  // Dispara a busca que fica pendente
  const fetchPromise = testCache.getOrFetch("tenant1", "revendamais", "extra", () => promisePending);

  // Invalida a cache antes de a promise resolver
  testCache.invalidate("tenant1", "revendamais");

  // Agora resolve a promise atrasada
  const oldVehicles = [vValid];
  resolvePromiseFn(oldVehicles);
  await fetchPromise;

  // Tenta ler de novo; como foi invalidada, ela deve chamar a função novamente em vez de usar o cache da promise atrasada!
  const status = { calledAgain: false };
  await testCache.getOrFetch("tenant1", "revendamais", "extra", async () => {
    status.calledAgain = true;
    return [];
  });
  check("invalidação impede que promise atrasada repovoe cache obsoleto", status.calledAgain === true);

  // 5. Teste Integrado 100% Offline via StockLoader e V2StockSource
  const cp = new FakeCredentialProvider({
    "int-rm": { tenantId: TENANT_A, provider: "revendamais", material: JSON.stringify({ feed_url: "https://app.revendamais.com.br/feed" }) }
  });

  const mockVehicles = [
    {
      vehicle_id: 101,
      make: "Chevrolet",
      base_model: "Onix",
      model: "Onix LT 1.0",
      year: 2020,
      price: 60000,
      category: "AUTOMÓVEL",
      body_type: "hatch",
      images_large: [
        "https://app.revendamais.com.br/img/101_1.jpg",
        "https://app.revendamais.com.br/img/101_2.jpg"
      ]
    },
    {
      vehicle_id: 102,
      make: "Chevrolet",
      base_model: "Onix",
      model: "Onix LTZ 1.0 Turbo",
      year: 2020,
      price: 68000,
      category: "AUTOMÓVEL",
      body_type: "hatch",
      images_large: [
        "https://app.revendamais.com.br/img/102_1.jpg"
      ]
    },
    // Sem preço (deve ser filtrado fail-closed)
    {
      vehicle_id: 103,
      make: "Ford",
      base_model: "Ka",
      model: "Ka SE 1.0",
      year: 2018,
      price: 0,
      category: "AUTOMÓVEL"
    },
    // Foto com URL inválida (HTTP) -> deve ser descartada de parseVehiclePhotos
    {
      vehicle_id: 105,
      make: "Fiat",
      base_model: "Mobi",
      model: "Mobi Like",
      year: 2022,
      price: 72000,
      images_large: [
        "http://app.revendamais.com.br/insecure.jpg"
      ]
    },
    {
      vehicle_id: 106,
      make: "Fiat",
      base_model: "Strada",
      model: "Strada HD WK CD E",
      year: 2018,
      price: 76990,
      category: "AUTOMÓVEL",
      body_type: "utilitario"
    }
  ];

  const transportMock = new FakeHttpTransport(async (url) => {
    return new Response(JSON.stringify({ vehicles: mockVehicles }), {
      headers: new Headers({ "content-type": "application/json" })
    });
  });

  const localHttpClient = new SafeHttpClient(dnsFake, transportMock, sleeperFake);
  const loader = new V2StockLoader(gateway, cp, testCache, localHttpClient);
  const stockSource = new V2StockSource(loader);
  const photoSource = new V2VehiclePhotoSource(loader);

  // Limpa cache para testes limpos
  testCache.clear();

  // Teste de busca com teto de preço
  const resSearch = await stockSource.search({ tenantId: TENANT_A, agentId: AGENT_RAW }, { precoMax: 65000 });
  check("busca retorna itens compatíveis dentro do teto de preço", resSearch.items.length === 1 && resSearch.items[0].modelo === "Onix" && resSearch.items[0].preco === 60000);
  check("carro sem preço (103) foi filtrado da busca", !resSearch.items.some(i => i.vehicleKey.includes("103")));

  // Teste de excludeKeys
  const resExclude = await stockSource.search({ tenantId: TENANT_A, agentId: AGENT_RAW }, { excludeKeys: ["revendamais:101"] });
  check("excludeKeys impede repetição do veículo", !resExclude.items.some(i => i.vehicleKey === "revendamais:101") && resExclude.items.some(i => i.vehicleKey === "revendamais:102"));

  // Teste de busca estrita e ampla
  const resStrict = await stockSource.search({ tenantId: TENANT_A, agentId: AGENT_RAW }, { modelo: "Onix LTZ", broad: false });
  check("broad=false exige casamento de token de versão", resStrict.items.length === 1 && resStrict.items[0].vehicleKey === "revendamais:102");

  // Teste de carroceria unknown nunca casar com tipo SUV
  const resSuv = await stockSource.search({ tenantId: TENANT_A, agentId: AGENT_RAW }, { tipo: "suv" });
  check("unknown em carrocerias nunca atende buscas por tipo", resSuv.items.length === 0);
  const resPickup = await stockSource.search({ tenantId: TENANT_A, agentId: AGENT_RAW }, { tipo: "pickup", precoMax: 80000 });
  check("RevendaMais utilitario entra na busca pickup com teto", resPickup.items.length === 1 && resPickup.items[0].modelo === "Strada" && resPickup.items[0].preco === 76990);

  // Teste do resolvedor de fotos
  const photosRes = await photoSource.resolvePhotos({ tenantId: TENANT_A, agentId: AGENT_RAW }, "revendamais:101");
  check("resolvePhotos resolve IDs estáveis das fotos", photosRes.photoIds.length === 2 && !photosRes.ambiguous);

  const photoId = photosRes.photoIds[0];
  const urlsResolved = await photoSource.resolveUrls({ tenantId: TENANT_A, agentId: AGENT_RAW }, "revendamais:101", [photoId]);
  check("resolveUrls reconstrói URLs por hashes", urlsResolved.length === 1 && urlsResolved[0].includes("101_1.jpg"));

  // Teste de validação de URL de foto insegura
  const resMobi = await stockSource.search({ tenantId: TENANT_A, agentId: AGENT_RAW }, { modelo: "Mobi" });
  check("foto com URL insegura (HTTP) é descartada", resMobi.items.length === 1 && resMobi.items[0].photoIds === undefined);

  // 6. Teste de colisão de fingerprint sem chaves duplicadas no estoque
  const duplicateVehicles = [
    {
      make: "Fiat",
      base_model: "Mobi",
      model: "Mobi Like 1.0",
      year: 2021,
      price: 45000,
      color: "Preto",
      fuel: "Flex",
      gear: "Manual",
      category: "AUTOMÓVEL",
      body_type: "hatch",
      images_large: ["https://app.revendamais.com.br/img/mobi_1.jpg"]
    },
    {
      make: "Fiat",
      base_model: "Mobi",
      model: "Mobi Like 1.0",
      year: 2021,
      price: 45000,
      color: "Preto",
      fuel: "Flex",
      gear: "Manual",
      category: "AUTOMÓVEL",
      body_type: "hatch",
      images_large: ["https://app.revendamais.com.br/img/mobi_2.jpg"]
    }
  ];

  const transportMockDup = new FakeHttpTransport(async () => {
    return new Response(JSON.stringify({ vehicles: duplicateVehicles }), {
      headers: new Headers({ "content-type": "application/json" })
    });
  });

  const localHttpClientDup = new SafeHttpClient(dnsFake, transportMockDup, sleeperFake);
  const loaderDup = new V2StockLoader(gateway, cp, testCache, localHttpClientDup);
  const stockSourceDup = new V2StockSource(loaderDup);
  const photoSourceDup = new V2VehiclePhotoSource(loaderDup);

  testCache.clear();

  const resDup = await stockSourceDup.search({ tenantId: TENANT_A, agentId: AGENT_RAW }, {});
  check("colisão de fingerprint de-duplica e não gera ofertas duplicadas com a mesma chave", resDup.items.length === 1);

  const dupKey = resDup.items[0].vehicleKey;
  const photoDupRes = await photoSourceDup.resolvePhotos({ tenantId: TENANT_A, agentId: AGENT_RAW }, dupKey);
  check("veículo em colisão vira ambiguous e não dispara fotos", photoDupRes.ambiguous === true && photoDupRes.photoIds.length === 0);

  // 7. Teste de TenantCatalog dinâmico (sem marcas/modelos hardcoded)
  const catalog = buildTenantCatalog(resSearch.items);
  check("TenantCatalog dinâmico possui marcas corretas", catalog.entries.length === 1 && catalog.entries[0].brand === "Chevrolet" && catalog.entries[0].model === "Onix");


  // ============================================================================
  // TESTES ADVERSARIAIS F2.5.2B.2 - CORRECOES CODEX
  // ============================================================================
  console.log("\nF2.5.2B.2 correcoes Codex: catalogo, cache, decoder, loader e segredo local:");

  const agentGitignore = fs.readFileSync(path.resolve(".gitignore"), "utf8");
  const scratchScript = fs.readFileSync(path.resolve("scratch", "inspect_real_sources.mjs"), "utf8");
  check("scratch/ esta no .gitignore", /^scratch\/\s*$/m.test(agentGitignore));
  check("script de scratch foi redigido sem JWT", !scratchScript.includes("eyJ") && !scratchScript.includes("service_role") && scratchScript.includes("Redacted"));

  check("TenantCatalog aceita vehicleKey real provider:id", isVehicleKeyInCatalog(catalog, "revendamais:101"));
  check("TenantCatalog continua aceitando chave legada brand|model", isVehicleKeyInCatalog(catalog, "chevrolet|onix|2020"));

  expectThrowSync("decoder rejeita vehicle_id objeto", () => decodeNormalizedVehicle({
    vehicle_id: { id: 1 },
    make: "Ford",
    base_model: "Ka"
  }, "revendamais"), "vehicle_id must be a scalar id");
  expectThrowSync("decoder rejeita marca objeto", () => decodeNormalizedVehicle({
    vehicle_id: 1,
    make: { name: "Ford" },
    base_model: "Ka"
  }, "revendamais"), "markName must be a string");
  expectThrowSync("decoder rejeita modelo array", () => decodeNormalizedVehicle({
    vehicle_id: 1,
    make: "Ford",
    base_model: ["Ka"]
  }, "revendamais"), "modelName must be a string");
  const brNumberVehicle = decodeNormalizedVehicle({
    vehicle_id: "777",
    make: "VW",
    base_model: "Fox",
    year: "2021",
    mileage: "92.900",
    price: "R$ 70.990,00"
  }, "revendamais");
  check("decoder parseia numeros brasileiros sem transformar km em decimal", brNumberVehicle.km === 92900 && brNumberVehicle.saleValue === 70990);

  const strictPhotos = parseVehiclePhotos("revendamais:777", JSON.stringify([
    { Link: { href: "https://app.revendamais.com.br/img/a.jpg" }, Principal: "true" },
    { Link: "https://app.revendamais.com.br/img/b.jpg", Principal: true },
    { Link: "http://app.revendamais.com.br/img/c.jpg", Principal: "false" }
  ]));
  check("parseVehiclePhotos ignora URL nao-string e HTTP", strictPhotos.length === 1 && strictPhotos[0].url.endsWith("/img/b.jpg"));
  expectThrowSync("generatePhotoId rejeita URL invalida", () => generatePhotoId("revendamais:777", "http://app.revendamais.com.br/img/x.jpg"), "INVALID_PHOTO_URL");

  const raceCache = new ReadCache<string[]>(fakeClock, { enabled: true, ttlMs: 60000, maxItems: 10 });
  let resolveOld: (val: string[]) => void = () => {};
  const oldPending = new Promise<string[]>((resolve) => { resolveOld = resolve; });
  const firstRace = raceCache.getOrFetch("tenant-race", "revendamais", "stock", () => oldPending);
  raceCache.invalidate("tenant-race", "revendamais");
  let freshCalledBeforeOldFinished = false;
  const secondRace = raceCache.getOrFetch("tenant-race", "revendamais", "stock", async () => {
    freshCalledBeforeOldFinished = true;
    return ["fresh"];
  });
  const secondRaceValue = await secondRace;
  resolveOld(["stale"]);
  await firstRace;
  check("cache apos invalidate nao compartilha promise velha", freshCalledBeforeOldFinished && secondRaceValue[0] === "fresh");

  const raceCache2 = new ReadCache<string[]>(fakeClock, { enabled: true, ttlMs: 60000, maxItems: 10 });
  let resolveOld2: (val: string[]) => void = () => {};
  let resolveFresh2: (val: string[]) => void = () => {};
  const firstOld2 = raceCache2.getOrFetch("tenant-race2", "revendamais", "stock", () => new Promise<string[]>((resolve) => { resolveOld2 = resolve; }));
  raceCache2.invalidate("tenant-race2", "revendamais");
  let freshFetches2 = 0;
  const secondPending2 = raceCache2.getOrFetch("tenant-race2", "revendamais", "stock", () => {
    freshFetches2 += 1;
    return new Promise<string[]>((resolve) => { resolveFresh2 = resolve; });
  });
  resolveOld2(["stale"]);
  await firstOld2;
  const thirdPending2 = raceCache2.getOrFetch("tenant-race2", "revendamais", "stock", async () => {
    freshFetches2 += 1;
    return ["should-not-run"];
  });
  resolveFresh2(["fresh2"]);
  const values2 = await Promise.all([secondPending2, thirdPending2]);
  check("promise velha nao apaga voo novo pendente", freshFetches2 === 1 && values2[0][0] === "fresh2" && values2[1][0] === "fresh2");

  let mutableNow = Date.parse(NOW);
  const mutableClock: Clock = { now: () => new Date(mutableNow).toISOString() };
  const ttlCache = new ReadCache<string>(mutableClock, { enabled: true, ttlMs: 100, maxItems: 10 });
  let ttlCalls = 0;
  await ttlCache.getOrFetch("tenant-ttl", "revendamais", "stock", async () => { ttlCalls += 1; return "v1"; });
  await ttlCache.getOrFetch("tenant-ttl", "revendamais", "stock", async () => { ttlCalls += 1; return "v2"; });
  mutableNow += 101;
  const ttlValue = await ttlCache.getOrFetch("tenant-ttl", "revendamais", "stock", async () => { ttlCalls += 1; return "v3"; });
  check("cache respeita TTL", ttlCalls === 2 && ttlValue === "v3");

  const lruCache = new ReadCache<string>(mutableClock, { enabled: true, ttlMs: 10000, maxItems: 2 });
  let lruCalls = 0;
  await lruCache.getOrFetch("tenant-lru", "revendamais", "a", async () => { lruCalls += 1; return "a1"; });
  mutableNow += 1;
  await lruCache.getOrFetch("tenant-lru", "revendamais", "b", async () => { lruCalls += 1; return "b1"; });
  mutableNow += 1;
  await lruCache.getOrFetch("tenant-lru", "revendamais", "a", async () => { lruCalls += 1; return "a2"; });
  mutableNow += 1;
  await lruCache.getOrFetch("tenant-lru", "revendamais", "c", async () => { lruCalls += 1; return "c1"; });
  mutableNow += 1;
  const bAfterEvict = await lruCache.getOrFetch("tenant-lru", "revendamais", "b", async () => { lruCalls += 1; return "b2"; });
  check("cache faz LRU por chave", lruCalls === 4 && bAfterEvict === "b2");

  let timeoutCalls = 0;
  const timeoutClient = new SafeHttpClient(dnsFake, new FakeHttpTransport(async (_url, init) => {
    timeoutCalls += 1;
    await new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    return new Response("{}", { headers: new Headers({ "content-type": "application/json" }) });
  }), sleeperFake);
  await expectThrow("safeFetch timeout sanitizado", () => timeoutClient.safeFetch("https://app.revendamais.com.br/feed", { provider: "revendamais", timeoutMs: 1, maxRetries: 0 }), "SAFE_FETCH_FAILURE: TIMEOUT");
  check("timeout tentou uma vez sem retry extra", timeoutCalls === 1);

  let getRetryCalls = 0;
  const retryGetClient = new SafeHttpClient(dnsFake, new FakeHttpTransport(async () => {
    getRetryCalls += 1;
    if (getRetryCalls === 1) throw new Error("network down");
    return new Response("{}", { headers: new Headers({ "content-type": "application/json" }) });
  }), sleeperFake);
  await retryGetClient.safeFetch("https://app.revendamais.com.br/feed", { provider: "revendamais", maxRetries: 1 });
  check("safeFetch retry so para GET", getRetryCalls === 2);
  let postRetryCalls = 0;
  const retryPostClient = new SafeHttpClient(dnsFake, new FakeHttpTransport(async () => {
    postRetryCalls += 1;
    throw new Error("network down");
  }), sleeperFake);
  await expectThrow("safeFetch POST nao faz retry", () => retryPostClient.safeFetch("https://api-estoque.azurewebsites.net/graphql", { provider: "bndv", method: "POST", body: "{}", maxRetries: 3 }), "SAFE_FETCH_FAILURE: NETWORK_ERROR");
  check("POST falhou sem retry", postRetryCalls === 1);

  const noAgentGateway = new FakeV2ReadGateway({ agents: [], funnels: [], integrationsByTenant: { [TENANT_A]: [RM] } });
  const noAgentCred = new FakeCredentialProvider({
    "int-rm": { tenantId: TENANT_A, provider: "revendamais", material: JSON.stringify({ feed_url: "https://app.revendamais.com.br/feed" }) }
  });
  let noAgentFetches = 0;
  const noAgentLoader = new V2StockLoader(noAgentGateway, noAgentCred, new ReadCache<NormalizedVehicle[]>(fakeClock, { enabled: true, ttlMs: 60000, maxItems: 10 }), new SafeHttpClient(dnsFake, new FakeHttpTransport(async () => {
    noAgentFetches += 1;
    return new Response(JSON.stringify({ vehicles: mockVehicles }), { headers: new Headers({ "content-type": "application/json" }) });
  }), sleeperFake));
  const noAgentVehicles = await noAgentLoader.loadAll({ tenantId: TENANT_A, agentId: "agent-inexistente" });
  check("StockLoader nao resolve credencial nem fetch sem agente dono", noAgentVehicles.length === 0 && noAgentCred.resolveCount === 0 && noAgentFetches === 0);

  const duplicateProviderLoader = new V2StockLoader(new FakeV2ReadGateway({
    agents: [agent({ id: AGENT_RAW, tenantId: TENANT_A })],
    funnels: [],
    integrationsByTenant: { [TENANT_A]: [RM, { ...RM, id: "int-rm-dup" }] }
  }), cp, new ReadCache<NormalizedVehicle[]>(fakeClock, { enabled: true, ttlMs: 60000, maxItems: 10 }), localHttpClient);
  await expectThrow("StockLoader falha fechado com provider duplicado", () => duplicateProviderLoader.loadAll({ tenantId: TENANT_A, agentId: AGENT_RAW }), "STOCK_METADATA_DUPLICATE_PROVIDER");


  // ============================================================================
  // TESTES F2.5.2C - CRM READ-ONLY E QUERY RUNNER
  // ============================================================================
  console.log("\nF2.5.2C CRM read-only e QueryRunner:");

  const crmLeadA: OwnedCrmLeadRow = {
    id: LEAD_A,
    tenantId: TENANT_A,
    agentId: AGENT_RAW,
    leadName: "Carlos Cliente",
    clientName: "Nome backup",
    vehicleInterest: "Onix",
    stage: "discovery",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const crmLeadOtherAgent: OwnedCrmLeadRow = {
    ...crmLeadA,
    id: LEAD_B,
    agentId: AGENT_FUNNEL,
    leadName: "Lead Outro Agente",
  };
  const crmGateway = new FakeV2ReadGateway({
    ...seedBoth,
    crmLeads: [crmLeadA, crmLeadOtherAgent],
  });
  const crmSource = new V2CrmReadSource(crmGateway);

  const crmOk = await crmSource.readLead({ tenantId: TENANT_A, agentId: AGENT_RAW }, LEAD_A);
  check("CRM read retorna resumo seguro do lead", crmOk?.leadId === LEAD_A && crmOk.name === "Carlos Cliente" && crmOk.vehicleInterest === "Onix");
  check("CRM read nao expoe cpf/birth_date", !containsValue(crmOk, "cpf") && !containsValue(crmOk, "birth_date") && findForbiddenKey(crmOk, ["cpf", "birth_date"]) === null);
  const crmCrossTenant = await crmSource.readLead({ tenantId: TENANT_B, agentId: AGENT_RAW }, LEAD_A);
  check("CRM cross-tenant falha fechado como null", crmCrossTenant === null);
  const crmCrossAgent = await crmSource.readLead({ tenantId: TENANT_A, agentId: AGENT_RAW }, LEAD_B);
  check("CRM cross-agent falha fechado como null", crmCrossAgent === null);
  await expectThrow("CRM rejeita leadId que nao e UUID", () => crmSource.readLead({ tenantId: TENANT_A, agentId: AGENT_RAW }, "telefone-551199"), "CRM_LEAD_ID_INVALID");

  const lyingCrmGateway: V2ReadGateway = {
    async getOwnedAgent(ref) { return agent({ id: ref.agentId, tenantId: ref.tenantId }); },
    async getOwnedFunnelConfig() { return null; },
    async getOwnedCrmLead() { return { ...crmLeadA, tenantId: TENANT_B }; },
    async listActiveStockIntegrationMetadata() { return []; },
  };
  await expectThrow("CRM source rejeita gateway mentiroso", () => new V2CrmReadSource(lyingCrmGateway).readLead({ tenantId: TENANT_A, agentId: AGENT_RAW }, LEAD_A), "CRM_OWNERSHIP_MISMATCH");

  testCache.clear();
  const queryRunner = createReadQueryRunner({ tenantId: TENANT_A, agentId: AGENT_RAW }, {
    stock: stockSource,
    vehicleDetails: stockSource,
    vehiclePhotos: photoSource,
    crm: crmSource,
  });

  const qrStock = await queryRunner({ tool: "stock_search", input: { precoMax: 65000 } });
  check("QueryRunner stock_search retorna QueryResult tipado", qrStock.ok && qrStock.tool === "stock_search" && qrStock.data.items.length === 1 && qrStock.source === "read-side:stock");
  const qrDetails = await queryRunner({ tool: "vehicle_details", input: { vehicleKey: "revendamais:101" } });
  check("QueryRunner vehicle_details retorna veiculo aterrado", qrDetails.ok && qrDetails.tool === "vehicle_details" && qrDetails.data.vehicle.vehicleKey === "revendamais:101");
  const qrDetailsMissing = await queryRunner({ tool: "vehicle_details", input: { vehicleKey: "revendamais:nao-existe" } });
  check("QueryRunner vehicle_details ausente vira NOT_FOUND", !qrDetailsMissing.ok && qrDetailsMissing.tool === "vehicle_details" && qrDetailsMissing.error.code === "NOT_FOUND");
  const qrPhotosInvalid = await queryRunner({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "lead", key: LEAD_A } } });
  check("QueryRunner photos com ref nao-veiculo vira VALIDATION", !qrPhotosInvalid.ok && qrPhotosInvalid.tool === "vehicle_photos_resolve" && qrPhotosInvalid.error.code === "VALIDATION");
  const qrPhotos = await queryRunner({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: "revendamais:101" } } });
  check("QueryRunner vehicle_photos_resolve retorna ids", qrPhotos.ok && qrPhotos.tool === "vehicle_photos_resolve" && qrPhotos.data.photoIds.length === 2);
  const qrCrm = await queryRunner({ tool: "crm_read", input: { leadId: LEAD_A } });
  check("QueryRunner crm_read retorna somente leadId/name", qrCrm.ok && qrCrm.tool === "crm_read" && Object.keys(qrCrm.data).sort().join(",") === "leadId,name" && qrCrm.data.name === "Carlos Cliente");
  const qrCrmMissing = await queryRunner({ tool: "crm_read", input: { leadId: "123e4567-e89b-42d3-a456-426614174099" } });
  check("QueryRunner crm_read ausente vira NOT_FOUND", !qrCrmMissing.ok && qrCrmMissing.tool === "crm_read" && qrCrmMissing.error.code === "NOT_FOUND");
  const qrCrmInvalid = await queryRunner({ tool: "crm_read", input: { leadId: "lead-sem-uuid" } });
  check("QueryRunner crm_read invalido vira VALIDATION", !qrCrmInvalid.ok && qrCrmInvalid.tool === "crm_read" && qrCrmInvalid.error.code === "VALIDATION");

  const throwingQueryRunner = createReadQueryRunner({ tenantId: TENANT_A, agentId: AGENT_RAW }, {
    stock: { async search() { throw new Error("SECRET-CANARY-UPSTREAM"); } },
    vehicleDetails: { async getDetails() { throw new Error("SECRET-CANARY-UPSTREAM"); } },
    vehiclePhotos: { async resolvePhotos() { throw new Error("SECRET-CANARY-UPSTREAM"); }, async resolveUrls() { return []; } },
    crm: { async readLead() { throw new Error("SECRET-CANARY-UPSTREAM"); } },
  });
  const qrUpstream = await throwingQueryRunner({ tool: "stock_search", input: {} });
  check("QueryRunner sanitiza erro upstream", !qrUpstream.ok && qrUpstream.error.code === "UPSTREAM" && !JSON.stringify(qrUpstream).includes("SECRET-CANARY"));


  // ============================================================================
  // TESTES F2.5.3 - ADAPTERS V2 READ-ONLY POR CONTRATO DE BANCO INJETAVEL
  // ============================================================================
  console.log("\nF2.5.3 adapters V2 read-only gated:");

  const liveDb = new RecordingV2ReadDatabase({
    wa_ai_agents: [{
      id: AGENT_RAW,
      user_id: TENANT_A,
      instance_id: null,
      name: "Aloan",
      system_prompt: "Prompt cru seguro",
      use_funnel_config: false,
      company_name: "",
      model: "gpt-4.1-mini",
      temperature: 0.5,
      sdr_goal: "agendar visita",
      qualification_questions: ["modelo", "pagamento"],
      sells_motorcycles: false,
      blocked_categories: [],
      rag_restricted: false,
      is_active: true,
      updated_at: NOW,
    }],
    agent_funnel_config: [],
    platform_integrations: [{
      id: "int-rm-db",
      user_id: TENANT_A,
      platform: "revendamais",
      api_key_encrypted: "ENCRYPTED-CANARY-SECRET",
      is_active: true,
      updated_at: NOW,
    }],
    ai_crm_leads: [{
      id: LEAD_A,
      user_id: TENANT_A,
      agent_id: AGENT_RAW,
      lead_name: "Carlos Banco",
      client_name: "Backup Banco",
      vehicle_interest: "Onix",
      stage: "discovery",
      created_at: NOW,
      updated_at: NOW,
      cpf: "CPF-CANARY-SHOULD-NOT-SELECT",
      birth_date: "BIRTH-CANARY-SHOULD-NOT-SELECT",
    }],
  });
  const dbGateway = new V2DatabaseReadGateway(liveDb);
  const dbConfigSource = new V2TenantConfigSource(dbGateway);
  const dbConfig = await dbConfigSource.load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("V2DatabaseReadGateway carrega config por tenant+agent", dbConfig.ok && dbConfig.config.agentId === AGENT_RAW && dbConfig.config.stockSecretRef?.integrationId === "int-rm-db", JSON.stringify(dbConfig));
  check("adapter de metadata nao seleciona api_key_encrypted", liveDb.calls.some((c) => c.table === "platform_integrations" && c.op === "many" && !c.columns.map(String).includes("api_key_encrypted")), JSON.stringify(liveDb.calls));
  check("config via adapter real nao contem segredo criptografado", !containsValue(dbConfig, "ENCRYPTED-CANARY-SECRET") && findForbiddenKey(dbConfig, SECRET_KEY_DENYLIST) === null, JSON.stringify(dbConfig));
  const dbAgentCrossTenant = await dbGateway.getOwnedAgent({ tenantId: TENANT_B, agentId: AGENT_RAW });
  check("adapter de banco nao acha agente cross-tenant", dbAgentCrossTenant === null);

  const dbCrm = await dbGateway.getOwnedCrmLead({ tenantId: TENANT_A, agentId: AGENT_RAW }, LEAD_A);
  const crmDbCall = liveDb.calls.find((c) => c.table === "ai_crm_leads");
  check("adapter CRM seleciona colunas seguras", !!crmDbCall && !crmDbCall.columns.map(String).includes("cpf") && !crmDbCall.columns.map(String).includes("birth_date"), JSON.stringify(crmDbCall));
  check("adapter CRM nao expoe cpf/birth_date mesmo se row tiver", dbCrm?.leadName === "Carlos Banco" && !containsValue(dbCrm, "CPF-CANARY") && !containsValue(dbCrm, "BIRTH-CANARY"), JSON.stringify(dbCrm));

  let decryptCalls = 0;
  const decryptor: SecretDecryptor = {
    async decryptApiKey(ciphertext, context) {
      decryptCalls += 1;
      check("decryptor recebe contexto minimo correto", ciphertext === "ENCRYPTED-CANARY-SECRET" && context.tenantId === TENANT_A && context.integrationId === "int-rm-db" && context.provider === "revendamais", JSON.stringify(context));
      return JSON.stringify({ feed_url: "https://app.revendamais.com.br/feed.json" });
    },
  };
  const dbCredentialProvider = new V2DatabaseCredentialProvider(liveDb, decryptor);
  const secretOk = await dbCredentialProvider.resolve(makeSecretRef({ tenantId: TENANT_A, integrationId: "int-rm-db", provider: "revendamais", purpose: "stock_feed" }));
  check("CredentialProvider de banco resolve segredo so no ponto de uso", secretOk.ok && secretOk.secret.material.includes("feed.json") && decryptCalls === 1, JSON.stringify(secretOk));
  const secretMismatch = await dbCredentialProvider.resolve(makeSecretRef({ tenantId: TENANT_A, integrationId: "int-rm-db", provider: "bndv", purpose: "stock_feed" }));
  check("CredentialProvider falha fechado em provider mismatch sem decrypt extra", !secretMismatch.ok && secretMismatch.error === "SECRET_PROVIDER_MISMATCH" && decryptCalls === 1, JSON.stringify(secretMismatch));
  const secretCrossTenant = await dbCredentialProvider.resolve(makeSecretRef({ tenantId: TENANT_B, integrationId: "int-rm-db", provider: "revendamais", purpose: "stock_feed" }));
  check("CredentialProvider falha fechado em cross-tenant", !secretCrossTenant.ok && secretCrossTenant.error === "SECRET_NOT_FOUND", JSON.stringify(secretCrossTenant));

  const failingDbSource = new V2TenantConfigSource(new V2DatabaseReadGateway(new RecordingV2ReadDatabase({}, "SECRET-CANARY-DB-ERROR")));
  const failingDbConfig = await failingDbSource.load({ tenantId: TENANT_A, agentId: AGENT_RAW });
  check("falha de banco vira READ_SOURCE_FAILURE sanitizado", isErr(failingDbConfig, "READ_SOURCE_FAILURE") && !containsValue(failingDbConfig, "SECRET-CANARY-DB-ERROR"), JSON.stringify(failingDbConfig));
  console.log(`\nREAD-SIDE COMPLETO: ${ok} OK | ${failed} FALHA`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
