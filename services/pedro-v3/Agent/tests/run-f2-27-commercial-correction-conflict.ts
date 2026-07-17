// ============================================================================
// F2.27 — P0 (audit Codex, Evidence 1/6): CORREÇÃO explícita + CONFLITO tipo↔modelo no filtro comercial ativo.
//  Inv.1: modelo específico novo (Compass) SOLTA o tipo antigo conflitante (sedan). Nunca stock_search Compass+sedan.
//  Inv.2: correção explícita ("esquece o sedan", "não é sedan") remove o tipo do filtro ativo.
//  Evidence 6: tipo novo ("quero SUV") limpa o modelo anterior.
//  G (Evidence 5): qualificação vira FATO (entrada=0, parcela=3500, possuiTroca=false) — já em lead-extraction.
//   npx tsx tests/run-f2-27-commercial-correction-conflict.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { mergeActiveConstraints, detectCorrections, detectCommercialConstraints } from "../src/engine/commercial-constraints.ts";
import { extractLeadSlots } from "../src/engine/lead-extraction.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildFrameSignals } from "../src/engine/turn-frame-builder.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createInitialState, type ConversationState, type ActiveSearchConstraints } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, TurnInterpretation, DecisionMutation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-06T12:00:00.000Z", SHA = "sha-27";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

const COMPASS: VehicleFact = { vehicleKey: "revendamais:compass", marca: "Jeep", modelo: "Compass", ano: 2018, preco: 89990, km: 70000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const ONIX: VehicleFact = { vehicleKey: "revendamais:onix", marca: "Chevrolet", modelo: "Onix", ano: 2016, preco: 49990, km: 90000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const PRISMA: VehicleFact = { vehicleKey: "revendamais:prisma", marca: "Chevrolet", modelo: "Prisma", ano: 2017, preco: 55990, km: 80000, cambio: "Manual", cor: "Preto", tipo: "sedan" };
const RENEGADE: VehicleFact = { vehicleKey: "revendamais:renegade", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 95990, km: 55000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const STOCK = [COMPASS, ONIX, PRISMA, RENEGADE];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; cambio?: string; popular?: boolean; broad?: boolean; excludeKeys?: string[] };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m) || m.includes(norm(v.marca))); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return inp.broad ? toks.some((t) => vt.includes(t)) : toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
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
// ⭐AUTORIDADE (audit Codex): os turnos desta suíte são CORREÇÕES DE BUSCA ("esquece o sedan, quero Compass") — a LLM
// real classifica search_stock. O responder declara o ATO (capability+evidence) mas RESISTE a chamar a tool: o executor
// determinístico garante a execução com o filtro corrigido (o que a suíte prova), agora sob a autoridade da LLM.
const resist: BrainResponder = (f, observations) => {
  const understanding = {
    ...U("search_stock"), requestedCapabilities: ["stock_search"] as TurnUnderstanding["requestedCapabilities"],
    evidence: [{ capability: "stock_search" as const, quote: (f.block ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || "tem" }],
  };
  const stock = [...observations].reverse().find((o) => o.tool === "stock_search" && o.ok) as { ok: true; tool: "stock_search"; data: { items: VehicleFact[] } } | undefined;
  if (!stock) return { kind: "query", call: { tool: "stock_search", input: {} }, understanding };
  return stock.data.items.length > 0
    ? finU([txt("Encontrei estas opções para você:"), offer(stock.data.items.map((v) => v.vehicleKey)), txt("Qual delas chamou sua atenção?")], "offer_stock", understanding)
    : finU([txt("Não encontrei opções com esses critérios agora. Quer ajustar algum filtro?")], "empty_stock", understanding);
};

type Cap = { outbox: string; committed: boolean; exec: string[]; stockInput: Record<string, unknown> | null; reasonCode: string | null; activeAfter: ActiveSearchConstraints | null };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, relation: TurnRelation): Promise<Cap> {
  executed.length = 0; preparer.relation = relation; brain.setResponder(resist);
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
  const stock = executed.find((e) => e.tool === "stock_search");
  const after = (await persistence.load(convId))?.state as ConversationState | undefined;
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    exec: executed.map((e) => e.tool), stockInput: stock ? (stock.input as Record<string, unknown>) : null,
    reasonCode: r.status === "committed" ? r.decision.reasonCode : null, activeAfter: after?.activeSearchConstraints ?? null,
  };
}
let seq0 = 0;
function conv(seedState?: Partial<ConversationState>) {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `conv-${seq0++}`; let s = 0;
  const seed = async (): Promise<void> => { if (!seedState) return; const base = { ...createInitialState({ conversationId: id, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }), ...seedState } as ConversationState; const uow = persistence.begin(); uow.casState(id, 0, base); if (!(await uow.commit()).ok) throw new Error("seed_failed"); };
  const t = (lead: string, relation: TurnRelation = "ambiguous"): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, relation);
  return { seed, t };
}
const active = (c: ActiveSearchConstraints) => ({ activeSearchConstraints: c } as Partial<ConversationState>);
// helper para extractLeadSlots direto (qualificação)
function slots(lead: string, seed?: Partial<ConversationState>): DecisionMutation[] {
  const st = { ...createInitialState({ conversationId: "x", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }), ...seed } as ConversationState;
  return extractLeadSlots({ leadMessage: lead, state: st, interpretation: { relation: "ambiguous" } as TurnInterpretation, claimExtractor: extractor, turnId: "t" });
}
const slotVal = (muts: DecisionMutation[], slot: string): unknown => (muts.find((m) => m.op === "set_slot" && (m as { slot?: string }).slot === slot) as { value?: unknown } | undefined)?.value;

