// ============================================================================
// F2.29 — P0 (audit Codex): "MAIS OPÇÕES herda o ESCOPO REAL da última oferta" + MOTO nunca em lista de carro.
//   Regressão do print (tenant ecb26258): T1 "Você tem sedan?" -> lista sedans, mas activeSearchConstraints=null;
//   T2 "Tem outros?" -> lista GENÉRICA barata (incluindo HONDA CB, uma MOTO). Causa: o escopo não era persistido da
//   busca EXECUTADA. Fixes: (1) persiste activeSearchConstraints do filtersUsed REAL; (2) moto excluída por default;
//   (3) deriva tipo de oferta homogênea; (5) "mais opções" sem escopo recuperável -> PERGUNTA (nunca lista genérico).
//   npx tsx tests/run-f2-29-more-options-scope.ts
// ============================================================================
import { runCentralConversationTurn, enrichStockSearchCall, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { deriveScopeFromHomogeneousOffer, mentionsMotorcycle, activeConstraintsFromStockInput } from "../src/engine/commercial-constraints.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildFrameSignals } from "../src/engine/turn-frame-builder.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, TurnInterpretation } from "../src/domain/decision.ts";
import type { VehicleFact, VehicleType } from "../src/domain/types.ts";
import type { ActiveSearchConstraints } from "../src/domain/conversation-state.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-06T12:00:00.000Z", SHA = "sha-29";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Sedans (>6 p/ "tem outros?" sobrar item depois do exclude). SUVs p/ teto/câmbio. 1 MOTO (Honda CB) p/ o teste E.
const CIVIC: VehicleFact  = { vehicleKey: "rm:civic",   marca: "Honda",      modelo: "Civic",   ano: 2019, preco: 95000, km: 40000, cambio: "Automatico", cor: "Preto",  tipo: "sedan" };
const PRISMA_M: VehicleFact = { vehicleKey: "rm:prismam", marca: "Chevrolet", modelo: "Prisma",  ano: 2016, preco: 54990, km: 85000, cambio: "Manual",      cor: "Branco", tipo: "sedan" };
const PRISMA_A: VehicleFact = { vehicleKey: "rm:prismaa", marca: "Chevrolet", modelo: "Prisma",  ano: 2018, preco: 59990, km: 60000, cambio: "Automatico", cor: "Prata",  tipo: "sedan" };
const VOYAGE: VehicleFact = { vehicleKey: "rm:voyage",  marca: "Volkswagen", modelo: "Voyage",  ano: 2017, preco: 49990, km: 70000, cambio: "Manual",      cor: "Cinza",  tipo: "sedan" };
const COBALT: VehicleFact = { vehicleKey: "rm:cobalt",  marca: "Chevrolet",  modelo: "Cobalt",  ano: 2018, preco: 57990, km: 65000, cambio: "Manual",      cor: "Preto",  tipo: "sedan" };
const SENTRA: VehicleFact = { vehicleKey: "rm:sentra",  marca: "Nissan",     modelo: "Sentra",  ano: 2019, preco: 79990, km: 50000, cambio: "Automatico", cor: "Branco", tipo: "sedan" };
const VERSA: VehicleFact  = { vehicleKey: "rm:versa",   marca: "Nissan",     modelo: "Versa",   ano: 2020, preco: 72990, km: 45000, cambio: "Automatico", cor: "Prata",  tipo: "sedan" };
const COMPASS: VehicleFact = { vehicleKey: "rm:compass", marca: "Jeep",      modelo: "Compass", ano: 2018, preco: 89990, km: 70000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const RENEGADE_A: VehicleFact = { vehicleKey: "rm:renegadea", marca: "Jeep",  modelo: "Renegade", ano: 2019, preco: 84990, km: 55000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const RENEGADE_M: VehicleFact = { vehicleKey: "rm:renegadem", marca: "Jeep",  modelo: "Renegade", ano: 2017, preco: 74990, km: 90000, cambio: "Manual",     cor: "Preto", tipo: "suv" };
const TRACKER: VehicleFact = { vehicleKey: "rm:tracker", marca: "Chevrolet", modelo: "Tracker", ano: 2020, preco: 88000, km: 30000, cambio: "Automatico", cor: "Vermelho", tipo: "suv" };
const ONIX: VehicleFact   = { vehicleKey: "rm:onix",    marca: "Chevrolet",  modelo: "Onix",    ano: 2017, preco: 49990, km: 70000, cambio: "Manual",      cor: "Preto",  tipo: "hatch" };
// MOTO — tipo "unknown" (classifyVehicleType não conhece moto). Barata (32k) -> apareceria em lista genérica barata.
const HONDA_CB: VehicleFact = { vehicleKey: "rm:cb", marca: "Honda", modelo: "CB 500", ano: 2024, preco: 32000, km: 5000, cambio: "Manual", cor: "Vermelho", tipo: "unknown" as VehicleType };
const STOCK = [CIVIC, PRISMA_M, PRISMA_A, VOYAGE, COBALT, SENTRA, VERSA, COMPASS, RENEGADE_A, RENEGADE_M, TRACKER, ONIX, HONDA_CB];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } });

