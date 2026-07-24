// ============================================================================
// F2.73 — HONESTIDADE DE ESTOQUE: falha-de-carga != estoque-vazio.
//
// INCIDENTE (Mônaco, 2026-07-24): a Aline respondeu "No momento, nao temos SUVs
// disponiveis ate 250 mil" porque o token BNDV da loja estava morto. O
// `V2StockLoader.loadAll` engolia a falha de credencial/provedor num `[]`
// IDENTICO a um estoque genuinamente vazio -> a busca voltava ok:true items:[]
// -> a LLM (e o recovery) liam "a loja nao tem esse carro" -> MENTIRA ao lead.
//
// CORRECAO PROVADA AQUI (offline, sem OpenAI, sem banco, sem rede):
//   - Loader: credencial que nao resolve / provedor BNDV que erra (errors|data:null)
//     LANCA em vez de retornar [] -> o runner emite stock_search {ok:false} (UPSTREAM).
//   - Distincao preservada: um array PRESENTE (mesmo []) segue sendo "0 veiculos" honesto.
//   - Engine: um turno de busca cuja tool FALHOU roteia para indisponibilidade honesta
//     (recovery_stock_failed / conducao transparente), NUNCA "nao temos".
//   npx tsx tests/run-f2-73-stock-unavailable-honesty.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { V2StockLoader } from "../src/adapters/read/stock-loader.ts";
import { V2StockSource } from "../src/adapters/read/stock-source.ts";
import { ReadCache } from "../src/adapters/read/cache.ts";
import { createReadQueryRunner } from "../src/engine/read-query-runner.ts";
import { FakeV2ReadGateway } from "../src/adapters/read/fakes/fake-v2-read-gateway.ts";
import { FakeCredentialProvider } from "../src/adapters/read/fakes/fake-credential-provider.ts";
import { SafeHttpClient, type DnsResolver, type HttpTransport, type Sleeper } from "../src/adapters/read/http-client.ts";
import type { OwnedAgentRow, StockIntegrationMetadataRow } from "../src/adapters/read/v2-read-gateway.ts";
import type { NormalizedVehicle } from "../src/domain/read-ports.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { Clock } from "../src/domain/ports.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function expectThrow(name: string, fn: () => Promise<unknown>, contains: string): Promise<void> {
  try { await fn(); check(name, false, "deveria lançar"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(name, m.includes(contains), m); }
}
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

const TENANT = "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0";
const AGENT = "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185";
const NOW = "2026-07-24T12:00:00.000Z";
const TOKEN = "bndv-token-xyz";
const BNDV: StockIntegrationMetadataRow = { id: "int-bndv", tenantId: TENANT, provider: "bndv", isActive: true, updatedAt: NOW };

function agent(over: Partial<OwnedAgentRow> & { id: string; tenantId: string }): OwnedAgentRow {
  return { name: "Aline", instanceId: null, systemPrompt: "Você é a Aline da Mônaco.", useFunnelConfig: false, companyName: "Mônaco",
    model: "gpt-4.1-mini", temperature: 0.7, sdrGoal: "agendar visita", qualificationQuestions: [], sellsMotorcycles: false,
    blockedCategories: [], ragRestricted: false, isActive: true, updatedAt: NOW, ...over };
}
const AGENTS = [agent({ id: AGENT, tenantId: TENANT })];

class FakeDns implements DnsResolver {
  async resolve(h: string): Promise<string[]> { return h === "api-estoque.azurewebsites.net" ? ["104.244.42.2"] : ["8.8.8.8"]; }
  async lookup(h: string): Promise<string> { return (await this.resolve(h))[0]; }
}
class FakeTransport implements HttpTransport {
  constructor(public handler: (u: string, i?: RequestInit) => Promise<Response>) {}
  async fetch(u: string, i?: RequestInit): Promise<Response> { return this.handler(u, i); }
}
class FakeSleeper implements Sleeper { async sleep(): Promise<void> {} }
const clockRO: Clock = { now: () => NOW };

// Monta um V2StockLoader BNDV com um corpo de resposta HTTP arbitrário (ou credencial ausente).
function makeBndvLoader(opts: { body?: unknown; withSecret?: boolean }): V2StockLoader {
  const gateway = new FakeV2ReadGateway({ agents: AGENTS, funnels: [], integrationsByTenant: { [TENANT]: [BNDV] },
    integrationSecrets: { "int-bndv": { api_token: TOKEN, feed_url: "unused" } } });
  const creds = opts.withSecret === false
    ? new FakeCredentialProvider()   // integração CONFIGURADA porém credencial NÃO resolve
    : new FakeCredentialProvider({ "int-bndv": { tenantId: TENANT, provider: "bndv", material: JSON.stringify({ api_token: TOKEN }) } });
  const transport = new FakeTransport(async () => new Response(JSON.stringify(opts.body ?? {}), { headers: new Headers({ "content-type": "application/json" }) }));
  const http = new SafeHttpClient(new FakeDns(), transport, new FakeSleeper());
  return new V2StockLoader(gateway, creds, new ReadCache<NormalizedVehicle[]>(clockRO, { enabled: false, ttlMs: 0, maxItems: 1 }), http);
}
const bndvRow = (v: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  modelName: "Compass", markName: "Jeep", year: 2022, km: 40000, saleValue: 119990, color: "Branco",
  transmissionName: "Automatico", pictureJs: "[]", vehicleExternalKey: "9001", subCategoryName: "suv", ...v });

