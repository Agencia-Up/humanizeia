// ============================================================================
// F2.30 — P0 (INC3): "SUV -> outros até 100k" TEM que achar Compass elegível não mostrado.
//   Incidente real (tenant ecb26258): poll-2 mostrou 5 SUVs (≤73k) mas a busca retornou 17; no poll-3 "Tem outros? de
//   100k" o CÉREBRO passou excludeKeys com as 17 keys que VIU no resultado — escondendo os 2 Compass (92990/96990,
//   SUV, ≤100k) que NUNCA foram exibidos -> "não temos outros" (falso). Fix por invariante: o engine CLAMPA o excludeKeys
//   ao que o lead REALMENTE viu (offers.presentedKeys cumulativo). O cérebro não pode esconder estoque não mostrado.
//   npx tsx tests/run-f2-30-exclude-shown-only.ts
// ============================================================================
import { runCentralConversationTurn, enrichStockSearchCall, type CentralTurnResult } from "../src/engine/central-engine.ts";
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
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-06T12:00:00.000Z", SHA = "sha-30";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// 5 SUVs baratos (≤73k) + 2 Compass SUV ≤100k (nunca mostrados no 1º turno com teto 75k). Espelha o print.
const C3: VehicleFact       = { vehicleKey: "rm:c3",   marca: "Citroen", modelo: "C3 Aircross", ano: 2015, preco: 47990, km: 116000, cambio: "Manual",      cor: "Branco", tipo: "suv" };
const DUSTER: VehicleFact   = { vehicleKey: "rm:dus",  marca: "Renault", modelo: "Duster",      ano: 2015, preco: 58990, km: 130000, cambio: "Automatico", cor: "Preto",  tipo: "suv" };
const P2008: VehicleFact    = { vehicleKey: "rm:2008", marca: "Peugeot", modelo: "2008",        ano: 2021, preco: 66990, km: 80000,  cambio: "Automatico", cor: "Branco", tipo: "suv" };
const REN16: VehicleFact    = { vehicleKey: "rm:ren16",marca: "Jeep",    modelo: "Renegade",    ano: 2016, preco: 71990, km: 98000,  cambio: "Automatico", cor: "Branco", tipo: "suv" };
const REN18: VehicleFact    = { vehicleKey: "rm:ren18",marca: "Jeep",    modelo: "Renegade",    ano: 2018, preco: 72990, km: 85000,  cambio: "Automatico", cor: "Branco", tipo: "suv" };
const COMPASS17: VehicleFact= { vehicleKey: "rm:cmp17",marca: "Jeep",    modelo: "Compass",     ano: 2017, preco: 92990, km: 88000,  cambio: "Automatico", cor: "Branco", tipo: "suv" };
const COMPASS19: VehicleFact= { vehicleKey: "rm:cmp19",marca: "Jeep",    modelo: "Compass",     ano: 2019, preco: 96990, km: 82000,  cambio: "Automatico", cor: "Branco", tipo: "suv" };
const CHEAP5 = [C3, DUSTER, P2008, REN16, REN18];
const STOCK = [...CHEAP5, COMPASS17, COMPASS19];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Avant", promptText: "Você é o Aloan da Avant." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Avant", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; cambio?: string; excludeKeys?: string[] };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m) || m.includes(norm(v.marca))); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    if (inp.cambio) items = items.filter((v) => (inp.cambio === "automatic") === /autom/i.test(v.cambio ?? ""));
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: primaryIntent === "search_stock" ? ["stock_search"] : [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const offer = (keys: string[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: keys } as ResponsePart);
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
// ⭐AUTORIDADE (audit Codex): turnos-default desta suíte são BUSCAS — a LLM real classifica search_stock. Declara o
// ATO mas resiste a chamar a tool: o executor determinístico garante a execução (o que a suíte prova).
const resist: BrainResponder = (f, observations) => {
  const understanding = {
    ...U("search_stock"), requestedCapabilities: ["stock_search"] as TurnUnderstanding["requestedCapabilities"],
    evidence: [{ capability: "stock_search" as const, quote: (f.block ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || "tem" }],
  };
  const stock = [...observations].reverse().find((o) => o.tool === "stock_search" && o.ok) as { ok: true; tool: "stock_search"; data: { items: VehicleFact[] } } | undefined;
  if (!stock) return finU([txt("Certo!")], "reply", understanding);
  return stock.data.items.length > 0
    ? finU([txt("Encontrei estas opções para você:"), offer(stock.data.items.map((v) => v.vehicleKey)), txt("Qual delas chamou sua atenção?")], "offer_stock", understanding)
    : finU([txt("Não encontrei outras opções com esses critérios agora. Quer ajustar a faixa ou o tipo?")], "empty_more_options", understanding);
};

type Cap = { outbox: string; committed: boolean; exec: string[]; stockInput: Record<string, unknown> | null; reasonCode: string | null; presentedKeys: string[] };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, relation: TurnRelation, responder: BrainResponder): Promise<Cap> {
  executed.length = 0; preparer.relation = relation; brain.setResponder(responder);
  await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t${seq}`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  const stock = [...executed].reverse().find((e) => e.tool === "stock_search");
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  const st = persistence.load(convId)?.state as { offers?: { presentedKeys?: string[] } } | undefined;
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    exec: executed.map((e) => e.tool), stockInput: stock ? (stock.input as Record<string, unknown>) : null,
    reasonCode: r.status === "committed" ? r.decision.reasonCode : null, presentedKeys: st?.offers?.presentedKeys ?? [],
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `conv-${seq0++}`; let s = 0;
  const t = (lead: string, relation: TurnRelation = "ambiguous", responder: BrainResponder = resist): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, relation, responder);
  return { t };
}

async function main(): Promise<void> {
  console.log("== F2.30: excludeKeys só do que foi mostrado (INC3 Compass) ==");

  // ── GRUPO 1 — PURO: enrichStockSearchCall CLAMPA o excludeKeys do cérebro ao conjunto apresentado ──
  {
    // moreOptions: exclui TODO o apresentado; a key NÃO mostrada proposta pelo cérebro é DESCARTADA.
    const call = enrichStockSearchCall({ tool: "stock_search", input: { tipo: "suv", excludeKeys: ["shownA", "shownB", "rm:cmp17", "rm:cmp19"] } }, { popular: false, moreOptions: true, previousVehicleKeys: ["shownA", "shownB"], enforceShownClamp: true });
    const ex = (call.input as { excludeKeys?: string[] }).excludeKeys ?? [];
    check("[U-1] moreOptions: excludeKeys = SÓ apresentado (Compass não-mostrado descartado)", ex.length === 2 && ex.includes("shownA") && ex.includes("shownB") && !ex.includes("rm:cmp17") && !ex.includes("rm:cmp19"), `ex=${JSON.stringify(ex)}`);
  }
  {
    // não-moreOptions: o excludeKeys do cérebro é filtrado ao apresentado (dropa não-mostrado).
    const call = enrichStockSearchCall({ tool: "stock_search", input: { tipo: "suv", excludeKeys: ["shownA", "rm:cmp17"] } }, { popular: false, moreOptions: false, previousVehicleKeys: ["shownA"], enforceShownClamp: true });
    const ex = (call.input as { excludeKeys?: string[] }).excludeKeys ?? [];
    check("[U-2] non-moreOptions: excludeKeys do cérebro clampado ao apresentado", ex.length === 1 && ex[0] === "shownA", `ex=${JSON.stringify(ex)}`);
  }
  {
    // sem NADA apresentado: qualquer excludeKeys do cérebro é DESCARTADO (não esconde estoque nunca mostrado).
    const call = enrichStockSearchCall({ tool: "stock_search", input: { tipo: "suv", excludeKeys: ["rm:cmp17", "rm:cmp19"] } }, { popular: false, moreOptions: false, previousVehicleKeys: [], enforceShownClamp: true });
    check("[U-3] sem oferta prévia: excludeKeys do cérebro descartado", (call.input as { excludeKeys?: string[] }).excludeKeys === undefined);
  }
  {
    // moreOptions sem excludeKeys do cérebro: exclui exatamente o apresentado.
    const call = enrichStockSearchCall({ tool: "stock_search", input: { tipo: "suv" } }, { popular: false, moreOptions: true, previousVehicleKeys: ["a", "b", "c"], enforceShownClamp: true });
    const ex = (call.input as { excludeKeys?: string[] }).excludeKeys ?? [];
    check("[U-4] moreOptions sem proposta do cérebro: exclui o apresentado", ex.length === 3 && ex.includes("a") && ex.includes("c"), `ex=${JSON.stringify(ex)}`);
  }

  // ── GRUPO 2 — INTEGRAÇÃO (resist + executor determinístico): unshown Compass aparece em "outros de 100k" ──
  {
    const c = conv();
    const t1 = await c.t("quero um SUV até 75 mil");
    check("[I-1] T1 lista 5 SUVs baratos, SEM Compass", has(t1.outbox, "Renegade") && !has(t1.outbox, "Compass"), `outbox="${t1.outbox}"`);
    check("[I-2] presentedKeys cumulativo = os 5 mostrados (Compass fora)", t1.presentedKeys.length === 5 && !t1.presentedKeys.includes("rm:cmp17") && !t1.presentedKeys.includes("rm:cmp19"), `pk=${JSON.stringify(t1.presentedKeys)}`);
    const t2 = await c.t("tem outros de 100k?");
    const ex = (t2.stockInput?.excludeKeys as string[] | undefined) ?? [];
    check("[I-3] T2 exclui SÓ os 5 mostrados (Compass NÃO no excludeKeys)", ex.length === 5 && !ex.includes("rm:cmp17") && !ex.includes("rm:cmp19"), `ex=${JSON.stringify(ex)}`);
    check("[I-4] T2 LISTA Compass (elegível não-mostrado), NÃO 'não temos outros'", has(t2.outbox, "Compass") && !has(t2.outbox, "não temos") && !has(t2.outbox, "nao temos"), `rc=${t2.reasonCode} outbox="${t2.outbox}"`);
    check("[I-5] busca herdou tipo=suv + precoMax=100000", t2.stockInput?.tipo === "suv" && t2.stockInput?.precoMax === 100000, `input=${JSON.stringify(t2.stockInput)}`);
  }

  // -- GRUPO 2b: incidente 2026-07-09. Draft com 7 keys, renderer mostra 5, memoria guarda SO 5.
  {
    const c = conv();
    const allStockBrain: BrainResponder = (_f, _obs, step) => {
      const u: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: [{ capability: "stock_search", quote: "SUV" }] };
      if (step === 0) return { kind: "query", understanding: u, call: { tool: "stock_search", input: { tipo: "suv" } } } as AgentBrainStep;
      return finU([txt("Encontrei estas opcoes pra voce:"), offer(STOCK.map((v) => v.vehicleKey))], "offer_all_suv", u);
    };
    const t1 = await c.t("quero SUV", "ambiguous", allStockBrain);
    check("[R-1] renderer mostra so 5: Compass fica fora do texto", has(t1.outbox, "Renegade") && !has(t1.outbox, "Compass"), `outbox="${t1.outbox}"`);
    check("[R-2] memoria presentedKeys espelha o render: so 5, sem Compass", t1.presentedKeys.length === 5 && !t1.presentedKeys.includes("rm:cmp17") && !t1.presentedKeys.includes("rm:cmp19"), `pk=${JSON.stringify(t1.presentedKeys)}`);
    const t2 = await c.t("tem outros?");
    const ex = (t2.stockInput?.excludeKeys as string[] | undefined) ?? [];
    check("[R-3] T2 exclui so os 5 efetivamente mostrados", ex.length === 5 && !ex.includes("rm:cmp17") && !ex.includes("rm:cmp19"), `ex=${JSON.stringify(ex)}`);
    check("[R-4] T2 encontra Compass que nao tinha sido renderizado", has(t2.outbox, "Compass"), `outbox="${t2.outbox}"`);
  }
  // ── GRUPO 3 — INCIDENTE EXATO: o cérebro passa excludeKeys com as keys que VIU (incl. Compass) -> engine clampa ──
  {
    const c = conv();
    await c.t("quero um SUV até 75 mil");   // estabelece presentedKeys = 5 mostrados
    // T2: cérebro faz stock_search com excludeKeys = 5 mostrados + 2 Compass (o bug real); depois final lista os Compass.
    // (a busca clampada retorna os 2 Compass -> ficam nos fatos do turno -> o offer_list aterra e renderiza.)
    const badBrain: BrainResponder = (_f, _obs, step) => {
      const u: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: [{ capability: "stock_search", quote: "outros" }] };
      if (step === 0) return { kind: "query", understanding: u, call: { tool: "stock_search", input: { tipo: "suv", precoMax: 100000, excludeKeys: ["rm:c3", "rm:dus", "rm:2008", "rm:ren16", "rm:ren18", "rm:cmp17", "rm:cmp19"] } } } as AgentBrainStep;
      return finU([txt("Encontrei estas opções pra você:"), offer(["rm:cmp17", "rm:cmp19"])], "offer_more_suv", u);
    };
    const t2 = await c.t("tem outros de 100k?", "ambiguous", badBrain);
    const ex = (t2.stockInput?.excludeKeys as string[] | undefined) ?? [];
    check("[G-1] engine CLAMPA: executed excludeKeys sem Compass (mesmo o cérebro tendo passado)", !ex.includes("rm:cmp17") && !ex.includes("rm:cmp19"), `ex=${JSON.stringify(ex)}`);
    check("[G-2] executed excludeKeys = só os 5 mostrados", ex.length === 5 && ex.every((k) => ["rm:c3", "rm:dus", "rm:2008", "rm:ren16", "rm:ren18"].includes(k)), `ex=${JSON.stringify(ex)}`);
    check("[G-3] Compass aparece no outbox (a busca clampada retornou os 2)", has(t2.outbox, "Compass"), `outbox="${t2.outbox}"`);
  }

  console.log(`\n== F2.30: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