// Mirror da exclusão de moto do stock-source real (fake opera em VehicleFact/modelo). CB 500 -> \bcb\b.
const isMotoModel = (modelo: string): boolean => /\b(cb\d{0,4}|cg\d{0,3}|biz|pop\d{2,3}|fan|titan|bros|xre|cbr|twister|hornet|fazer|ybr|factor|xtz|nmax|pcx)\b/.test(norm(modelo));

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; cambio?: string; anos?: number[]; popular?: boolean; broad?: boolean; excludeKeys?: string[]; includeMotorcycles?: boolean };
    let items = STOCK.slice();
    // A2) F2.29: moto excluída por DEFAULT (mirror do stock-source real) salvo includeMotorcycles.
    if (!inp.includeMotorcycles) items = items.filter((v) => !isMotoModel(v.modelo));
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m) || m.includes(norm(v.marca))); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return inp.broad ? toks.some((t) => vt.includes(t)) : toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    if (inp.cambio) items = items.filter((v) => (inp.cambio === "automatic") === /autom/i.test(v.cambio ?? ""));
    if (inp.anos && inp.anos.length > 0) { const s = new Set(inp.anos); items = items.filter((v) => v.ano != null && s.has(v.ano)); }
    if (inp.popular) items = items.filter((v) => v.tipo === "hatch" || v.tipo === "sedan");
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const offer = (keys: string[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: keys });
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
    : finU([txt("Não encontrei outras opções com os mesmos critérios agora. Quer ajustar a faixa ou o tipo?")], "empty_more_options", understanding);
};
const mute: BrainResponder = (_f, observations) => observations.some((o) => o.tool === "response" && !o.ok)
  ? finU([txt("Claro. De qual tipo de carro ou faixa de preço você quer ver mais opções?")], "clarify_more_options_scope", U("other"))
  : finU([], "reply", U("other"));