// Loader BNDV no modo NOVO (external_key+password = fluxo /login), como a Mônaco. O transporte ramifica /login vs /graphql.
function makeBndvLoginLoader(opts: { loginStatus?: number; loginBody?: string; loginCt?: string; graphqlBody?: unknown }): V2StockLoader {
  // O seed integrationSecrets do gateway não alimenta a auth (a credencial vem do FakeCredentialProvider); só o material
  // abaixo importa. Usamos a forma aceita pelo tipo IntegrationSecret no seed do gateway.
  const gateway = new FakeV2ReadGateway({ agents: AGENTS, funnels: [], integrationsByTenant: { [TENANT]: [BNDV] },
    integrationSecrets: { "int-bndv": { api_token: "unused", feed_url: "unused" } } });
  const creds = new FakeCredentialProvider({ "int-bndv": { tenantId: TENANT, provider: "bndv", material: JSON.stringify({ external_key: "EK", password: "PW" }) } });
  const transport = new FakeTransport(async (u) => {
    if (u.includes("/login")) {
      return new Response(opts.loginBody ?? JSON.stringify({ token: "fresh-login-token" }),
        { status: opts.loginStatus ?? 200, headers: new Headers({ "content-type": opts.loginCt ?? "application/json" }) });
    }
    return new Response(JSON.stringify(opts.graphqlBody ?? { data: { vehiclesBy: [bndvRow({})] } }), { headers: new Headers({ "content-type": "application/json" }) });
  });
  const http = new SafeHttpClient(new FakeDns(), transport, new FakeSleeper());
  return new V2StockLoader(gateway, creds, new ReadCache<NormalizedVehicle[]>(clockRO, { enabled: false, ttlMs: 0, maxItems: 1 }), http);
}

