// ============================================================================
// F2.25 — P0 (LLM-first SDR): filtro comercial DISPARA stock_search. Se o lead dá marca/modelo/tipo/preço/câmbio/
// popular, o engine FORÇA a busca (nunca recovery_stock_not_run / "qual modelo procura?") e ENRIQUECE a chamada
// executada (marca canonicalizada volks->volkswagen, preçoMax, etc.). Estoque VW/Fiat/Chevrolet; effects OFF.
//   npx tsx tests/run-f2-25-commercial-constraint-search.ts
// ============================================================================
import { runCentralConversationTurn, enrichStockSearchCall, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { detectCommercialConstraints, sufficientForStockSearch, detectBrand, canonicalBrand, describeConstraints } from "../src/engine/commercial-constraints.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildFrameSignals } from "../src/engine/turn-frame-builder.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createInitialState, type ConversationState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, CentralQueryCall, TurnUnderstanding, TurnCapability, TurnSubjectKind, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, TurnInterpretation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-06T12:00:00.000Z", SHA = "sha-25";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Estoque: VW Gol (≤50k), Fiat Palio (≤50k, marca diferente), VW Polo (>50k), Chevrolet Onix (foto).
const GOL: VehicleFact = { vehicleKey: "revendamais:gol", marca: "Volkswagen", modelo: "Gol", ano: 2018, preco: 45990, km: 70000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const PALIO: VehicleFact = { vehicleKey: "revendamais:palio", marca: "Fiat", modelo: "Palio", ano: 2016, preco: 38990, km: 90000, cambio: "Manual", cor: "Branco", tipo: "hatch" };
const POLO: VehicleFact = { vehicleKey: "revendamais:polo", marca: "Volkswagen", modelo: "Polo", ano: 2021, preco: 82990, km: 30000, cambio: "Automatico", cor: "Cinza", tipo: "hatch" };
const ONIX: VehicleFact = { vehicleKey: "revendamais:onix", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 49990, km: 120000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const STOCK = [GOL, PALIO, POLO, ONIX];
const POPULAR = new Set([GOL.vehicleKey, PALIO.vehicleKey, ONIX.vehicleKey]); // Polo fora do "popular" p/ o teste
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; cambio?: string; popular?: boolean };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => { const b = norm(v.marca); return b.includes(m) || m.includes(b); }); }
    if (inp.modelo) { const mm = norm(inp.modelo); items = items.filter((v) => norm(`${v.marca} ${v.modelo}`).split(/\s+/).some((tok) => mm.includes(tok)) || norm(`${v.marca} ${v.modelo}`).includes(mm)); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    if (inp.cambio) items = items.filter((v) => (inp.cambio === "automatic") === /autom/i.test(v.cambio ?? ""));
    if (inp.popular) items = items.filter((v) => POPULAR.has(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

type UOpts = { caps?: TurnCapability[]; subject?: TurnSubjectKind; subjectValue?: string | null; evidence?: { capability?: TurnCapability; quote: string }[] };
const U = (primaryIntent: PrimaryIntent, o: UOpts = {}): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: o.caps ?? [], subject: o.subject ?? "none", subjectValue: o.subjectValue ?? null, subjectSource: "current_turn", evidence: o.evidence ?? [], isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const offer = (keys: string[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: keys });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const qU = (call: CentralQueryCall, u: TurnUnderstanding): AgentBrainStep => ({ kind: "query", call, understanding: u });
function finU(parts: ResponsePart[], effects: ProposedEffectPlan[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}

type Cap = { status: string; outbox: string; src: string; committed: boolean; hasMedia: boolean; exec: string[]; execCalls: QueryCall[]; recoveryReason: string | null; reasonCode: string | null; policyFeedback: string[] };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, script: AgentBrainStep[] | BrainResponder): Promise<Cap> {
  executed.length = 0; preparer.relation = "ambiguous";
  if (typeof script === "function") brain.setResponder(script); else brain.setTurnScript(script);
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
  const execCalls = executed.slice();
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    status: r.status, outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", src: r.status === "committed" ? r.responseSource : r.status,
    committed: r.status === "committed", hasMedia: outbox.some((o) => o.kind === "send_media"), exec: execCalls.map((e) => e.tool), execCalls,
    recoveryReason: r.status === "committed" ? r.recoveryReason : null, reasonCode: r.status === "committed" ? r.decision.reasonCode : null, policyFeedback: r.status === "committed" ? [...r.policyFeedback] : [],
  };
}
let seq0 = 0;
function conv(seedState?: Partial<ConversationState>) {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `conv-${seq0++}`; let s = 0;
  const seed = async (): Promise<void> => { if (!seedState) return; const base = { ...createInitialState({ conversationId: id, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }), ...seedState } as ConversationState; const uow = persistence.begin(); uow.casState(id, 0, base); if (!(await uow.commit()).ok) throw new Error("seed_failed"); };
  const t = (lead: string, script: AgentBrainStep[] | BrainResponder): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, script);
  return { seed, t };
}
const sel = (v: VehicleFact) => ({ vehicleContext: { selected: { kind: "vehicle" as const, key: v.vehicleKey, label: `${v.marca} ${v.modelo} ${v.ano}` } } } as Partial<ConversationState>);
// helper puro p/ os testes de detecção
const detect = (block: string) => detectCommercialConstraints({ block, signals: buildFrameSignals(block, { relation: "ambiguous" } as TurnInterpretation), claimExtractor: extractor });

async function main(): Promise<void> {
  console.log("== F2.25: filtro comercial dispara stock_search ==");

  // ── PARTE 1 — PURO: detecção de marca + constraints ──
  check("[P-brand-a] 'volks' -> volkswagen", detectBrand("que seja da volks") === "volkswagen");
  check("[P-brand-b] 'vw' -> volkswagen", detectBrand("um vw qualquer") === "volkswagen");
  check("[P-brand-c] 'Volkswagen' pleno -> volkswagen", detectBrand("quero um Volkswagen") === "volkswagen");
  check("[P-brand-d] 'chevrolet' -> chevrolet", detectBrand("tem chevrolet?") === "chevrolet");
  check("[P-brand-e] sem marca -> null", detectBrand("quero um carro barato") === null);
  check("[P-canon] canonicalBrand('vw') -> volkswagen", canonicalBrand("vw") === "volkswagen");

  check("[P-det-a] 'Até 50 mil e que seja da volks' -> marca=volkswagen + precoMax=50000", (() => { const c = detect("Até 50 mil e que seja da volks"); return c.marca === "volkswagen" && c.precoMax === 50000; })());
  check("[P-det-b] 'popular até 50 mil' -> popular + precoMax=50000", (() => { const c = detect("popular até 50 mil"); return c.popular === true && c.precoMax === 50000; })());
  check("[P-det-c] 'Volks até 50k automático' -> marca+precoMax+cambio", (() => { const c = detect("Volks até 50k automático"); return c.marca === "volkswagen" && c.precoMax === 50000 && c.cambio === "automatic"; })());
  check("[P-det-d] 'Tem palio?' -> modelo (suficiente)", (() => { const c = detect("Tem palio?"); return (c.modelos?.length ?? 0) > 0 && sufficientForStockSearch(c); })());
  check("[P-suf-a] só saudação 'boa tarde' -> NÃO suficiente", sufficientForStockSearch(detect("boa tarde")) === false);
  check("[P-suf-b] nome 'Douglas' -> NÃO suficiente", sufficientForStockSearch(detect("Douglas")) === false);
  check("[P-desc] describeConstraints(volks+50k) nomeia marca e faixa", (() => { const d = describeConstraints({ marca: "volkswagen", precoMax: 50000 }); return has(d, "Volkswagen") && has(d, "50"); })());

  // ── PARTE 2 — PURO: enriquecimento da chamada executada ──
  {
    const base: QueryCall = { tool: "stock_search", input: { precoMax: 50000 } };
    const enriched = enrichStockSearchCall(base, { popular: false, moreOptions: false, previousVehicleKeys: [], constraints: { marca: "volkswagen", precoMax: 50000 } });
    check("[P-enrich-a] preenche marca quando o cérebro omite", (enriched.input as { marca?: string }).marca === "volkswagen");
  }
  {
    const base: QueryCall = { tool: "stock_search", input: { marca: "fiat", precoMax: 30000 } };
    const enriched = enrichStockSearchCall(base, { popular: false, moreOptions: false, previousVehicleKeys: [], constraints: { marca: "volkswagen", precoMax: 50000 } });
    check("[P-enrich-b] valor EXPLÍCITO do cérebro vence (não sobrescreve marca=fiat)", (enriched.input as { marca?: string }).marca === "fiat" && (enriched.input as { precoMax?: number }).precoMax === 30000);
  }

  // ── PARTE 3 — INTEGRAÇÃO ──
  // INT-1: cérebro busca (omitindo marca) -> enriquecimento adiciona marca=volkswagen+precoMax -> lista Gol, não Palio/Polo.
  {
    const c = conv(); await c.seed();
    const searchU = U("search_stock", { caps: ["stock_search"], subject: "vehicle_type", evidence: [{ capability: "stock_search", quote: "volks" }] });
    const responder: BrainResponder = (_f, obs) => {
      const s = obs.find((o) => o.tool === "stock_search" && o.ok) as { ok: true; tool: "stock_search"; data: { items: VehicleFact[] } } | undefined;
      if (!s) return qU({ tool: "stock_search", input: { precoMax: 50000 } } as CentralQueryCall, searchU);
      return finU([txt("Encontrei estas opções pra você:"), offer(s.data.items.map((v) => v.vehicleKey)), txt("Quer ver as fotos de alguma?")], [reply], "offer", searchU);
    };
    const r = await c.t("Até 50 mil e que seja da volks", responder);
    const stockCall = r.execCalls.find((e) => e.tool === "stock_search")?.input as { marca?: string; precoMax?: number } | undefined;
    check("[I-1a] rodou stock_search", r.exec.includes("stock_search"), `exec=${r.exec.join(",")}`);
    check("[I-1b] chamada executada tem marca=volkswagen (enriquecida)", stockCall?.marca === "volkswagen", `marca=${stockCall?.marca}`);
    check("[I-1c] chamada executada tem precoMax=50000", stockCall?.precoMax === 50000);
    check("[I-1d] resposta lista o Gol (VW ≤50k)", has(r.outbox, "Gol"), `outbox="${r.outbox}"`);
    check("[I-1e] NÃO lista Palio (Fiat) nem Polo (>50k)", !has(r.outbox, "Palio") && !has(r.outbox, "Polo"));
    check("[I-1f] NÃO é recuperação", r.src !== "deterministic_recovery" && r.recoveryReason == null, `src=${r.src}`);
  }
  // INT-2: o detector não executa nem substitui a decisão da LLM. A LLM
  // declara stock_search no próprio passo e recebe os fatos para redigir.
  {
    const c = conv(); await c.seed();
    const searchU = U("search_stock", { caps: ["stock_search"], subject: "budget", subjectValue: "50000", evidence: [{ capability: "stock_search", quote: "Até 50 mil" }] });
    const responder: BrainResponder = (_f, obs) => {
      const stock = obs.find((o) => o.tool === "stock_search" && o.ok) as { ok: true; tool: "stock_search"; data: { items: VehicleFact[] } } | undefined;
      if (stock) return finU([txt("Encontrei estas opções pra você:"), offer(stock.data.items.map((v) => v.vehicleKey)), txt("Qual delas chamou sua atenção?")], [reply], "offer", searchU);
      return qU({ tool: "stock_search", input: { precoMax: 50000 } } as CentralQueryCall, searchU);
    };
    const r = await c.t("Até 50 mil e que seja da volks", responder);
    check("[I-2a] detector não executa; LLM corrigida chama stock_search", r.exec.filter((tool) => tool === "stock_search").length === 1, `exec=${r.exec.join(",")} feedback=${JSON.stringify(r.policyFeedback)}`);
    check("[I-2b] NUNCA recovery comercial (engine não lista no lugar da LLM)", r.reasonCode !== "recovery_offer" && r.reasonCode !== "recovery_stock_not_run" && r.reasonCode !== "recovery_stock_will_search", `rc=${r.reasonCode}`);
    check("[I-2c] a resposta é a AUTORIA da LLM (brain_final/brain_retry)", r.src === "brain_final" || r.src === "brain_retry", `src=${r.src}`);
    check("[I-2d] a LLM lista o estoque sem reperguntar o filtro", has(r.outbox, "Gol") && !has(r.outbox, "tipo de carro"), `outbox="${r.outbox}"`);
  }
  // INT-3: turno de FOTO ("me manda foto do Onix") NÃO é forçado a buscar — regressão do gate por intenção.
  {
    const c = conv(sel(ONIX)); await c.seed();
    const photoU = U("request_photos", { caps: ["send_photos"], subject: "explicit_model", subjectValue: "Onix", evidence: [{ capability: "send_photos", quote: "foto" }] });
    const responder: BrainResponder = (_f, obs) => obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok)
      ? finU([txt("Aqui estão as fotos do Onix! 😊")], [reply, { kind: "send_media", planId: "m", order: 1, vehicleKey: ONIX.vehicleKey, photoIds: ["p1", "p2"], onSuccess: [] } as ProposedEffectPlan], "send_vehicle_photos", photoU)
      : qU({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: ONIX.vehicleKey } } } as CentralQueryCall, photoU);
    const r = await c.t("me manda foto do Onix", responder);
    check("[I-3a] turno de foto -> NÃO rodou stock_search (não forçado)", !r.exec.includes("stock_search"), `exec=${r.exec.join(",")}`);
    check("[I-3b] enviou a foto normalmente", r.hasMedia === true && r.committed);
  }
  // INT-4: constraint 'até 20 mil da volks' — sem VW ≤20k, MAS há VW acima (Gol/Polo). O engine pode consultar
  // alternativas factuais; a LLM recebe os resultados e autora a condução. Nunca há recovery comercial escrito pelo engine.
  {
    const c = conv(); await c.seed();
    const searchU = U("search_stock", { caps: ["stock_search"], evidence: [{ capability: "stock_search", quote: "volks" }] });
    const responder: BrainResponder = (_f, obs) => {
      const searches = obs.filter((o) => o.tool === "stock_search" && o.ok) as { ok: true; tool: "stock_search"; data: { items: VehicleFact[] } }[];
      if (searches.length === 0) return qU({ tool: "stock_search", input: { precoMax: 20000, marca: "volkswagen" } } as CentralQueryCall, searchU);
      const withItems = [...searches].reverse().find((s) => s.data.items.length > 0);
      return withItems
        ? finU(
            [txt("Não encontrei Volkswagen até R$ 20 mil, mas encontrei estes Volkswagen em uma faixa próxima:"), offer(withItems.data.items.map((v) => v.vehicleKey)), txt("Quer que eu detalhe algum deles?")],
            [reply],
            "offer_relaxed_stock",
            searchU,
          )
        : finU([txt("Não encontrei Volkswagen até R$ 20 mil no estoque agora. Você prefere ampliar a faixa ou considerar outra marca?")], [reply], "empty_stock_honest", searchU);
    };
    const r = await c.t("até 20 mil e que seja da volks", responder);
    check("[I-4a] rodou stock_search (vazio)", r.exec.includes("stock_search"));
    check("[I-4b] LLM conduz a busca vazia nomeando o filtro e opções próximas", (r.src === "brain_final" || r.src === "brain_retry") && has(r.outbox, "Volkswagen") && !/qual (modelo|tipo)/i.test(norm(r.outbox)) && (has(r.outbox, "Gol") || has(r.outbox, "Polo") || r.reasonCode === "empty_stock_honest"), `src=${r.src} rc=${r.reasonCode} outbox="${r.outbox}"`);
  }

  console.log(`\n== F2.25: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
