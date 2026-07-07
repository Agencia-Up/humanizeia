// ============================================================================
// F2.34 — Fix A (audit CTWA — condução SDR): RELAXAMENTO determinístico de busca vazia.
//   Quando uma busca EXATA volta 0, o engine roda a cascata relaxada (mesmo tipo na faixa / mesmo modelo sem teto / mesma
//   marca / tipo / faixa) até achar itens REAIS e CONDUZ nomeando o filtro original + o relaxamento — NUNCA "quer que eu
//   veja outras opções?" solto. Cobre RC3 (Compass até 100 = 0) e RC4 (Onix até 90 stale) do relatório real do Codex.
//   npx tsx tests/run-f2-34-empty-search-relaxation.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { relaxSearchCascade } from "../src/engine/commercial-constraints.ts";
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

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-07T12:00:00.000Z", SHA = "sha-34";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Estoque: SUVs na faixa (Creta/Renegade ≤100k), Compass SÓ acima de 100k, Onix hatch acima de 90k, Gol hatch barato.
const CRETA: VehicleFact = { vehicleKey: "rm:creta", marca: "Hyundai", modelo: "Creta", ano: 2021, preco: 67990, km: 68500, cambio: "Automatico", cor: "Preto", tipo: "suv" };
const RENEGADE: VehicleFact = { vehicleKey: "rm:renegade", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 60990, km: 90000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const COMPASS: VehicleFact = { vehicleKey: "rm:compass", marca: "Jeep", modelo: "Compass", ano: 2022, preco: 119990, km: 40000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2025, preco: 95000, km: 20000, cambio: "Manual", cor: "Branco", tipo: "hatch" };
const GOL: VehicleFact = { vehicleKey: "rm:gol", marca: "Volkswagen", modelo: "Gol", ano: 2019, preco: 45000, km: 75000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const STOCK = [CRETA, RENEGADE, COMPASS, ONIX, GOL];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Avant", promptText: "Você é o Aloan da Avant." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100, Taubaté", hours: null, unit: "Avant", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; cambio?: string; excludeKeys?: string[]; broad?: boolean };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m) || m.includes(norm(v.marca))); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return inp.broad ? toks.some((t) => vt.includes(t)) : toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    if (inp.cambio) items = items.filter((v) => (inp.cambio === "automatic") === /autom/i.test(v.cambio ?? ""));
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
const resist: BrainResponder = () => finU([txt("Certo!")], "reply", U("other"));
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }
const searchPickupU: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "vehicle_type", subjectValue: "pickup", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "picape" }], isTopicChange: false, answeredLeadQuestions: [] } as TurnUnderstanding;

type Cap = { outbox: string; committed: boolean; reasonCode: string | null; src: string | null; degraded: boolean; terminalSafe: boolean; stockInputs: Record<string, unknown>[]; hasMedia: boolean };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, relation: TurnRelation, responder: BrainResponder): Promise<Cap> {
  executed.length = 0; preparer.relation = relation; brain.setResponder(responder);
  await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t${seq}`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 3, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string; vehicleKey?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "",
    committed: r.status === "committed", reasonCode: r.status === "committed" ? r.decision.reasonCode : null,
    src: r.status === "committed" ? r.responseSource : null,
    degraded: r.status === "committed" ? r.degraded : false,
    terminalSafe: r.status === "committed" ? r.terminalSafe : false,
    stockInputs: executed.filter((e) => e.tool === "stock_search").map((e) => e.input as Record<string, unknown>),
    hasMedia: outbox.some((o) => o.kind === "send_media"),
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:relax${seq0++}`; let s = 0;
  const t = (lead: string, opts?: { rel?: TurnRelation; responder?: BrainResponder }): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, opts?.rel ?? "ambiguous", opts?.responder ?? resist);
  return { t };
}