type Cap = { outbox: string; committed: boolean; hasMedia: boolean; exec: string[]; stockInput: Record<string, unknown> | null; reasonCode: string | null; activeAfter: ActiveSearchConstraints | null };
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
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed", hasMedia: outbox.some((o) => o.kind === "send_media"),
    exec: executed.map((e) => e.tool), stockInput: stock ? (stock.input as Record<string, unknown>) : null, reasonCode: r.status === "committed" ? r.decision.reasonCode : null,
    activeAfter: persistence.load(convId)?.state.activeSearchConstraints ?? null,
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
  console.log("== F2.29: mais opções herda escopo + moto fora de lista de carro ==");

  // ── PARTE 1 — PURO ──
  check("[U-1] deriveScope: 5 sedans homogêneos -> {tipo:sedan}", JSON.stringify(deriveScopeFromHomogeneousOffer([{ tipo: "sedan" }, { tipo: "sedan" }, { tipo: "sedan" }])) === JSON.stringify({ tipo: "sedan" }));
  check("[U-2] deriveScope: tipos MISTOS -> null", deriveScopeFromHomogeneousOffer([{ tipo: "sedan" }, { tipo: "suv" }]) === null);
  check("[U-3] deriveScope: algum sem tipo -> null", deriveScopeFromHomogeneousOffer([{ tipo: "sedan" }, { tipo: null }]) === null);
  check("[U-4] deriveScope: vazio -> null", deriveScopeFromHomogeneousOffer([]) === null);
  check("[M-1] mentionsMotorcycle 'tem moto?' -> true", mentionsMotorcycle("tem moto?") === true);
  check("[M-2] mentionsMotorcycle 'quero um sedan' -> false", mentionsMotorcycle("quero um sedan") === false);
  check("[M-3] mentionsMotorcycle 'tem scooter?' -> true", mentionsMotorcycle("tem scooter?") === true);
  check("[A-input] activeConstraintsFromStockInput ignora excludeKeys/broad, mantém escopo", (() => { const c = activeConstraintsFromStockInput({ tipo: "sedan", precoMax: 90000, cambio: "automatic", excludeKeys: ["x"], broad: true, includeMotorcycles: true }); return c.tipo === "sedan" && c.precoMax === 90000 && c.cambio === "automatic" && !("excludeKeys" in c) && !("broad" in c) && !("includeMotorcycles" in c); })());
  check("[MR-1] 'tem outros?' -> mentionsMoreOptions", buildFrameSignals("tem outros?", { relation: "ambiguous" } as TurnInterpretation).mentionsMoreOptions === true);
  check("[MR-2] 'tem mais?' -> mentionsMoreOptions", buildFrameSignals("tem mais?", { relation: "ambiguous" } as TurnInterpretation).mentionsMoreOptions === true);
  check("[MR-3] 'tem mais informações?' -> NÃO é mais opções", buildFrameSignals("tem mais informações?", { relation: "ambiguous" } as TurnInterpretation).mentionsMoreOptions === false);
  check("[MR-4] 'outras opções?' -> mentionsMoreOptions", buildFrameSignals("tem outras opções?", { relation: "ambiguous" } as TurnInterpretation).mentionsMoreOptions === true);

  // ── A — REGRESSÃO DO PRINT: "sedan -> tem outros?" herda o escopo real ──
  {
    const c = conv();
    const t1 = await c.t("conheço\nVocê tem sedan?");
    check("[A-1] T1 busca por tipo=sedan", t1.stockInput?.tipo === "sedan", `input=${JSON.stringify(t1.stockInput)}`);
    check("[A-2] T1 PERSISTE activeSearchConstraints={tipo:sedan} (da busca EXECUTADA)", t1.activeAfter?.tipo === "sedan", `activeAfter=${JSON.stringify(t1.activeAfter)}`);
    check("[A-3] T1 lista sedans e NÃO mostra a moto CB", has(t1.outbox, "Prisma") && !has(t1.outbox, "CB"), `outbox="${t1.outbox}"`);
    const t2 = await c.t("Tem outros?");
    check("[A-4] T2 HERDA tipo=sedan (não busca genérica)", t2.stockInput?.tipo === "sedan", `input=${JSON.stringify(t2.stockInput)}`);
    check("[A-5] T2 adiciona excludeKeys da oferta de T1", Array.isArray(t2.stockInput?.excludeKeys) && (t2.stockInput?.excludeKeys as string[]).length >= 5, `excludeKeys=${JSON.stringify(t2.stockInput?.excludeKeys)}`);
    check("[A-6] T2 NUNCA mostra moto CB nem carro fora de escopo (SUV/hatch)", !has(t2.outbox, "CB") && !has(t2.outbox, "Compass") && !has(t2.outbox, "Onix"), `outbox="${t2.outbox}"`);
  }

  // ── B — TETO herdado: "SUV até 90 mil" -> "tem mais?" preserva tipo+precoMax ──
  {
    const c = conv();
    const t1 = await c.t("Quero um SUV até 90 mil");
    check("[B-1] T1 busca tipo=suv precoMax=90000", t1.stockInput?.tipo === "suv" && t1.stockInput?.precoMax === 90000, `input=${JSON.stringify(t1.stockInput)}`);
    check("[B-2] persiste {tipo:suv, precoMax:90000}", t1.activeAfter?.tipo === "suv" && t1.activeAfter?.precoMax === 90000, `activeAfter=${JSON.stringify(t1.activeAfter)}`);
    const t2 = await c.t("tem mais?");
    check("[B-3] T2 herda tipo=suv E precoMax=90000 + excludeKeys", t2.stockInput?.tipo === "suv" && t2.stockInput?.precoMax === 90000 && Array.isArray(t2.stockInput?.excludeKeys), `input=${JSON.stringify(t2.stockInput)}`);
    check("[B-4] T2 sem moto", !has(t2.outbox, "CB"), `outbox="${t2.outbox}"`);
  }

  // ── C — SUV AUTOMÁTICO até 90 mil -> "tem outros?" preserva tipo+câmbio+teto ──
  {
    const c = conv();
    const t1 = await c.t("SUV automático até 90 mil");
    check("[C-1] T1 tipo=suv cambio=automatic precoMax=90000", t1.stockInput?.tipo === "suv" && t1.stockInput?.cambio === "automatic" && t1.stockInput?.precoMax === 90000, `input=${JSON.stringify(t1.stockInput)}`);
    const t2 = await c.t("tem outros?");
    check("[C-2] T2 herda tipo+câmbio+teto", t2.stockInput?.tipo === "suv" && t2.stockInput?.cambio === "automatic" && t2.stockInput?.precoMax === 90000, `input=${JSON.stringify(t2.stockInput)}`);
    check("[C-3] activeAfter mantém câmbio", t2.activeAfter?.cambio === "automatic", `activeAfter=${JSON.stringify(t2.activeAfter)}`);
  }

  // ── D — SEM escopo recuperável: "tem outros?" no vácuo -> PERGUNTA (nunca lista genérico/moto) ──
  {
    // Draft inicial inválido -> feedback; a própria LLM pede o escopo ausente. Sem oferta anterior, sem filtro ativo.
    const c = conv();
    const r = await c.t("tem outros?", "ambiguous", mute);
    check("[D-1] LLM esclarece o escopo ausente", r.reasonCode === "clarify_more_options_scope", `rc=${r.reasonCode}`);
    check("[D-2] PERGUNTA tipo/faixa (não lista)", (has(r.outbox, "tipo") || has(r.outbox, "faixa")) && !has(r.outbox, "CB") && !has(r.outbox, "Prisma"), `outbox="${r.outbox}"`);
    check("[D-3] NÃO roda stock_search sem escopo", !r.exec.includes("stock_search"), `exec=${r.exec.join(",")}`);
  }
  {
    // Cérebro que RESISTE (autora curto) -> o engine NÃO força busca genérica (requiredToolBeforeFinal suprimido).
    const c = conv();
    const r = await c.t("tem outros?", "ambiguous", resist);
    check("[D-4] resist + sem escopo -> engine NÃO força stock_search genérica", !r.exec.includes("stock_search"), `exec=${r.exec.join(",")}`);
  }

  // ── E — MOTO nunca em lista de carro (default exclui; opt-in se lead pede moto) ──
  {
    const c = conv();
    const r = await c.t("Tem Honda?");
    check("[E-1] 'tem Honda?' lista Civic e NÃO a moto CB (default exclui)", has(r.outbox, "Civic") && !has(r.outbox, "CB"), `outbox="${r.outbox}"`);
    check("[E-2] busca sem includeMotorcycles", r.stockInput?.includeMotorcycles !== true, `input=${JSON.stringify(r.stockInput)}`);
  }
  {
    // Opt-in: enrichStockSearchCall com wantsMotorcycle -> includeMotorcycles=true -> a moto pode aparecer.
    const call = enrichStockSearchCall({ tool: "stock_search", input: { marca: "Honda" } }, { popular: false, moreOptions: false, previousVehicleKeys: [], wantsMotorcycle: true });
    check("[E-3] enrich wantsMotorcycle -> includeMotorcycles=true", (call.input as { includeMotorcycles?: boolean }).includeMotorcycles === true);
    const res = await runQuery({ tool: "stock_search", input: { marca: "Honda", includeMotorcycles: true } } as QueryCall);
    const keys = res.ok && res.tool === "stock_search" ? res.data.items.map((v) => v.vehicleKey) : [];
    check("[E-4] com includeMotorcycles=true a CB entra (opt-in do lead)", keys.includes("rm:cb"), `keys=${keys.join(",")}`);
  }
  {
    // Sem includeMotorcycles a CB NUNCA entra, mesmo em busca ampla barata.
    const res = await runQuery({ tool: "stock_search", input: { precoMax: 40000 } } as QueryCall);
    const keys = res.ok && res.tool === "stock_search" ? res.data.items.map((v) => v.vehicleKey) : [];
    check("[E-5] busca barata (≤40k) sem flag -> CB (32k) EXCLUÍDA", !keys.includes("rm:cb"), `keys=${keys.join(",")}`);
  }

  // ── F — OBSERVABILIDADE (before/after + input executado + herança) ──
  {
    const c = conv();
    const t1 = await c.t("Você tem sedan?");
    check("[F-1] após T1: activeAfter={tipo:sedan} (persistido do filtersUsed real)", t1.activeAfter?.tipo === "sedan", `activeAfter=${JSON.stringify(t1.activeAfter)}`);
    const t2 = await c.t("tem outros?");
    // activeBefore(T2) == activeAfter(T1) == {tipo:sedan}; stockSearchInputExecuted = t2.stockInput; herança visível.
    check("[F-2] stockSearchInputExecuted registra o input REAL herdado (tipo=sedan + excludeKeys)", t2.stockInput?.tipo === "sedan" && Array.isArray(t2.stockInput?.excludeKeys), `input=${JSON.stringify(t2.stockInput)}`);
    check("[F-3] activeAfter(T2) permanece {tipo:sedan}", t2.activeAfter?.tipo === "sedan", `activeAfter=${JSON.stringify(t2.activeAfter)}`);
  }

  console.log(`\n== F2.29: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
