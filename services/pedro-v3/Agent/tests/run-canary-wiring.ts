// run-canary-wiring.ts — F2.5.4A / A.1
//
// Testes da infraestrutura segura de wiring read-only ao Supabase + canary shadow.
// SEM rede real, SEM Supabase remoto, SEM credencial real, SEM efeito externo.
// O transporte HTTP é um FAKE injetável (PostgREST simulado) — NÃO houve integração remota.

import {
  SupabaseReadOnlyDatabase,
} from "../src/adapters/read/supabase-read-database.ts";
import { V2PlaintextApiKeyReader } from "../src/adapters/read/v2-api-key-reader.ts";
import {
  CanaryShadowRoot,
  assertCanaryGateShadow,
} from "../src/engine/canary-shadow-root.ts";
import { InMemoryEffectGate } from "../src/engine/effect-gate.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import type { HttpTransport } from "../src/adapters/read/http-client.ts";
import type { V2ColumnName, V2TableName } from "../src/adapters/read/supabase-v2-read-adapter.ts";
import type { ProposedDecision, TenantCatalog } from "../src/domain/decision.ts";
import type {
  ComposeModelRequest,
  InterpretModelRequest,
  ProposeModelRequest,
  StructuredConversationModel,
} from "../src/domain/conversation-model.ts";
import { CatalogClaimExtractor, type TenantCatalogSource } from "../src/engine/turn-context-preparer.ts";