async function main(): Promise<void> {
  console.log("== F2.27: correção explícita + conflito tipo↔modelo ==");

  // ── PARTE 1 — PURO ──
  check("[C-1] detectCorrections('Compass não é sedan') -> remove sedan", detectCorrections("Mas o Compass não é sedan").removedTypes.includes("sedan"));
  check("[C-2] detectCorrections('esquece o sedan') -> remove sedan", detectCorrections("esquece o sedan").removedTypes.includes("sedan"));
  check("[C-3] detectCorrections('não quero suv') -> remove suv", detectCorrections("não quero suv, quero hatch").removedTypes.includes("suv"));
  check("[C-4] sem correção -> vazio", detectCorrections("quero um compass até 100 mil").removedTypes.length === 0);
  check("[D-1] detectCommercialConstraints('Compass não é sedan') NÃO seta tipo (negado) + modelo=compass", (() => { const c = detectCommercialConstraints({ block: "Compass não é sedan, quero Compass", signals: buildFrameSignals("Compass não é sedan, quero Compass", { relation: "ambiguous" } as TurnInterpretation), claimExtractor: extractor }); return c.tipo === undefined && (c.modelos ?? []).some((m) => has(m, "compass")); })());
  check("[M-1] Inv.1: modelo novo (compass) SOLTA tipo antigo (sedan)", (() => { const m = mergeActiveConstraints({ tipo: "sedan", precoMax: 100000 }, { modelos: ["compass"] }); return m.tipo === undefined && JSON.stringify(m.modelos) === JSON.stringify(["compass"]) && m.precoMax === 100000; })());
  check("[M-2] Inv.2: correção remove tipo do ativo (sem novo modelo)", (() => { const m = mergeActiveConstraints({ tipo: "sedan", precoMax: 100000 }, {}, { removedTypes: ["sedan"] }); return m.tipo === undefined && m.precoMax === 100000; })());
  check("[M-3] Evidence 6: tipo novo (suv) limpa modelos antigos", (() => { const m = mergeActiveConstraints({ modelos: ["onix"], precoMax: 100000 }, { tipo: "suv" }); return m.tipo === "suv" && m.modelos === undefined; })());
  check("[M-4] correção de tipo NÃO mexe em modelo/preço", (() => { const m = mergeActiveConstraints({ tipo: "sedan", modelos: ["compass"], precoMax: 100000 }, {}, { removedTypes: ["sedan"] }); return m.tipo === undefined && JSON.stringify(m.modelos) === JSON.stringify(["compass"]) && m.precoMax === 100000; })());

  // ── PARTE 2 — G (Evidence 5): qualificação vira fato (extractLeadSlots) ──
  check("[G-1] 'Não tenho entrada' -> entrada=0", slotVal(slots("Não tenho entrada"), "entrada") === 0);
  check("[G-2] 'Até 3,5k de parcela' -> parcelaDesejada=3500", slotVal(slots("Até 3,5k de parcela"), "parcelaDesejada") === 3500);
  check("[G-3] 'Não tenho carro pra troca' -> possuiTroca=false", slotVal(slots("Não tenho carro pra troca"), "possuiTroca") === false);

  // ── PARTE 3 — INTEGRAÇÃO A (Evidence 1): Compass preso em Sedan ──
  {
    // Estado ativo: tipo=sedan, precoMax=100000 (contexto anterior "sedan até 100 mil").
    const c = conv(active({ tipo: "sedan", precoMax: 100000 })); await c.seed();
    const r = await c.t("Tem algum Compass?");
    check("[A-1a] busca por Compass (modelo), SEM tipo=sedan", has(String(r.stockInput?.modelo ?? ""), "compass") && r.stockInput?.tipo === undefined, `input=${JSON.stringify(r.stockInput)}`);
    check("[A-1b] preserva o teto de 100 mil", r.stockInput?.precoMax === 100000);
    check("[A-1c] resposta NÃO diz 'Compass SEDAN' e lista o Compass", !has(r.outbox, "sedan") && has(r.outbox, "Compass"), `outbox="${r.outbox}"`);
    check("[A-1d] filtro ativo persistido sem tipo (sedan removido)", r.activeAfter?.tipo === undefined && (r.activeAfter?.modelos ?? []).some((m) => has(m, "compass")), `active=${JSON.stringify(r.activeAfter)}`);

    // Correção explícita depois (belt-and-suspenders): continua Compass, sem sedan.
    const r2 = await c.t("Mas Compass não é sedan, esquece o sedan, quero Compass");
    check("[A-2] correção mantém Compass, sem tipo sedan", has(String(r2.stockInput?.modelo ?? ""), "compass") && r2.stockInput?.tipo === undefined && !has(r2.outbox, "sedan"), `input=${JSON.stringify(r2.stockInput)} outbox="${r2.outbox}"`);
  }

  // ── Correção "esquece o sedan" a partir de tipo=sedan ativo, num único turno com novo modelo ──
  {
    const c = conv(active({ tipo: "sedan", precoMax: 100000 })); await c.seed();
    const r = await c.t("esquece o sedan, quero um Compass");
    check("[A-3] 'esquece o sedan' + Compass -> busca Compass sem sedan", has(String(r.stockInput?.modelo ?? ""), "compass") && r.stockInput?.tipo === undefined, `input=${JSON.stringify(r.stockInput)}`);
  }

  // ── INTEGRAÇÃO Evidence 6: tipo novo limpa modelo anterior ──
  {
    const c = conv(active({ modelos: ["onix"], precoMax: 100000 })); await c.seed();
    const r = await c.t("na verdade queria um SUV até 100 mil");
    check("[E6-a] tipo novo (suv) busca por tipo, SEM modelo=onix", r.stockInput?.tipo === "suv" && !has(String(r.stockInput?.modelo ?? ""), "onix"), `input=${JSON.stringify(r.stockInput)}`);
    check("[E6-b] lista SUV (Compass/Renegade)", has(r.outbox, "Compass") || has(r.outbox, "Renegade"), `outbox="${r.outbox}"`);
  }

  console.log(`\n== F2.27: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