async function main(): Promise<void> {
  console.log("== F2.73: honestidade de estoque (falha != vazio) ==");

  // ── PARTE 1 — LOADER: falha-de-carga LANÇA; array presente NÃO lança ────────────────────────
  const ref = { tenantId: TENANT, agentId: AGENT };

  await expectThrow("[L-1] credencial CONFIGURADA que não resolve -> loadAll LANÇA (Mônaco: token morto)",
    () => makeBndvLoader({ withSecret: false, body: { data: { vehiclesBy: [] } } }).loadAll(ref), "STOCK_UNAVAILABLE");

  await expectThrow("[L-2] BNDV com GraphQL errors -> loadAll LANÇA (não é 'loja vazia')",
    () => makeBndvLoader({ body: { errors: [{ message: "unauthorized" }], data: null } }).loadAll(ref), "STOCK_UNAVAILABLE");

  await expectThrow("[L-3] BNDV com data:null (token inválido) -> loadAll LANÇA",
    () => makeBndvLoader({ body: { data: null } }).loadAll(ref), "STOCK_UNAVAILABLE");

  await expectThrow("[L-4] BNDV com vehiclesBy ausente -> loadAll LANÇA",
    () => makeBndvLoader({ body: { data: {} } }).loadAll(ref), "STOCK_UNAVAILABLE");

  // DISTINÇÃO PRESERVADA: um array PRESENTE (mesmo []) é resultado genuíno de "0 veículos", NÃO lança.
  const genuineEmpty = await makeBndvLoader({ body: { data: { vehiclesBy: [] } } }).loadAll(ref);
  check("[L-5] BNDV com vehiclesBy:[] (loja realmente sem carro) -> retorna [] SEM lançar", Array.isArray(genuineEmpty) && genuineEmpty.length === 0);
  const genuineFull = await makeBndvLoader({ body: { data: { vehiclesBy: [bndvRow({})] } } }).loadAll(ref);
  check("[L-6] BNDV com 1 veículo (api_token legado=Icom) -> carrega normalmente (caminho feliz intacto)", genuineFull.length === 1 && genuineFull[0].modelName === "Compass", `n=${genuineFull.length}`);

  // ── MODO NOVO (external_key+password = fluxo /login da Mônaco): o v3 agora faz o /login e carrega ─────────────────
  const loginOk = await makeBndvLoginLoader({ loginBody: JSON.stringify({ token: "fresh-login-token" }), graphqlBody: { data: { vehiclesBy: [bndvRow({}), bndvRow({ vehicleExternalKey: "9002", modelName: "Renegade" })] } } }).loadAll(ref);
  check("[L-7] BNDV external_key+password (Mônaco): v3 faz /login e CARREGA o estoque", loginOk.length === 2 && loginOk.some((v) => v.modelName === "Renegade"), `n=${loginOk.length}`);

  const loginTextToken = await makeBndvLoginLoader({ loginBody: "raw-plaintext-token-abc123", loginCt: "text/plain" }).loadAll(ref);
  check("[L-8] BNDV /login que devolve token como TEXTO PURO ainda autentica (expectJson:false)", loginTextToken.length === 1, `n=${loginTextToken.length}`);

  await expectThrow("[L-9] BNDV /login recusado (401) -> loadAll LANÇA (não é 'loja vazia')",
    () => makeBndvLoginLoader({ loginStatus: 401, loginBody: JSON.stringify({ message: "credenciais inválidas" }) }).loadAll(ref), "STOCK_UNAVAILABLE");

  await expectThrow("[L-10] BNDV /login OK mas sem token no corpo -> loadAll LANÇA",
    () => makeBndvLoginLoader({ loginBody: JSON.stringify({ foo: "bar" }) }).loadAll(ref), "STOCK_UNAVAILABLE");

  // ── PARTE 2 — RUNNER: throw do loader vira stock_search {ok:false} UPSTREAM (wasObserved-compatível) ──
  const runnerFail = createReadQueryRunner(ref, {
    stock: new V2StockSource(makeBndvLoader({ withSecret: false })),
    vehicleDetail: new V2StockSource(makeBndvLoader({ withSecret: false })),
    photo: { async resolvePhotos() { return { vehicleKey: "", ambiguous: false, photoIds: [] }; }, async resolveUrls() { return []; } },
    businessInfo: { async getBusinessInfo() { return { address: null, hours: null, unit: null, source: "t" }; } },
    crm: { async readLead() { return null; } },
  } as never);
  const rFail = await runnerFail({ tool: "stock_search", input: { tipo: "suv" } } as QueryCall);
  check("[R-1] stock_search com credencial morta -> {ok:false} (não ok:true items:[])", !rFail.ok && rFail.tool === "stock_search", JSON.stringify(rFail));
  // O tipo ToolError.code do QueryResult (TIMEOUT|NOT_FOUND|UPSTREAM|VALIDATION|FORBIDDEN) NUNCA é REQUIRED_TOOL_MISSING,
  // logo a observação satisfaz wasObserved (central-engine:361) e NÃO causa livelock de tool-obrigatória. UPSTREAM também
  // não é control-code, então buildContextualRecovery marca stockFailed=true -> recovery_stock_failed (honesto).
  check("[R-2] erro é UPSTREAM (satisfaz wasObserved; não é control-code; sem livelock)", !rFail.ok && rFail.error.code === "UPSTREAM", !rFail.ok ? rFail.error.code : "ok");

  const runnerEmpty = createReadQueryRunner(ref, {
    stock: new V2StockSource(makeBndvLoader({ body: { data: { vehiclesBy: [] } } })),
    vehicleDetail: new V2StockSource(makeBndvLoader({ body: { data: { vehiclesBy: [] } } })),
    photo: { async resolvePhotos() { return { vehicleKey: "", ambiguous: false, photoIds: [] }; }, async resolveUrls() { return []; } },
    businessInfo: { async getBusinessInfo() { return { address: null, hours: null, unit: null, source: "t" }; } },
    crm: { async readLead() { return null; } },
  } as never);
  const rEmpty = await runnerEmpty({ tool: "stock_search", input: { tipo: "suv" } } as QueryCall);
  check("[R-3] estoque genuinamente vazio -> {ok:true, items:[]} (distinto da falha)", rEmpty.ok && rEmpty.tool === "stock_search" && rEmpty.data.items.length === 0, JSON.stringify(rEmpty));

  // ── PARTE 3 — ENGINE e2e: turno de busca cuja tool FALHOU não vira "não temos" ──────────────
  const catalog = buildTenantCatalog([]);
  const extractor = new CatalogClaimExtractor(catalog);
  const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aline", companyName: "Mônaco", promptText: "Você é a Aline da Mônaco." } as never);
  const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Mônaco", source: "t" }; } });
  class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
  class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor; catalogDegraded: boolean }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor, catalogDegraded: false }; } }
  const U = (p: PrimaryIntent): TurnUnderstanding => ({ primaryIntent: p, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
  const txt = (c: string): ResponsePart => ({ type: "text", content: c });
  const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
  const searchU: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], subject: "vehicle_type", subjectValue: "suv", evidence: [{ capability: "stock_search", quote: "suv" }] };
  function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
    return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
  }
  function qU(input: Record<string, unknown>, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: { tool: "stock_search", input } as never, understanding: u } as AgentBrainStep; }

  // runQuery que FALHA a busca (simula loader que lançou -> UPSTREAM), como na Mônaco.
  const executed: QueryCall[] = [];
  const failingStock = async (call: QueryCall): Promise<QueryResult> => {
    executed.push(call);
    if (call.tool === "stock_search") return { ok: false, tool: "stock_search", error: { code: "UPSTREAM", message: "read tool unavailable", retryable: true } } as QueryResult;
    throw new Error("tool " + call.tool);
  };
  const emptyStock = async (call: QueryCall): Promise<QueryResult> => {
    executed.push(call);
    if (call.tool === "stock_search") return { ok: true, tool: "stock_search", data: { items: [], filtersUsed: (call.input ?? {}) as Record<string, never> }, source: "fake" } as QueryResult;
    throw new Error("tool " + call.tool);
  };

  type Cap = { outbox: string; committed: boolean; reasonCode: string | null; src: string | null; degraded: boolean };
  async function runTurn(runQuery: (c: QueryCall) => Promise<QueryResult>, responder: BrainResponder, lead: string): Promise<Cap> {
    executed.length = 0;
    const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
    const brain = new ScriptedAgentBrain(); brain.setResponder(responder);
    const preparer = new RelPreparer();
    const convId = `wa:f271:${Math.abs(hash(lead + responder.toString()))}`;
    await persistence.tryInsert({ eventId: `${convId}-e1`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
    clock.advance(1000);
    const turnId = `${convId}-t1`;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
      conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: "sha-71",
      limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 3, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    });
    const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
    return { outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "",
      committed: r.status === "committed", reasonCode: r.status === "committed" ? r.decision.reasonCode : null,
      src: r.status === "committed" ? r.responseSource : null, degraded: r.status === "committed" ? r.degraded : false };
  }
  function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }

  // Cérebro HONESTO: propõe busca; vendo ok:false, reconhece a instabilidade (comportamento esperado com o prompt novo).
  const honest: BrainResponder = (_frame, observations) => {
    const failed = observations.some((o) => o.tool === "stock_search" && !o.ok);
    if (failed) return finU([txt("Tive uma instabilidade para consultar nosso estoque agora. Me confirma o modelo que você procura que eu já verifico?")], "reply", searchU);
    return qU({ tipo: "suv" }, searchU);
  };
  const t1 = await runTurn(failingStock, honest, "tem SUV até 250 mil?");
  check("[E-1] busca FALHOU + cérebro honesto -> NUNCA afirma ausência ('não temos')", !has(t1.outbox, "nao temos") && !has(t1.outbox, "nao ha") && !has(t1.outbox, "nao dispon"), `outbox="${t1.outbox}"`);
  check("[E-1b] reconhece a indisponibilidade e conduz", (has(t1.outbox, "instabilidade") || has(t1.outbox, "confirm") || has(t1.outbox, "verific")) && t1.committed, `outbox="${t1.outbox}"`);

  // Cérebro que NÃO autora nada útil quando a busca falha (draft vazio) -> a rede honesta do engine assume.
  const silent: BrainResponder = (_frame, observations) => {
    const ran = observations.some((o) => o.tool === "stock_search");
    if (ran) return finU([], "reply", searchU);   // draft vazio -> rejeitado -> recuperação
    return qU({ tipo: "suv" }, searchU);
  };
  const t2 = await runTurn(failingStock, silent, "tem SUV até 250 mil?");
  check("[E-2] busca FALHOU + cérebro não autora -> rede honesta, NUNCA 'não temos'", !has(t2.outbox, "nao temos") && !has(t2.outbox, "nao ha suv") && t2.committed, `src=${t2.src} outbox="${t2.outbox}"`);
  check("[E-2b] a recuperação da falha é honesta sobre instabilidade (recovery_stock_failed)", has(t2.outbox, "instabilidade") || has(t2.outbox, "confirm") || t2.reasonCode === "contextual_recovery" || t2.reasonCode === "technical_fallback", `rc=${t2.reasonCode} src=${t2.src} outbox="${t2.outbox}"`);

  // REGRESSÃO: estoque genuinamente vazio (ok:true items:[]) continua honesto sobre o FILTRO — distinto da falha.
  const emptyHonest: BrainResponder = (_frame, observations) => {
    const ran = observations.some((o) => o.tool === "stock_search" && o.ok);
    if (ran) return finU([txt("Não encontrei SUV até 250 mil no nosso estoque agora. Quer que eu amplie a faixa ou veja outro tipo?")], "stock_empty_conduct", searchU);
    return qU({ tipo: "suv", precoMax: 250000 }, searchU);
  };
  const t3 = await runTurn(emptyStock, emptyHonest, "tem SUV até 250 mil?");
  check("[E-3] estoque VAZIO genuíno -> honesto sobre o filtro (distinto de falha), sem instabilidade falsa", has(t3.outbox, "250") && !has(t3.outbox, "instabilidade") && t3.committed, `outbox="${t3.outbox}"`);

  console.log(`\n== F2.73: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