let ok = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { ok += 1; console.log(`  OK  ${name}`); }
  else { failed += 1; console.error(`  RED ${name}${detail ? `: ${detail}` : ""}`); }
}
async function expectThrow(name: string, fn: () => Promise<unknown> | unknown, contains: string): Promise<void> {
  try { await fn(); check(name, false, "deveria lançar"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(name, m.includes(contains), m); }
}

const NOW = "2026-06-28T00:00:00.000Z";
const HOST = "test.supabase.co";
const URL_OK = `https://${HOST}`;
const FAKE_KEY = "test-anon-key-NOT-REAL";
const TENANT_A = "tenant-canary-a";
const TENANT_B = "tenant-canary-b";
const AGENT_A = "agent-canary-a";
const LEAD_UUID = "11111111-1111-4111-8111-111111111111";
const SECRET_CANARY = "PLAINTEXT-SECRET-CANARY";

// PostgREST simulado: filtra linhas por `col=eq.val` da URL (como RLS+filtro do servidor).
class FakeSupabaseTransport implements HttpTransport {
  readonly calls: string[] = [];
  constructor(private readonly tables: Record<string, Record<string, unknown>[]>) {}
  async fetch(url: string): Promise<Response> {
    this.calls.push(url);
    const u = new URL(url);
    const table = u.pathname.split("/").pop() ?? "";
    const rows = this.tables[table] ?? [];
    const filters: Array<[string, string]> = [];
    let limit: number | null = null;
    for (const [k, v] of u.searchParams.entries()) {
      if (k === "select") continue;
      if (k === "limit") { limit = Number(v); continue; }
      const m = /^eq\.(.*)$/s.exec(v);
      if (m) filters.push([k, m[1]]);
    }
    let matched = rows.filter((r) => filters.every(([col, val]) => String(r[col]) === val));
    if (limit !== null) matched = matched.slice(0, limit);
    return new Response(JSON.stringify(matched), { status: 200, headers: { "content-type": "application/json" } });
  }
}

class RecordingStructuredModel implements StructuredConversationModel {
  readonly interpretCalls: InterpretModelRequest[] = [];
  readonly proposeCalls: ProposeModelRequest[] = [];
  readonly composeCalls: ComposeModelRequest[] = [];
  interpretationOutput: unknown = { relation: "ambiguous", intentSummary: "saudacao" };
  proposalSteps: unknown[] = [];
  composeOutput: unknown = { parts: [{ type: "text", content: "Ola, posso ajudar?" }] };
  interpretError: Error | null = null;
  proposeError: Error | null = null;
  composeError: Error | null = null;

  async interpret(request: InterpretModelRequest): Promise<unknown> {
    this.interpretCalls.push(request);
    return this.interpretationOutput;
  }

  async propose(request: ProposeModelRequest): Promise<unknown> {
    this.proposeCalls.push(request);
    if (this.proposalSteps.length === 0) throw new Error("FAKE_MODEL_SCRIPT_EXHAUSTED");
    return this.proposalSteps.shift();
  }

  async compose(request: ComposeModelRequest): Promise<unknown> {
    this.composeCalls.push(request);
    return this.composeOutput;
  }
}

class StaticCatalogSource implements TenantCatalogSource {
  readonly refs: Array<{ tenantId: string; agentId: string }> = [];
  constructor(private readonly catalog: TenantCatalog) {}
  async loadCatalog(ref: { tenantId: string; agentId: string }): Promise<TenantCatalog> {
    this.refs.push({ ...ref });
    return structuredClone(this.catalog);
  }
}
function makeDb(transport: HttpTransport, over: Partial<{ url: string; apiKey: string; allowedHosts: readonly string[]; maxResponseBytes: number; timeoutMs: number }> = {}): SupabaseReadOnlyDatabase {
  return SupabaseReadOnlyDatabase.create(
    { url: over.url ?? URL_OK, apiKey: over.apiKey ?? FAKE_KEY, allowedHosts: over.allowedHosts ?? [HOST], maxResponseBytes: over.maxResponseBytes, timeoutMs: over.timeoutMs },
    transport,
  );
}

const agentRow = {
  id: AGENT_A, user_id: TENANT_A, instance_id: null, name: "Aloan",
  system_prompt: "Você é o Aloan.", use_funnel_config: false, company_name: "",
  model: "gpt-4.1-mini", temperature: 0.5, sdr_goal: "agendar", qualification_questions: [] as string[],
  sells_motorcycles: false, blocked_categories: [] as string[], rag_restricted: false, is_active: true, updated_at: NOW,
  evil_extra: "EXTRA-FIELD-LEAK", // campo extra que o servidor poderia mandar — deve ser projetado fora
};
const agentInactive = { ...agentRow, id: "agent-inactive", is_active: false };
const agentEmptyPrompt = { ...agentRow, id: "agent-emptyprompt", system_prompt: "" };
const integrationRow = { id: "int-rm", user_id: TENANT_A, platform: "revendamais", is_active: true, updated_at: NOW, api_key_encrypted: SECRET_CANARY };
const waInstanceRow = { id: "wa-inst-canary", user_id: TENANT_A, instance_name: "pilot", api_url: "https://api.uazapi.example", provider: "uazapi", api_key_encrypted: SECRET_CANARY, api_key: "ALT-SECRET-CANARY" };
const leadRow = { id: LEAD_UUID, user_id: TENANT_A, agent_id: AGENT_A, lead_name: "Cliente Canary", client_name: null, vehicle_interest: "SUV", stage: "novo", created_at: NOW, updated_at: NOW };

function freshSeed(): Record<string, Record<string, unknown>[]> {
  return {
    wa_ai_agents: [{ ...agentRow }, { ...agentInactive }, { ...agentEmptyPrompt }],
    platform_integrations: [{ ...integrationRow }],
    wa_instances: [{ ...waInstanceRow }, { ...waInstanceRow, id: "wa-inst-other", user_id: TENANT_B }],
    ai_crm_leads: [{ ...leadRow }],
    agent_funnel_config: [],
  };
}

async function main(): Promise<void> {
  console.log("F2.5.4A/A.1/A.2/B canary/supabase wiring (transporte PostgREST FAKE):");

  // ── Validação de config ───────────────────────────────────────────────────
  check("config HTTPS válida cria ok", (() => { try { makeDb(new FakeSupabaseTransport(freshSeed())); return true; } catch { return false; } })());
  await expectThrow("config http:// rejeitada (HTTPS obrigatório)", () => makeDb(new FakeSupabaseTransport({}), { url: "http://test.supabase.co" }), "SUPABASE_URL_NOT_HTTPS");
  await expectThrow("config host fora da allowlist rejeitada", () => makeDb(new FakeSupabaseTransport({}), { url: "https://evil.example.com" }), "SUPABASE_HOST_NOT_ALLOWED");
  await expectThrow("config sem chave falha fechado", () => makeDb(new FakeSupabaseTransport({}), { apiKey: "" }), "SUPABASE_KEY_MISSING");

  const transport = new FakeSupabaseTransport(freshSeed());
  const db = makeDb(transport);

  // ── Wrapper read-only concreto (transporte fake) ───────────────────────────
  {
    const row = await db.selectOne("wa_ai_agents", ["id", "user_id", "name"], { id: AGENT_A, user_id: TENANT_A });
    check("select permitido funciona", row?.id === AGENT_A && row?.user_id === TENANT_A, JSON.stringify(row));
  }
  {
    const legacyFunnel: HttpTransport = {
      async fetch(url) {
        const select = new URL(url).searchParams.get("select") ?? "";
        if (select.includes("tenant_policies")) {
          return new Response(JSON.stringify({ code: "42703", message: "column agent_funnel_config.tenant_policies does not exist" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify([{
          agent_id: AGENT_A,
          user_id: TENANT_A,
          generated_system_prompt: "prompt legado",
          updated_at: NOW,
        }]), { status: 200, headers: { "content-type": "application/json" } });
      },
    };
    const legacyDb = makeDb(legacyFunnel);
    const row = await legacyDb.selectOne("agent_funnel_config", ["agent_id", "user_id", "generated_system_prompt", "tenant_policies", "updated_at"], {
      agent_id: AGENT_A,
      user_id: TENANT_A,
    });
    check("funil legado sem tenant_policies continua carregando o prompt", row?.generated_system_prompt === "prompt legado" && !Object.prototype.hasOwnProperty.call(row ?? {}, "tenant_policies"));
  }
  await expectThrow("tabela não permitida é rejeitada", () => db.selectMany("secrets_table" as V2TableName, ["id"], { user_id: TENANT_A }), "SUPABASE_READ_FAILURE");
  await expectThrow("coluna não permitida é rejeitada", () => db.selectMany("wa_ai_agents", ["password" as V2ColumnName], { user_id: TENANT_A }), "SUPABASE_READ_FAILURE");
  await expectThrow("ausência de filtro de tenant falha", () => db.selectOne("wa_ai_agents", ["id"], { id: AGENT_A } as Record<string, string>), "SUPABASE_READ_FAILURE");
  {
    const anyDb = db as unknown as Record<string, unknown>;
    const noWrite = ["insert", "update", "delete", "upsert", "rpc", "post", "patch"].every((m) => typeof anyDb[m] === "undefined");
    check("escrita é impossível pelo contrato (sem insert/update/delete/upsert/rpc)", noWrite);
  }

  // ── A.1 #1..#8 — matriz estrita por tabela/operação/colunas/filtros ─────────
  await expectThrow("(1) selectMany de api_key_encrypted é bloqueado", () => db.selectMany("platform_integrations", ["id", "user_id", "api_key_encrypted"], { user_id: TENANT_A, is_active: true }), "SUPABASE_READ_FAILURE");
  await expectThrow("(2) segredo sem filtro id é bloqueado", () => db.selectOne("platform_integrations", ["id", "user_id", "platform", "api_key_encrypted", "is_active"], { user_id: TENANT_A, is_active: true }), "SUPABASE_READ_FAILURE");
  await expectThrow("(3) segredo sem is_active=true é bloqueado", () => db.selectOne("platform_integrations", ["id", "user_id", "platform", "api_key_encrypted", "is_active"], { id: "int-rm", user_id: TENANT_A, is_active: false }), "SUPABASE_READ_FAILURE");
  await expectThrow("(4) segredo de outra tabela é bloqueado", () => db.selectOne("wa_ai_agents", ["id", "user_id", "api_key_encrypted" as V2ColumnName], { id: AGENT_A, user_id: TENANT_A }), "SUPABASE_READ_FAILURE");
  {
    const meta = await db.selectMany("platform_integrations", ["id", "user_id", "platform", "is_active", "updated_at"], { user_id: TENANT_A, is_active: true });
    const noSecret = meta.length === 1 && !("api_key_encrypted" in meta[0]) && !JSON.stringify(meta).includes(SECRET_CANARY);
    check("(5) metadata funciona sem selecionar segredo", noSecret, JSON.stringify(meta));
  }
  await expectThrow("(6) CRM sem agent_id é bloqueado", () => db.selectOne("ai_crm_leads", ["id", "user_id", "lead_name"], { id: LEAD_UUID, user_id: TENANT_A }), "SUPABASE_READ_FAILURE");
  await expectThrow("(7) funil sem agent_id é bloqueado", () => db.selectOne("agent_funnel_config", ["agent_id", "user_id", "generated_system_prompt"], { user_id: TENANT_A }), "SUPABASE_READ_FAILURE");
  await expectThrow("(8) agente sem id é bloqueado", () => db.selectOne("wa_ai_agents", ["id", "user_id", "name"], { user_id: TENANT_A }), "SUPABASE_READ_FAILURE");

  // (secret válido continua possível pela projeção correta)
  {
    const secret = await db.selectOne("platform_integrations", ["id", "user_id", "platform", "api_key_encrypted", "is_active"], { id: "int-rm", user_id: TENANT_A, is_active: true });
    check("secret válido (id+user_id+is_active) é permitido só em selectOne", secret?.api_key_encrypted === SECRET_CANARY, JSON.stringify(secret));
  }

  // F2.6E — wa_instances: metadata separada de token e segredo sempre por id+tenant.
  {
    const meta = await db.selectOne("wa_instances", ["id", "user_id", "instance_name", "api_url", "provider"], { id: "wa-inst-canary", user_id: TENANT_A });
    const clean = meta?.id === "wa-inst-canary" && meta.user_id === TENANT_A && meta.provider === "uazapi" && !("api_key" in meta) && !("api_key_encrypted" in meta) && !JSON.stringify(meta).includes(SECRET_CANARY);
    check("(8a) wa_instances metadata funciona sem vazar token", clean, JSON.stringify(meta));
  }
  await expectThrow("(8b) wa_instances selectMany de api_key é bloqueado", () => db.selectMany("wa_instances", ["id", "user_id", "api_key"], { user_id: TENANT_A }), "SUPABASE_READ_FAILURE");
  await expectThrow("(8c) wa_instances segredo sem filtro id é bloqueado", () => db.selectOne("wa_instances", ["id", "user_id", "provider", "api_key_encrypted", "api_key"], { user_id: TENANT_A }), "SUPABASE_READ_FAILURE");
  await expectThrow("(8d) wa_instances segredo sem filtro user_id é bloqueado", () => db.selectOne("wa_instances", ["id", "user_id", "provider", "api_key_encrypted", "api_key"], { id: "wa-inst-canary" } as Record<string, string>), "SUPABASE_READ_FAILURE");
  {
    const secret = await db.selectOne("wa_instances", ["id", "user_id", "provider", "api_key_encrypted", "api_key"], { id: "wa-inst-canary", user_id: TENANT_A });
    const scoped = secret?.id === "wa-inst-canary" && secret.user_id === TENANT_A && secret.provider === "uazapi" && secret.api_key_encrypted === SECRET_CANARY && secret.api_key === "ALT-SECRET-CANARY";
    check("(8e) wa_instances token só é permitido em selectOne por id+tenant", scoped, JSON.stringify(secret));
  }
  // ── A.1 #9 — projeção local descarta campos extras ─────────────────────────
  {
    const row = await db.selectOne("wa_ai_agents", ["id", "user_id", "name"], { id: AGENT_A, user_id: TENANT_A });
    const onlyRequested = row !== null && Object.keys(row).every((k) => ["id", "user_id", "name"].includes(k));
    check("(9) resposta com campos extras é projetada (sem vazar extra)", onlyRequested && !("evil_extra" in (row ?? {})), JSON.stringify(row));
  }

  // ── A.1 #10 — linha malformada rejeita tudo (atômico) ──────────────────────
  {
    const malformed: HttpTransport = { async fetch() { return new Response(JSON.stringify([{ id: AGENT_A, user_id: TENANT_A, name: "x" }, "linha-ruim"]), { status: 200, headers: { "content-type": "application/json" } }); } };
    const dbMal = makeDb(malformed);
    await expectThrow("(10) uma linha malformada rejeita toda a resposta", () => dbMal.selectMany("platform_integrations", ["id", "user_id", "is_active"], { user_id: TENANT_A, is_active: true }), "SUPABASE_READ_FAILURE");
  }

  // ── A.1 #11 — corpo maior que o limite SEM content-length é rejeitado ──────
  {
    const big = JSON.stringify([{ id: "x", user_id: TENANT_A, platform: "revendamais", is_active: true, updated_at: "y".repeat(2000) }]);
    const streamTransport: HttpTransport = {
      async fetch() {
        const enc = new TextEncoder().encode(big);
        const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc); c.close(); } });
        return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
      },
    };
    const dbSmall = makeDb(streamTransport, { maxResponseBytes: 64 });
    await expectThrow("(11) corpo > limite sem content-length é rejeitado (stream)", () => dbSmall.selectMany("platform_integrations", ["id", "user_id", "is_active"], { user_id: TENANT_A, is_active: true }), "SUPABASE_READ_FAILURE");
    // variante: com content-length presente também é rejeitado
    const dbSmall2 = makeDb(new FakeSupabaseTransport({ platform_integrations: [{ id: "x", user_id: TENANT_A, platform: "revendamais", is_active: true, updated_at: "z".repeat(2000) }] }), { maxResponseBytes: 64 });
    await expectThrow("(11b) corpo > limite com content-length é rejeitado", () => dbSmall2.selectMany("platform_integrations", ["id", "user_id", "is_active"], { user_id: TENANT_A, is_active: true }), "SUPABASE_READ_FAILURE");
  }

  // ── A.2 — deadline cobre o corpo inteiro e cancela stream travado ──────────────
  {
    let cancelled = false;
    const stalledTransport: HttpTransport = {
      async fetch() {
        const stream = new ReadableStream<Uint8Array>({
          start() { /* headers chegam, corpo nunca produz bytes */ },
          cancel() { cancelled = true; return new Promise<void>(() => undefined); },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
      },
    };
    const stalledDb = makeDb(stalledTransport, { timeoutMs: 25 });
    const startedAt = Date.now();
    const outcome = await Promise.race([
      stalledDb
        .selectOne("wa_ai_agents", ["id", "user_id"], { id: AGENT_A, user_id: TENANT_A })
        .then(() => "UNEXPECTED_SUCCESS")
        .catch((error: unknown) => error instanceof Error ? error.message : String(error)),
      new Promise<string>((resolve) => setTimeout(() => resolve("TEST_WATCHDOG_TIMEOUT"), 750)),
    ]);
    const elapsedMs = Date.now() - startedAt;
    check("(A.2) timeout cobre stream travado e retorna erro sanitizado", outcome === "SUPABASE_READ_FAILURE" && elapsedMs < 750, JSON.stringify({ outcome, elapsedMs }));
    check("(A.2) timeout cancela o reader do corpo", cancelled, JSON.stringify({ cancelled }));
  }
  // erro do Supabase não vaza URL/token/segredo
  {
    const leakUrl = `${URL_OK}/rest/v1/wa_ai_agents?apikey=${FAKE_KEY}`;
    const throwing: HttpTransport = { async fetch() { throw new Error(`connect failed ${leakUrl} token=${FAKE_KEY}`); } };
    const status500: HttpTransport = { async fetch() { return new Response(`{"token":"${FAKE_KEY}","url":"${leakUrl}"}`, { status: 500, headers: { "content-type": "application/json" } }); } };
    let m1 = "", m2 = "";
    try { await makeDb(throwing).selectOne("wa_ai_agents", ["id", "user_id"], { id: AGENT_A, user_id: TENANT_A }); } catch (e) { m1 = e instanceof Error ? e.message : String(e); }
    try { await makeDb(status500).selectOne("wa_ai_agents", ["id", "user_id"], { id: AGENT_A, user_id: TENANT_A }); } catch (e) { m2 = e instanceof Error ? e.message : String(e); }
    check("exceção do transporte é sanitizada", m1 === "SUPABASE_READ_FAILURE" && !m1.includes(FAKE_KEY) && !m1.includes(HOST), m1);
    check("status 500 sanitizado sem vazar token/url", m2 === "SUPABASE_READ_FAILURE" && !m2.includes(FAKE_KEY) && !m2.includes(URL_OK), m2);
  }

  // ── A.1 #12 — chave não recuperável por API pública ────────────────────────
  {
    const serialized = JSON.stringify(db);
    const anyDb = db as unknown as Record<string, unknown>;
    const noPublicHeaders = typeof anyDb.authHeaders === "undefined";
    const noEnumKey = Object.keys(db).every((k) => !String(anyDb[k]).includes(FAKE_KEY));
    const noBracketPrivate = typeof anyDb["#apiKey"] === "undefined";
    check("(12) chave não aparece em JSON.stringify", !serialized.includes(FAKE_KEY), serialized);
    check("(12) sem método público authHeaders", noPublicHeaders);
    check("(12) chave não acessível por campo público/bracket", noEnumKey && noBracketPrivate);
    check("(12) toJSON sem chave", !JSON.stringify(db.toJSON()).includes(FAKE_KEY));
  }

  // cross-tenant via adapter concreto (transporte fake) + config source
  {
    const root = await CanaryShadowRoot.create(
      { mode: "shadow", tenantId: TENANT_A, agentId: AGENT_A, leadId: LEAD_UUID },
      { db: makeDb(new FakeSupabaseTransport(freshSeed())), decryptor: new V2PlaintextApiKeyReader(), clock: new FakeClock(NOW), model: new RecordingStructuredModel(), effectGate: new InMemoryEffectGate(), catalogSource: new StaticCatalogSource({ entries: [] }) },
    );
    check("tenant dono carrega via adapter concreto (transporte fake)", root.ref.agentId === AGENT_A);
  }

  // ── Decryptor (leitor de plaintext provado) ───────────────────────────────
  {
    const reader = new V2PlaintextApiKeyReader();
    const ctx = (provider: string) => ({ tenantId: TENANT_A, integrationId: "int-rm", provider });
    const feedUrl = "https://app.revendamais.com.br/feed/SYNTHETIC";
    check("decryptor sintético válido (revendamais feed_url)", (await reader.decryptApiKey(JSON.stringify({ feed_url: feedUrl }), ctx("revendamais"))) === feedUrl);
    check("decryptor sintético válido (bndv api_token)", (await reader.decryptApiKey(JSON.stringify({ api_token: "SYNTH-TOKEN" }), ctx("bndv"))) === "SYNTH-TOKEN");
    check("decryptor bndv raw escalar", (await reader.decryptApiKey("SYNTH-RAW-TOKEN", ctx("bndv"))) === "SYNTH-RAW-TOKEN");
    check("payload adulterado/sem campo falha fechado (null)", (await reader.decryptApiKey('{"api_token":"x"}', ctx("revendamais"))) === null && (await reader.decryptApiKey("not-a-url", ctx("revendamais"))) === null);
    check("payload vazio falha fechado (null)", (await reader.decryptApiKey("", ctx("bndv"))) === null);
    check("provider desconhecido falha fechado (null)", (await reader.decryptApiKey(JSON.stringify({ api_token: "x" }), ctx("desconhecido"))) === null);
  }

  // -- F2.5.4B: prompt-bound conversational composition --------------------
  const decryptor = new V2PlaintextApiKeyReader();
  const emptyCatalogSource = () => new StaticCatalogSource({ entries: [] });
  const rootDeps = (
    model: RecordingStructuredModel = new RecordingStructuredModel(),
    catalogSource: TenantCatalogSource = emptyCatalogSource(),
    effectGate: InMemoryEffectGate = new InMemoryEffectGate(),
  ) => ({
    db: makeDb(new FakeSupabaseTransport(freshSeed())),
    decryptor,
    clock: new FakeClock(NOW),
    model,
    catalogSource,
    effectGate,
  });

  await expectThrow("root aborta com mode != shadow", () => CanaryShadowRoot.create({ mode: "active" as "shadow", tenantId: TENANT_A, agentId: AGENT_A }, rootDeps()), "CANARY_REQUIRES_SHADOW_MODE");
  await expectThrow("root aborta sem tenant/agente explicitos", () => CanaryShadowRoot.create({ mode: "shadow", tenantId: "", agentId: AGENT_A }, rootDeps()), "CANARY_REQUIRES_EXPLICIT_TENANT_AGENT");
  {
    const activeGate = new InMemoryEffectGate();
    activeGate.setActiveMode(`${TENANT_A}:${AGENT_A}`, true);
    await expectThrow("root nao inicia com EffectGate ativo", () => CanaryShadowRoot.create({ mode: "shadow", tenantId: TENANT_A, agentId: AGENT_A }, rootDeps(new RecordingStructuredModel(), emptyCatalogSource(), activeGate)), "CANARY_GATE_MUST_BE_SHADOW");
    const shadowGate = new InMemoryEffectGate();
    check("assertCanaryGateShadow aceita gate shadow", (() => { try { assertCanaryGateShadow(shadowGate, "c1"); return true; } catch { return false; } })());
    shadowGate.setActiveMode("c1", true);
    await expectThrow("assertCanaryGateShadow rejeita gate ativo", async () => assertCanaryGateShadow(shadowGate, "c1"), "CANARY_GATE_MUST_BE_SHADOW");
  }

  await expectThrow("(13) canary rejeita agente inexistente", () => CanaryShadowRoot.create({ mode: "shadow", tenantId: TENANT_A, agentId: "agent-zzz" }, rootDeps()), "CANARY_CONFIG_INVALID:AGENT_NOT_FOUND");
  await expectThrow("(14) canary rejeita agente inativo", () => CanaryShadowRoot.create({ mode: "shadow", tenantId: TENANT_A, agentId: "agent-inactive" }, rootDeps()), "CANARY_CONFIG_INVALID:AGENT_INACTIVE");
  await expectThrow("(15) canary rejeita cross-tenant", () => CanaryShadowRoot.create({ mode: "shadow", tenantId: TENANT_B, agentId: AGENT_A }, rootDeps()), "CANARY_CONFIG_INVALID:AGENT_NOT_FOUND");
  await expectThrow("(16) canary rejeita prompt vazio", () => CanaryShadowRoot.create({ mode: "shadow", tenantId: TENANT_A, agentId: "agent-emptyprompt" }, rootDeps()), "CANARY_CONFIG_INVALID:PROMPT_SOURCE_EMPTY");

  const tenantCatalog: TenantCatalog = {
    entries: [{ vehicleKey: "revendamais:renegade-1", brand: "Jeep", model: "Renegade", aliases: ["Jeep Renegade"] }],
  };
  const catalogSource = new StaticCatalogSource(tenantCatalog);
  const model = new RecordingStructuredModel();
  const proposal: ProposedDecision = {
    proposedAction: "reply",
    facts: [],
    proposedEffects: [{ kind: "send_message", planId: "m-canary", order: 1, onSuccess: [] }],
    responsePlan: { guidance: "Saudacao simples." },
    reasonCode: "canary_reply",
    reasonSummary: "resposta simples em shadow",
    confidence: 0.9,
  };
  model.interpretationOutput = { relation: "unrelated", intentSummary: "saudacao" };
  model.proposalSteps = [
    { kind: "query", call: { tool: "crm_read", input: { leadId: LEAD_UUID } } },
    { kind: "final", proposal },
  ];
  model.composeOutput = { parts: [{ type: "text", content: "Ola, posso ajudar?" }] };

  const sharedGate = new InMemoryEffectGate();
  const root = await CanaryShadowRoot.create(
    { mode: "shadow", tenantId: TENANT_A, agentId: AGENT_A, leadId: LEAD_UUID },
    rootDeps(model, catalogSource, sharedGate),
  );

  check("(17) root guarda TenantRuntimeConfig correta e frozen", root.tenantConfig.agentId === AGENT_A && root.tenantConfig.tenantId === TENANT_A && root.tenantConfig.promptText === agentRow.system_prompt && Object.isFrozen(root.tenantConfig), JSON.stringify({ agentId: root.tenantConfig.agentId, frozen: Object.isFrozen(root.tenantConfig) }));
  check("(17) config sem credencial (so SecretRef opaco)", root.tenantConfig.stockSecretRef?.provider === "revendamais" && !JSON.stringify(root.tenantConfig).includes(SECRET_CANARY));
  check("(B1) prompt do portal esta ligado ao adapter LLM", root.authoritativePromptText === agentRow.system_prompt && root.promptBoundToLlm === true);

  {
    const res = await root.runQuery({ tool: "crm_read", input: { leadId: LEAD_UUID } });
    check("runQuery crm_read le via wrapper read-only concreto (transporte fake)", res.ok === true && res.tool === "crm_read" && (res.ok ? res.data.leadId === LEAD_UUID && res.data.name === "Cliente Canary" : false), JSON.stringify(res));
  }

  {
    const clock = new FakeClock(NOW);
    const p = new InMemoryPersistence(clock, new FakeIdGen());
    const result = await root.runTurn({
      persistence: p,
      clock,
      conversationId: "c-canary",
      workerId: "w-canary",
      turnId: "t-canary",
      eventId: "e-canary",
      messageText: "oi",
      limits: { maxSteps: 3, totalTimeoutMs: 5000, queryTimeoutMs: 1000, proposeTimeoutMs: 1000, composeTimeoutMs: 1000 },
      maxValidationAttempts: 1,
      expected: { action: "reply", reasonCode: "canary_reply", requiredTools: ["crm_read"] },
    });

    const allSkipped = result.outboxAfterDispatch.length >= 1 && result.outboxAfterDispatch.every((record) => record.status === "skipped" && record.outcomeAppliedAt === null);
    check("(18) canary turno commita em shadow", result.engine.status === "committed", JSON.stringify({ status: result.engine.status }));
    check("(18) shadow nao chama provider real (0 dispatch)", result.dispatchAttempts === 0);
    check("(18) nenhuma decisao shadow aplica EffectOutcome", allSkipped, JSON.stringify(result.outboxAfterDispatch));
    check("(18) comparacao shadow do canary passa", result.comparison.passed === true, JSON.stringify(result.comparison));
    check("(B2) contexto foi preparado dentro do root", catalogSource.refs.length === 1 && model.interpretCalls.length === 1 && model.proposeCalls.length === 2 && model.composeCalls.length === 1);

    const everyBinding = [...model.interpretCalls, ...model.proposeCalls, ...model.composeCalls]
      .every((call) => call.binding.systemPrompt === agentRow.system_prompt && call.binding.tenantId === TENANT_A && call.binding.agentId === AGENT_A && Object.isFrozen(call.binding));
    check("(B3) interpret/propose/compose recebem o mesmo prompt autoritativo frozen", everyBinding);
    check("(B4) interpretacao state-aware alimenta a decisao", model.proposeCalls[0]?.turn.interpretation?.relation === "unrelated");
    check("(B4) resultado da tool retorna ao modelo no mesmo turno", model.proposeCalls[1]?.facts.some((fact) => fact.ok && fact.tool === "crm_read") === true);
    check("(B5) binding nao contem credencial", !JSON.stringify(model.proposeCalls[0]?.binding).includes(SECRET_CANARY));
  }

  // Gate flipped after create must still block the turn (TOCTOU defense).
  {
    const gateModel = new RecordingStructuredModel();
    const gate = new InMemoryEffectGate();
    const gateRoot = await CanaryShadowRoot.create(
      { mode: "shadow", tenantId: TENANT_A, agentId: AGENT_A },
      rootDeps(gateModel, emptyCatalogSource(), gate),
    );
    gate.setActiveMode("c-gate", true);
    await expectThrow("(B6) gate ativado depois do create bloqueia runTurn", () => gateRoot.runTurn({
      persistence: new InMemoryPersistence(new FakeClock(NOW), new FakeIdGen()),
      clock: new FakeClock(NOW),
      conversationId: "c-gate",
      workerId: "w-gate",
      turnId: "t-gate",
      eventId: "e-gate",
      messageText: "oi",
      limits: { maxSteps: 1, totalTimeoutMs: 1000 },
      maxValidationAttempts: 1,
    }), "CANARY_GATE_MUST_BE_SHADOW");
  }

  // Canonical claims avoid rejecting a valid structured "brand + model" rendering.
  {
    const aliasClaims = new CatalogClaimExtractor(tenantCatalog).extractClaims("Jeep Renegade");
    check("(B7) alias resolve para marca/modelo canonicos", aliasClaims.some((claim) => claim.kind === "brand" && claim.normalized === "jeep") && aliasClaims.some((claim) => claim.kind === "model" && claim.normalized === "renegade") && !aliasClaims.some((claim) => claim.kind === "model" && claim.normalized === "jeep renegade"));
  }
  // Free vehicle claim in TextPart is blocked by the catalog-derived ClaimExtractor.
  {
    const claimModel = new RecordingStructuredModel();
    claimModel.interpretationOutput = { relation: "ambiguous" };
    claimModel.proposalSteps = [{ kind: "final", proposal }];
    claimModel.composeOutput = { parts: [{ type: "text", content: "Temos um Renegade para voce." }] };
    const claimRoot = await CanaryShadowRoot.create(
      { mode: "shadow", tenantId: TENANT_A, agentId: AGENT_A },
      rootDeps(claimModel, new StaticCatalogSource(tenantCatalog)),
    );
    const claimResult = await claimRoot.runTurn({
      persistence: new InMemoryPersistence(new FakeClock(NOW), new FakeIdGen()),
      clock: new FakeClock(NOW),
      conversationId: "c-claim",
      workerId: "w-claim",
      turnId: "t-claim",
      eventId: "e-claim",
      messageText: "quero ver carros",
      limits: { maxSteps: 2, totalTimeoutMs: 5000 },
      maxValidationAttempts: 1,
      expected: { action: "reply", reasonCode: "terminal_safe" },
    });
    check("(B7) claim automotivo livre e bloqueado pelo catalogo dinamico", claimResult.engine.status === "committed" && claimResult.engine.decision.reasonCode === "terminal_safe", JSON.stringify(claimResult.comparison));
  }

  // Invalid understanding output degrades to ambiguous instead of dropping the turn.
  {
    const fallbackModel = new RecordingStructuredModel();
    fallbackModel.interpretationOutput = { relation: "invented_relation", secret: SECRET_CANARY };
    fallbackModel.proposalSteps = [{ kind: "final", proposal }];
    fallbackModel.composeOutput = { parts: [{ type: "text", content: "Posso ajudar?" }] };
    const fallbackRoot = await CanaryShadowRoot.create(
      { mode: "shadow", tenantId: TENANT_A, agentId: AGENT_A },
      rootDeps(fallbackModel, emptyCatalogSource()),
    );
    const fallbackResult = await fallbackRoot.runTurn({
      persistence: new InMemoryPersistence(new FakeClock(NOW), new FakeIdGen()),
      clock: new FakeClock(NOW),
      conversationId: "c-understanding-fallback",
      workerId: "w-fallback",
      turnId: "t-fallback",
      eventId: "e-fallback",
      messageText: "mensagem ambigua",
      limits: { maxSteps: 2, totalTimeoutMs: 5000 },
      maxValidationAttempts: 1,
    });
    check("(B8) interpretacao invalida cai para ambiguous sem silencio", fallbackResult.engine.status === "committed" && fallbackModel.proposeCalls[0]?.turn.interpretation?.relation === "ambiguous");
    check("(B9) output invalido nao vaza canario no estado/eventos", !JSON.stringify(fallbackResult).includes(SECRET_CANARY));
  }
  // A reducer-invalid model mutation must become a safe committed response,
  // never commit_failed/silence.
  {
    const mutationModel = new RecordingStructuredModel();
    mutationModel.interpretationOutput = { relation: "answers_pending" };
    mutationModel.proposalSteps = [{
      kind: "final",
      proposal: {
        ...proposal,
        facts: [{ op: "set_slot", slot: "nome", value: "Carlos", confidence: 0.9, sourceTurnId: "wrong-turn" }],
      },
    }];
    const mutationRoot = await CanaryShadowRoot.create(
      { mode: "shadow", tenantId: TENANT_A, agentId: AGENT_A },
      rootDeps(mutationModel, emptyCatalogSource()),
    );
    const mutationResult = await mutationRoot.runTurn({
      persistence: new InMemoryPersistence(new FakeClock(NOW), new FakeIdGen()),
      clock: new FakeClock(NOW),
      conversationId: "c-invalid-mutation",
      workerId: "w-invalid-mutation",
      turnId: "t-invalid-mutation",
      eventId: "e-invalid-mutation",
      messageText: "Carlos",
      limits: { maxSteps: 2, totalTimeoutMs: 5000 },
      maxValidationAttempts: 1,
    });
    check("(B10) mutacao invalida vira resposta segura sem commit_failed", mutationResult.engine.status === "committed" && mutationResult.engine.decision.reasonCode === "error" && mutationResult.dispatchAttempts === 0, JSON.stringify(mutationResult.engine));
  }
  // The second turn must be interpreted from the state committed by the first.
  {
    const memoryModel = new RecordingStructuredModel();
    const memoryRoot = await CanaryShadowRoot.create(
      { mode: "shadow", tenantId: TENANT_A, agentId: AGENT_A },
      rootDeps(memoryModel, emptyCatalogSource()),
    );
    const memoryClock = new FakeClock(NOW);
    const memoryPersistence = new InMemoryPersistence(memoryClock, new FakeIdGen());
    memoryModel.interpretationOutput = { relation: "answers_pending" };
    memoryModel.proposalSteps = [{
      kind: "final",
      proposal: {
        ...proposal,
        facts: [{ op: "set_slot", slot: "nome", value: "Carlos", confidence: 0.95, sourceTurnId: "t-memory-1" }],
      },
    }];
    await memoryRoot.runTurn({
      persistence: memoryPersistence,
      clock: memoryClock,
      conversationId: "c-memory",
      workerId: "w-memory",
      turnId: "t-memory-1",
      eventId: "e-memory-1",
      messageText: "Carlos",
      limits: { maxSteps: 2, totalTimeoutMs: 5000 },
      maxValidationAttempts: 1,
    });

    memoryModel.proposalSteps = [{ kind: "final", proposal }];
    await memoryRoot.runTurn({
      persistence: memoryPersistence,
      clock: memoryClock,
      conversationId: "c-memory",
      workerId: "w-memory",
      turnId: "t-memory-2",
      eventId: "e-memory-2",
      messageText: "quero continuar",
      limits: { maxSteps: 2, totalTimeoutMs: 5000 },
      maxValidationAttempts: 1,
    });
    const secondInterpret = memoryModel.interpretCalls.at(-1);
    check("(B11) turno seguinte interpreta usando memoria central atualizada", secondInterpret?.turn.state.slots.nome.status === "known" && secondInterpret.turn.state.slots.nome.value === "Carlos");
  }
  // Provider exceptions are sanitized before the terminal-safe decision is persisted.
  {
    const throwingModel = new RecordingStructuredModel();
    throwingModel.proposeError = new Error(`provider failed token=${SECRET_CANARY} prompt=${agentRow.system_prompt}`);
    const throwingRoot = await CanaryShadowRoot.create(
      { mode: "shadow", tenantId: TENANT_A, agentId: AGENT_A },
      rootDeps(throwingModel, emptyCatalogSource()),
    );
    const throwingResult = await throwingRoot.runTurn({
      persistence: new InMemoryPersistence(new FakeClock(NOW), new FakeIdGen()),
      clock: new FakeClock(NOW),
      conversationId: "c-provider-error",
      workerId: "w-provider-error",
      turnId: "t-provider-error",
      eventId: "e-provider-error",
      messageText: "oi",
      limits: { maxSteps: 2, totalTimeoutMs: 5000 },
      maxValidationAttempts: 1,
    });
    const serialized = JSON.stringify(throwingResult);
    check("(B12) excecao do provider vira terminal-safe sanitizado", throwingResult.engine.status === "committed" && throwingResult.engine.decision.reasonSummary.includes("MODEL_DECISION_FAILURE"));
    check("(B12) erro do provider nao vaza segredo nem prompt", !serialized.includes(SECRET_CANARY) && !serialized.includes(agentRow.system_prompt));
  }
  // Malformed future outcomes are rejected before entering the outbox.
  {
    const outcomeModel = new RecordingStructuredModel();
    outcomeModel.proposalSteps = [{
      kind: "final",
      proposal: {
        ...proposal,
        proposedEffects: [{
          kind: "send_message",
          planId: "bad-outcome",
          order: 1,
          onSuccess: [{ op: "advance_stage", stage: "invented-stage" }],
        }],
      },
    }];
    const outcomeRoot = await CanaryShadowRoot.create(
      { mode: "shadow", tenantId: TENANT_A, agentId: AGENT_A },
      rootDeps(outcomeModel, emptyCatalogSource()),
    );
    const outcomeResult = await outcomeRoot.runTurn({
      persistence: new InMemoryPersistence(new FakeClock(NOW), new FakeIdGen()),
      clock: new FakeClock(NOW),
      conversationId: "c-invalid-outcome",
      workerId: "w-invalid-outcome",
      turnId: "t-invalid-outcome",
      eventId: "e-invalid-outcome",
      messageText: "oi",
      limits: { maxSteps: 2, totalTimeoutMs: 5000 },
      maxValidationAttempts: 1,
    });
    const safeOnly = outcomeResult.outboxBeforeDispatch.length === 1 && outcomeResult.outboxBeforeDispatch[0]?.kind === "send_message" && outcomeResult.outboxBeforeDispatch[0]?.planId === "safe-terminal";
    check("(B13) outcome malformado e rejeitado antes do outbox", outcomeResult.engine.status === "committed" && outcomeResult.engine.decision.reasonCode === "error" && safeOnly, JSON.stringify(outcomeResult.engine));
  }
  console.log(`\nCANARY-WIRING F2.5.4A/A.1/A.2/B: ${ok} OK | ${failed} FALHA`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