async function main(): Promise<void> {
  console.log("== F2.34: Fix A — relaxamento determinístico de busca vazia ==");

  // ── PARTE 1 — PURO (relaxSearchCascade) ──
  check("[U-1] {Compass, ≤100k}+suv -> começa por same_type_in_range {suv,≤100k}", (() => {
    const c = relaxSearchCascade({ modelos: ["Compass"], precoMax: 100000 }, "suv");
    return c[0]?.kind === "same_type_in_range" && c[0].constraints.tipo === "suv" && c[0].constraints.precoMax === 100000 && c.some((s) => s.kind === "drop_ceiling" && s.constraints.modelos?.[0] === "Compass" && s.constraints.precoMax == null);
  })());
  check("[U-2] {suv, ≤90k} -> NÃO re-propõe o filtro que zerou (dedup do original)", (() => {
    const c = relaxSearchCascade({ tipo: "suv", precoMax: 90000 });
    return !c.some((s) => s.constraints.tipo === "suv" && s.constraints.precoMax === 90000) && c.some((s) => s.kind === "same_type" && s.constraints.tipo === "suv" && s.constraints.precoMax == null);
  })());
  check("[U-3] {Onix}+hatch SEM teto -> só same_type {hatch} (sem passos de faixa)", (() => {
    const c = relaxSearchCascade({ modelos: ["Onix"] }, "hatch");
    return c.length === 1 && c[0].kind === "same_type" && c[0].constraints.tipo === "hatch";
  })());
  check("[U-4] {jeep Compass, ≤80k}+suv -> inclui same_brand_in_range {jeep,≤80k} (marca sem modelo, distinto do original)", (() => {
    const c = relaxSearchCascade({ marca: "jeep", modelos: ["Compass"], precoMax: 80000 }, "suv");
    return c.some((s) => s.kind === "same_brand_in_range" && s.constraints.marca === "jeep" && s.constraints.precoMax === 80000 && s.constraints.modelos == null) && c.some((s) => s.kind === "drop_ceiling");
  })());
  check("[U-5] {popular} sem preço/tipo -> cascata vazia (nada seguro a relaxar)", relaxSearchCascade({ popular: true }).length === 0);

  // ── RC3: "tem Compass até 100 mil?" (Compass só >100k) -> nessa faixa lista SUVs (Creta/Renegade), nomeia Compass ──
  {
    const c = conv();
    const t1 = await c.t("tem Compass até 100 mil?");
    check("[A-1] busca vazia CONDUZ: lista alternativas reais (Creta/Renegade), não beco", has(t1.outbox, "Creta") && has(t1.outbox, "Renegade"), `outbox="${t1.outbox}"`);
    check("[A-2] nomeia o filtro exato que não achou (Compass / 100)", has(t1.outbox, "Compass") && has(t1.outbox, "100"), `outbox="${t1.outbox}"`);
    check("[A-3] NÃO termina em 'quer que eu veja outras opções?' solto", !/quer que eu veja outras op(c|ç)oes\?\s*$/i.test(norm(t1.outbox)) && !has(t1.outbox, "nao temos"), `outbox="${t1.outbox}"`);
    check("[A-4] reasonCode = recovery_relaxed_offer", t1.reasonCode === "recovery_relaxed_offer", `reason=${t1.reasonCode} src=${t1.src}`);
    check("[A-5] rodou a busca relaxada por TIPO na faixa (tipo=suv, precoMax=100000)", t1.stockInputs.some((i) => i.tipo === "suv" && i.precoMax === 100000), `inputs=${JSON.stringify(t1.stockInputs)}`);
    check("[A-6] recuperação relaxada com lista REAL NÃO é terminalSafe/degraded", t1.terminalSafe === false && t1.degraded === false, `ts=${t1.terminalSafe} degraded=${t1.degraded} src=${t1.src}`);
  }

  // ── drop_ceiling: "tem Compass até 50 mil?" (nenhum SUV ≤50k) -> Compass um pouco acima ──
  {
    const c = conv();
    const t1 = await c.t("tem Compass até 50 mil?");
    check("[B-1] sem alternativa na faixa -> oferece o modelo pedido um pouco acima (Compass)", has(t1.outbox, "Compass") && t1.reasonCode === "recovery_relaxed_offer", `outbox="${t1.outbox}" reason=${t1.reasonCode}`);
    check("[B-2] rodou drop_ceiling (modelo Compass SEM precoMax)", t1.stockInputs.some((i) => has(String(i.modelo ?? ""), "compass") && i.precoMax == null), `inputs=${JSON.stringify(t1.stockInputs)}`);
  }

  // ── RC4: "tem Onix até 90 mil?" (Onix hatch só >90k) -> nessa faixa lista hatches (Gol), nomeia Onix ──
  {
    const c = conv();
    const t1 = await c.t("tem Onix até 90 mil?");
    check("[C-1] Onix acima da faixa -> lista hatch na faixa (Gol), nomeia Onix", has(t1.outbox, "Gol") && has(t1.outbox, "Onix") && t1.reasonCode === "recovery_relaxed_offer", `outbox="${t1.outbox}" reason=${t1.reasonCode}`);
  }

  // ── Override: o cérebro AUTORA o beco ("não temos Compass, quer outras?") -> engine sobrepõe com a lista relaxada ──
  {
    const c = conv();
    const deadEnd: BrainResponder = () => finU([txt("Não temos Compass até 100 mil no momento. Quer que eu veja outras opções para você?")], "reply", U("search_stock"));
    const t1 = await c.t("tem Compass até 100 mil?", { responder: deadEnd });
    check("[D-1] beco autorado é SOBREPOSTO: lista Creta/Renegade", has(t1.outbox, "Creta") || has(t1.outbox, "Renegade"), `outbox="${t1.outbox}"`);
    check("[D-2] a resposta final não é o beco 'quer que eu veja outras opções?'", !/quer que eu veja outras op(c|ç)oes/i.test(norm(t1.outbox)), `outbox="${t1.outbox}"`);
  }

  // ── Regressão: busca COM resultado não vira relaxamento ──
  {
    const c = conv();
    const t1 = await c.t("tem SUV até 100 mil?");
    check("[R-1] busca com itens lista normal (Creta/Renegade), SEM relaxamento", (has(t1.outbox, "Creta") || has(t1.outbox, "Renegade")) && t1.reasonCode !== "recovery_relaxed_offer", `outbox="${t1.outbox}" reason=${t1.reasonCode}`);
    check("[R-2] não roda busca relaxada extra (só a do escopo pedido)", t1.stockInputs.every((i) => i.tipo === "suv"), `inputs=${JSON.stringify(t1.stockInputs)}`);
  }

  // ── E (dono): busca vazia SEM alternativa (picape até 30k, estoque sem picape barata) + cérebro autora BECO ──
  {
    const c = conv();
    const beco: BrainResponder = (_f, obs) => obs.some((o) => o.tool === "stock_search")
      ? finU([txt("No momento não temos picapes até 30 mil. Quer que eu veja outras opções para você?")], "reply", searchPickupU)
      : qU({ tool: "stock_search", input: { tipo: "pickup", precoMax: 30000 } }, searchPickupU);
    const t1 = await c.t("tem picape até 30 mil?", { responder: beco });
    check("[E-1] beco 'quer que eu veja outras opções?' é SUBSTITUÍDO", !/quer que eu (veja|mostre) outras op/.test(norm(t1.outbox)), `outbox="${t1.outbox}"`);
    check("[E-2] recuperação condutora: nomeia o filtro + pergunta específica (ampliar/outro), rc=recovery_stock_empty_conduct", (has(t1.outbox, "picape") || has(t1.outbox, "pickup") || has(t1.outbox, "30")) && /ampliar|outro modelo|outro tipo|prefere|me diz/.test(norm(t1.outbox)) && t1.reasonCode === "recovery_stock_empty_conduct", `rc=${t1.reasonCode} outbox="${t1.outbox}"`);
    check("[E-2b] beco vazio conduzido NÃO é terminalSafe/degraded", t1.terminalSafe === false && t1.degraded === false, `ts=${t1.terminalSafe} degraded=${t1.degraded} src=${t1.src}`);
  }

  // ── E-3 (bug do audit real): "tem X até Y?" às vezes é classificado relation=asks_vehicle_detail, mas rodou stock_search(0)
  //    de verdade -> o gate agora é "busca executada que zerou", não a classificação -> ainda substitui o beco. ──
  {
    const c = conv();
    const beco: BrainResponder = (_f, obs) => obs.some((o) => o.tool === "stock_search")
      ? finU([txt("Não temos picape até 30 mil no momento. Quer que eu veja outras opções para você?")], "reply", searchPickupU)
      : qU({ tool: "stock_search", input: { tipo: "pickup", precoMax: 30000 } }, searchPickupU);
    const t1 = await c.t("tem picape até 30 mil?", { rel: "asks_vehicle_detail" as TurnRelation, responder: beco });
    check("[E-3] classificado asks_vehicle_detail mas busca vazia EXECUTADA -> ainda substitui o beco (conduct)", t1.reasonCode === "recovery_stock_empty_conduct" && !/quer que eu veja outras op/.test(norm(t1.outbox)), `rc=${t1.reasonCode} outbox="${t1.outbox}"`);
  }

  console.log(`\n== F2.34: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
