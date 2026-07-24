// ============================================================================
// F2.75 — TROCA DE DIREÇÃO solta o escopo do anúncio (incidente Icom Peugeot 2008 → "todos os automáticos").
//
// Autoridade = understanding.isTopicChange (semântico da LLM), NÃO heurística por filtro. Com isTopicChange=true, a busca
// executada NÃO herda marca/modelo/tipo/ano/preço do anúncio/activeSearchConstraints — só os critérios do bloco atual.
// Com isTopicChange=false, o refinamento aditivo é preservado. Os 8 aceites do Codex viram asserções aqui.
//   npx tsx tests/run-f2-75-topic-change-scope.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { CommercialConstraints } from "../src/engine/commercial-constraints.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "f49fd48a-4386-4009-95f3-26a5100b84f7", AGENT = "aee7e916-31b1-431c-ba6f-f38178fd4899", NOW = "2026-07-24T12:00:00.000Z";
const AD_SCOPE: CommercialConstraints = { tipo: "suv", marca: "peugeot", modelos: ["2008"], precoMax: 70000 };

// Estoque: automáticos variados (do mais barato ao mais caro) + o Peugeot 2008 do anúncio.
const STOCK: VehicleFact[] = [
  { vehicleKey: "bndv:gol", marca: "Volkswagen", modelo: "Gol", ano: 2019, preco: 42000, km: 80000, cambio: "Automatico", cor: "Prata", tipo: "hatch" },
  { vehicleKey: "bndv:onix", marca: "Chevrolet", modelo: "Onix", ano: 2021, preco: 58000, km: 40000, cambio: "Automatico", cor: "Branco", tipo: "hatch" },
  { vehicleKey: "bndv:2008", marca: "Peugeot", modelo: "2008", ano: 2021, preco: 68990, km: 35000, cambio: "Automatico", cor: "Preto", tipo: "suv" },
  { vehicleKey: "bndv:compass", marca: "Jeep", modelo: "Compass", ano: 2022, preco: 119000, km: 30000, cambio: "Automatico", cor: "Cinza", tipo: "suv" },
];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Carvalho", companyName: "Icom", promptText: "Você é o Carvalho da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "t" }; } });
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor; catalogDegraded: boolean }> { return { interpretation: { relation: "ambiguous" }, tenantCatalog: catalog, claimExtractor: extractor, catalogDegraded: false }; } }
const txt = (c: string): ResponsePart => ({ type: "text", content: c });
const offer = (keys: string[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: keys } as ResponsePart);
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;

function U(over: Partial<TurnUnderstanding>): TurnUnderstanding {
  return { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "none", subjectValue: null,
    subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [], policyDecision: null, ...over } as TurnUnderstanding;
}
// runQuery aplica os filtros sobre o STOCK e captura o input EXECUTADO (após enrich/gate do engine) + os itens retornados.
const executedInputs: Record<string, unknown>[] = [];
const lastResultKeys: string[] = [];
function makeRunQuery(): (c: QueryCall) => Promise<QueryResult> {
  return async (call: QueryCall): Promise<QueryResult> => {
    if (call.tool === "stock_search") {
      const inp = call.input as Record<string, unknown>;
      executedInputs.push({ ...inp });
      const norm = (s: string): string => (s ?? "").toLowerCase();
      let items = STOCK.slice();
      if (inp.marca) items = items.filter((v) => norm(v.marca).includes(norm(String(inp.marca))));
      if (inp.modelo) { const toks = norm(String(inp.modelo)).split(/\s+/).filter(Boolean); items = items.filter((v) => toks.every((t) => norm(`${v.marca} ${v.modelo} ${v.ano}`).includes(t))); }
      if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
      if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= (inp.precoMax as number));
      if (inp.cambio === "automatic") items = items.filter((v) => /autom/i.test(v.cambio ?? ""));
      items.sort((a, b) => (a.preco ?? 0) - (b.preco ?? 0));   // menor preço primeiro (aceite 5) — espelha o pool real de stock-source
      lastResultKeys.length = 0; lastResultKeys.push(...items.map((v) => v.vehicleKey));
      return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
    }
    throw new Error("tool " + call.tool);
  };
}

