// ============================================================================
// F2.26 — P0 (audit Codex): FILTRO DE BUSCA ATIVO acumulado entre turnos (o lead refina a MESMA intenção). Merge
// conservador (cada dimensão do bloco atual substitui; ausente preserva; modelo pelado solta a marca). Foto/detalhe/
// institucional NÃO tocam o filtro. Executor determinístico de busca -> NUNCA promessa falsa "vou procurar" sem ação.
//   npx tsx tests/run-f2-26-active-search-constraints.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { mergeActiveConstraints, detectCommercialConstraints, constraintsToStockInput } from "../src/engine/commercial-constraints.ts";
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
import type { AgentBrainStep, AgentBrainDecision, CentralQueryCall, TurnUnderstanding, TurnCapability, TurnSubjectKind, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, TurnInterpretation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-06T12:00:00.000Z", SHA = "sha-26";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// GOL (VW, automático, ≤50k), PALIO (Fiat, ≤50k), POLO (VW, >50k), ONIX (Chevrolet, ≤50k).
const GOL: VehicleFact = { vehicleKey: "revendamais:gol", marca: "Volkswagen", modelo: "Gol", ano: 2019, preco: 45990, km: 60000, cambio: "Automatico", cor: "Prata", tipo: "hatch" };
const PALIO: VehicleFact = { vehicleKey: "revendamais:palio", marca: "Fiat", modelo: "Palio", ano: 2016, preco: 38990, km: 90000, cambio: "Manual", cor: "Branco", tipo: "hatch" };
const POLO: VehicleFact = { vehicleKey: "revendamais:polo", marca: "Volkswagen", modelo: "Polo", ano: 2021, preco: 82990, km: 30000, cambio: "Automatico", cor: "Cinza", tipo: "hatch" };
const ONIX: VehicleFact = { vehicleKey: "revendamais:onix", marca: "Chevrolet", modelo: "Onix", ano: 2015, preco: 49990, km: 110000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const STOCK = [GOL, PALIO, POLO, ONIX];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua X, 100", hours: null, unit: "Icom", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; cambio?: string; popular?: boolean; broad?: boolean; excludeKeys?: string[] };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => { const b = norm(v.marca); return b.includes(m) || m.includes(b); }); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return inp.broad ? toks.some((t) => vt.includes(t)) : toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    if (inp.cambio) items = items.filter((v) => (inp.cambio === "automatic") === /autom/i.test(v.cambio ?? ""));
    if (inp.popular) items = items.filter((v) => v.vehicleKey !== POLO.vehicleKey);
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
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
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const qU = (call: CentralQueryCall, u: TurnUnderstanding): AgentBrainStep => ({ kind: "query", call, understanding: u });
function finU(parts: ResponsePart[], effects: ProposedEffectPlan[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
// Cérebro RESISTENTE "other": devolve um final simples SEM classificar busca. ⭐AUTORIDADE (audit Codex): sem o ATO
// search_stock declarado pela LLM, o engine NÃO busca por keyword — usado nos turnos NÃO-comerciais (foto/institucional).
const resist: BrainResponder = () => finU([txt("Certo!")], [reply], "reply", U("other"));
// Cérebro que CLASSIFICA busca (como a gpt-4.1-mini faria em "Tem Palio? Ou Gol?") mas RESISTE a chamar a tool.
// ⭐Contrato novo: a LLM AUTORIZOU (ato search_stock + capability), então o executor determinístico GARANTE a execução
// com o filtro MERGEADO — é o que esta suíte prova (merge entre turnos + nunca promessa falsa), agora sob a autoridade da LLM.
const resistSearch: BrainResponder = (f) => finU([txt("Certo!")], [reply], "reply", U("search_stock", {
  caps: ["stock_search"],
  evidence: [{ capability: "stock_search", quote: (f.block ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || "tem" }],
}));

type Cap = { outbox: string; committed: boolean; hasMedia: boolean; exec: string[]; stockInput: Record<string, unknown> | null; reasonCode: string | null; activeAfter: ActiveSearchConstraints | null };
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
  const stock = executed.find((e) => e.tool === "stock_search");
  const after = (await persistence.load(convId))?.state as ConversationState | undefined;
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed", hasMedia: outbox.some((o) => o.kind === "send_media"),
    exec: executed.map((e) => e.tool), stockInput: stock ? (stock.input as Record<string, unknown>) : null, reasonCode: r.status === "committed" ? r.decision.reasonCode : null,
    activeAfter: after?.activeSearchConstraints ?? null,
  };
}
let seq0 = 0;
function conv(seedState?: Partial<ConversationState>) {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `conv-${seq0++}`; let s = 0;
  const seed = async (): Promise<void> => { if (!seedState) return; const base = { ...createInitialState({ conversationId: id, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }), ...seedState } as ConversationState; const uow = persistence.begin(); uow.casState(id, 0, base); if (!(await uow.commit()).ok) throw new Error("seed_failed"); };
  // Default = resistSearch: os turnos da suíte são COMERCIAIS (a LLM real classificaria busca); foto/institucional passam `resist`.
  const t = (lead: string, script: AgentBrainStep[] | BrainResponder = resistSearch): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, script);
  return { seed, t };
}
const offerCtx = (vs: VehicleFact[]) => ({ lastRenderedOfferContext: { sourceTurnId: "seed", createdAt: NOW, items: vs.map((v, i) => ({ ordinal: i + 1, vehicleKey: v.vehicleKey, marca: v.marca, modelo: v.modelo, ano: v.ano, preco: v.preco })) } } as Partial<ConversationState>);
const detect = (block: string) => detectCommercialConstraints({ block, signals: buildFrameSignals(block, { relation: "ambiguous" } as TurnInterpretation), claimExtractor: extractor });

async function main(): Promise<void> {
  console.log("== F2.26: ActiveSearchConstraints (merge entre turnos) ==");

  // ── PARTE 1 — PURO: merge conservador ──
  check("[M-1] modelos + (até 50 mil) preserva modelos e adiciona teto", (() => { const m = mergeActiveConstraints({ modelos: ["palio", "gol"] }, { precoMax: 50000 }); return JSON.stringify(m.modelos) === JSON.stringify(["palio", "gol"]) && m.precoMax === 50000; })());
  check("[M-2] (marca volks, sem modelo) estreita: adiciona marca, mantém modelos", (() => { const m = mergeActiveConstraints({ modelos: ["palio", "gol"], precoMax: 50000 }, { marca: "volkswagen" }); return m.marca === "volkswagen" && JSON.stringify(m.modelos) === JSON.stringify(["palio", "gol"]); })());
  check("[M-3] modelo NOVO pelado (Onix) solta a marca antiga (VW)", (() => { const m = mergeActiveConstraints({ marca: "volkswagen", precoMax: 50000 }, { modelos: ["onix"] }); return m.marca === undefined && JSON.stringify(m.modelos) === JSON.stringify(["onix"]) && m.precoMax === 50000; })());
  check("[M-4] bloco vazio (mais opções) preserva tudo", (() => { const base = { marca: "volkswagen", modelos: ["gol"], precoMax: 50000, cambio: "automatic" as const }; const m = mergeActiveConstraints(base, {}); return JSON.stringify(m) === JSON.stringify(base); })());
  check("[M-5] novo teto substitui o antigo", mergeActiveConstraints({ precoMax: 50000 }, { precoMax: 30000 }).precoMax === 30000);

  // ── PARTE 2 — INTEGRAÇÃO: fluxo de refinamento T1→T5 (uma conversa, estado persiste) ──
  {
    const c = conv(); await c.seed();
    const t1 = await c.t("Tem Palio? Ou Gol?");
    check("[T1a] busca por modelos Palio/Gol (broad)", has(String(t1.stockInput?.modelo ?? ""), "palio") && has(String(t1.stockInput?.modelo ?? ""), "gol"), `input=${JSON.stringify(t1.stockInput)}`);
    check("[T1b] filtro ativo persistido com os modelos", (t1.activeAfter?.modelos?.length ?? 0) === 2);

    const t2 = await c.t("Até 50 mil");
    check("[T2a] (#1) preserva modelos + adiciona teto=50000", (t2.stockInput?.precoMax === 50000) && has(String(t2.stockInput?.modelo ?? ""), "gol"), `input=${JSON.stringify(t2.stockInput)}`);
    check("[T2b] ativo tem modelos + precoMax", (t2.activeAfter?.modelos?.length ?? 0) === 2 && t2.activeAfter?.precoMax === 50000);

    const t3 = await c.t("Que seja volks");
    check("[T3a] (#2) estreita p/ marca Volkswagen (executado tem marca=volkswagen + teto)", t3.stockInput?.marca === "volkswagen" && t3.stockInput?.precoMax === 50000, `input=${JSON.stringify(t3.stockInput)}`);
    check("[T3b] (#2) LISTA o Gol (VW) e NÃO lista o Palio (Fiat)", has(t3.outbox, "Gol") && !has(t3.outbox, "Palio"), `outbox="${t3.outbox}"`);

    const t4 = await c.t("Pode ser automático");
    check("[T4a] adiciona câmbio automático preservando marca+teto", t4.stockInput?.cambio === "automatic" && t4.stockInput?.marca === "volkswagen" && t4.stockInput?.precoMax === 50000, `input=${JSON.stringify(t4.stockInput)}`);

    const t5 = await c.t("Me mostra outras");
    check("[T5a] (#3) 'mais opções' preserva marca+teto+câmbio e EXCLUI ofertados", t5.stockInput?.marca === "volkswagen" && t5.stockInput?.precoMax === 50000 && t5.stockInput?.cambio === "automatic" && Array.isArray(t5.stockInput?.excludeKeys) && (t5.stockInput?.excludeKeys as string[]).length > 0, `input=${JSON.stringify(t5.stockInput)}`);
  }

  // ── #4: "tem Onix?" depois de Volkswagen troca o foco (solta a marca VW) ──
  {
    const c = conv(); await c.seed();
    await c.t("quero um volkswagen até 50 mil");
    const t2 = await c.t("tem Onix?");
    check("[#4a] busca por Onix (modelo), SEM marca=volkswagen (foco trocado)", has(String(t2.stockInput?.modelo ?? ""), "onix") && t2.stockInput?.marca !== "volkswagen", `input=${JSON.stringify(t2.stockInput)}`);
    check("[#4b] LISTA o Onix (Chevrolet)", has(t2.outbox, "Onix"), `outbox="${t2.outbox}"`);
  }

  // ── #5: "me manda foto do segundo" NÃO ativa stock_search ──
  {
    const c = conv(offerCtx([GOL, PALIO])); await c.seed();
    const r = await c.t("me manda foto do segundo", resist);   // a LLM NÃO classifica busca num pedido de foto
    check("[#5] turno de foto NÃO roda stock_search", !r.exec.includes("stock_search"), `exec=${r.exec.join(",")}`);
  }

  // ── #6: "onde fica a loja?" NÃO altera o filtro ativo ──
  {
    const c = conv({ ...offerCtx([GOL]), activeSearchConstraints: { marca: "volkswagen", precoMax: 50000 } } as Partial<ConversationState>); await c.seed();
    const r = await c.t("onde fica a loja?", resist);   // a LLM NÃO classifica busca numa pergunta institucional
    check("[#6a] institucional NÃO roda stock_search", !r.exec.includes("stock_search"), `exec=${r.exec.join(",")}`);
    check("[#6b] filtro ativo PRESERVADO (marca+teto intactos)", r.activeAfter?.marca === "volkswagen" && r.activeAfter?.precoMax === 50000, `active=${JSON.stringify(r.activeAfter)}`);
  }

  // ── #7: "popular até 50 mil" usa popular+teto ──
  {
    const c = conv(); await c.seed();
    const r = await c.t("popular até 50 mil");
    check("[#7] busca com popular=true + precoMax=50000", r.stockInput?.popular === true && r.stockInput?.precoMax === 50000, `input=${JSON.stringify(r.stockInput)}`);
  }

  // ── #8: "até 50 mil" sem contexto busca por teto, sem reperguntar "qual modelo/tipo?" ──
  {
    const c = conv(); await c.seed();
    const r = await c.t("até 50 mil");
    check("[#8a] busca por teto (precoMax=50000)", r.exec.includes("stock_search") && r.stockInput?.precoMax === 50000, `input=${JSON.stringify(r.stockInput)}`);
    check("[#8b] NÃO repergunta 'qual modelo/tipo procura?'", !/qual (modelo|tipo)/i.test(norm(r.outbox)), `outbox="${r.outbox}"`);
  }

  // ── #9: NUNCA promete "vou procurar" sem executar stock_search (executor determinístico age) ──
  {
    const c = conv(); await c.seed();
    const r = await c.t("Até 50 mil e que seja da volks");
    const promisedWithoutSearch = /(vou|deixa eu|já vou)\s+(procurar|buscar|verificar)/i.test(norm(r.outbox)) && !r.exec.includes("stock_search");
    check("[#9] resposta concreta: executou stock_search (sem promessa falsa)", r.exec.includes("stock_search") && !promisedWithoutSearch, `exec=${r.exec.join(",")} outbox="${r.outbox}"`);
  }

  console.log(`\n== F2.26: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