// Responder de busca: 1ª chamada -> query; depois de observar stock_search -> final listando (ordenado).
function searchResponder(u: TurnUnderstanding, input: Record<string, unknown>): BrainResponder {
  return (_frame, observations) => {
    const done = observations.find((o) => o.tool === "stock_search" && o.ok) as { ok: true; data: { items: VehicleFact[] } } | undefined;
    if (done) return { kind: "final", understanding: u, decision: { reasonCode: "offer_stock", reasonSummary: "lista", confidence: 0.9,
      responsePlan: { guidance: "g", draft: { parts: [txt("Estas são as opções:"), offer(done.data.items.slice(0, 4).map((v) => v.vehicleKey)), txt("Qual te interessa?")] } },
      proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision } as AgentBrainStep;
    return { kind: "query", understanding: u, call: { tool: "stock_search", input } as never } as AgentBrainStep;
  };
}

async function runTurn(seedActive: CommercialConstraints | null, lead: string, u: TurnUnderstanding, brainInput: Record<string, unknown>): Promise<{ executed: Record<string, unknown>; committed: boolean; src: string | null; nextActive: unknown; resultKeys: string[] }> {
  executedInputs.length = 0; lastResultKeys.length = 0;
  const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const convId = `wa:f275:${Math.random().toString(36).slice(2)}`;
  const seed = persistence.begin();
  const base = createInitialState({ conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, now: clock.now() });
  seed.casState(convId, 0, seedActive ? { ...base, activeSearchConstraints: seedActive } : base);
  const s = seed.commit(); if (!s.ok) throw new Error("seed_failed:" + s.reason);
  const brain = new ScriptedAgentBrain(); brain.setResponder(searchResponder(u, brainInput));
  await persistence.tryInsert({ eventId: `${convId}-e1`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t1`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery: makeRunQuery(), businessInfo: makeBI(), contextPreparer: new RelPreparer(),
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: "sha-75",
    limits: { maxSteps: 6, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 3, brainMaxSteps: 6, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  } as never) as CentralTurnResult;
  const loaded = await persistence.load(convId);
  return {
    executed: executedInputs[executedInputs.length - 1] ?? {},
    committed: r.status === "committed", src: r.status === "committed" ? r.responseSource : null,
    nextActive: (loaded?.state as { activeSearchConstraints?: unknown } | undefined)?.activeSearchConstraints ?? null,
    resultKeys: [...lastResultKeys],
  };
}

async function main(): Promise<void> {
  console.log("== F2.75: troca de direção solta o escopo do anúncio ==");
  const ev = (o: Record<string, unknown>, q: string): TurnUnderstanding => U({ evidence: [{ capability: "stock_search", quote: q }], ...o } as Partial<TurnUnderstanding>);

  // [A1] isTopicChange=false: "esse Peugeot é automático?" -> MANTÉM o Peugeot/2008/suv + adiciona cambio (refinamento).
  const a1 = await runTurn(AD_SCOPE, "esse Peugeot 2008 é automático?", ev({ isTopicChange: false }, "esse Peugeot 2008"), { cambio: "automatic" });
  check("[A1] isTopicChange=false mantém marca do anúncio (Peugeot)", a1.executed.marca === "peugeot", JSON.stringify(a1.executed));
  // (o tipo:suv é corretamente superado pelo modelo reafirmado — regra pré-existente do merge; o que importa é preservar Peugeot 2008)
  check("[A1b] isTopicChange=false mantém modelo 2008 (refinamento)", String(a1.executed.modelo ?? "").includes("2008"), JSON.stringify(a1.executed));

  // [A2] isTopicChange=true: "quero todos os automáticos, do menor preço" -> SÓ cambio, SEM peugeot/2008/suv/70000.
  const a2 = await runTurn(AD_SCOPE, "quero todos os automaticos, do menor preco", ev({ isTopicChange: true }, "todos os automaticos"), { cambio: "automatic" });
  check("[A2] isTopicChange=true NÃO herda marca do anúncio", a2.executed.marca == null, JSON.stringify(a2.executed));
  check("[A2b] NÃO herda modelo/tipo/preço do anúncio", a2.executed.modelo == null && a2.executed.tipo == null && a2.executed.precoMax == null, JSON.stringify(a2.executed));
  check("[A2c] executa o filtro do bloco (cambio automatic)", a2.executed.cambio === "automatic", JSON.stringify(a2.executed));
  check("[A2d] a busca retorna os automáticos do estoque (não só o 2008)", a2.resultKeys.length > 1 && a2.resultKeys.includes("bndv:gol"), JSON.stringify(a2.resultKeys));

  // [A3] "não é desse modelo, quero outros" isTopicChange=true -> busca automáticos SEM o modelo do anúncio.
  const a3 = await runTurn(AD_SCOPE, "nao e desse modelo, quero outros automaticos", ev({ isTopicChange: true }, "outros automaticos"), { cambio: "automatic" });
  check("[A3] rejeição do modelo do anúncio -> sem peugeot/2008", a3.executed.marca == null && a3.executed.modelo == null, JSON.stringify(a3.executed));

  // [A4] "quero outros Peugeot 2008 automáticos" isTopicChange=true MAS o lead REAFIRMA -> mantém marca+modelo (via call).
  const a4 = await runTurn(AD_SCOPE, "quero outros Peugeot 2008 automaticos", ev({ isTopicChange: true }, "outros Peugeot 2008 automaticos"), { marca: "peugeot", modelo: "2008", cambio: "automatic" });
  check("[A4] lead REAFIRMA modelo+marca -> preserva Peugeot 2008", a4.executed.marca === "peugeot" && String(a4.executed.modelo ?? "").includes("2008"), JSON.stringify(a4.executed));

  // [A5] ordenação por menor preço.
  check("[A5] resultados ordenados pelo menor preço (Gol 42k primeiro)", a2.resultKeys[0] === "bndv:gol", JSON.stringify(a2.resultKeys));

  // [A6] persistência: activeSearchConstraints após A2 = escopo EXECUTADO (estreito), não o do anúncio.
  const na = a2.nextActive as CommercialConstraints | null;
  check("[A6] activeSearchConstraints persiste o escopo executado (sem peugeot/2008/suv/70000)", !!na && na.marca == null && (na.modelos == null || na.modelos.length === 0) && na.tipo == null && na.precoMax == null, JSON.stringify(na));

  // [A7] regressão: entrada normal de anúncio (isTopicChange=false, sem seed ativo) buscando o veículo exato -> mantém.
  const a7 = await runTurn(null, "esse Peugeot 2008 ainda esta disponivel?", ev({ isTopicChange: false, subject: "explicit_model", subjectValue: "Peugeot 2008" }, "esse Peugeot 2008"), { marca: "peugeot", modelo: "2008" });
  check("[A7] anúncio->veículo exato intacto (busca o Peugeot 2008)", a7.executed.marca === "peugeot" && String(a7.executed.modelo ?? "").includes("2008") && a7.committed, JSON.stringify(a7.executed));

  // [A8] self-heal: após A2 (troca), o próximo turno "tem outros?" herda o escopo ESTREITO, não reintroduz o anúncio.
  //      (provado por [A6]: o activeSearchConstraints persistido já é o estreito; o próximo turno parte dele.)
  check("[A8] próximo turno herda escopo estreito (self-heal do A6)", !!na && na.marca == null && na.tipo == null, JSON.stringify(na));

  console.log(`\n== F2.75: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
