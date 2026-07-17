// ============================================================================
// F2.28 — P0 (audit Codex): FASE 2 (ano/câmbio RÍGIDO) + FASE 4 (desinteresse) + replay do smoke offline.
//  Fase 2: "EcoSport 13/14/15 manual" nunca casa EcoSport 2020 automático (filtro duro de ano+câmbio). Se não houver
//          exato, honesto nomeando o filtro. "Prisma manual" não retorna automático.
//  Fase 4: desinteresse ("não solicitei", "obrigado, vou pensar") -> resposta curta, sem lista/funil/stock_search.
//          Um PEDIDO junto do agradecimento ("obrigado, quero o Onix") ainda busca.
//   npx tsx tests/run-f2-28-rigid-years-disengagement.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { detectCommercialConstraints, constraintsToStockInput } from "../src/engine/commercial-constraints.ts";
import { detectDisengagement } from "../src/engine/lead-intent.ts";
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
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, TurnInterpretation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-06T12:00:00.000Z", SHA = "sha-28";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

const COMPASS: VehicleFact = { vehicleKey: "revendamais:compass", marca: "Jeep", modelo: "Compass", ano: 2018, preco: 89990, km: 70000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const ECO_OLD: VehicleFact = { vehicleKey: "revendamais:ecoold", marca: "Ford", modelo: "EcoSport", ano: 2014, preco: 52990, km: 100000, cambio: "Manual", cor: "Prata", tipo: "suv" };
const ECO_NEW: VehicleFact = { vehicleKey: "revendamais:econew", marca: "Ford", modelo: "EcoSport", ano: 2020, preco: 78990, km: 40000, cambio: "Automatico", cor: "Preto", tipo: "suv" };
const PRISMA_M: VehicleFact = { vehicleKey: "revendamais:prismam", marca: "Chevrolet", modelo: "Prisma", ano: 2016, preco: 54990, km: 85000, cambio: "Manual", cor: "Branco", tipo: "sedan" };
const PRISMA_A: VehicleFact = { vehicleKey: "revendamais:prismaa", marca: "Chevrolet", modelo: "Prisma", ano: 2018, preco: 59990, km: 60000, cambio: "Automatico", cor: "Prata", tipo: "sedan" };
const ONIX: VehicleFact = { vehicleKey: "revendamais:onix", marca: "Chevrolet", modelo: "Onix", ano: 2017, preco: 49990, km: 70000, cambio: "Manual", cor: "Preto", tipo: "hatch" };
const RENEGADE: VehicleFact = { vehicleKey: "revendamais:renegade", marca: "Jeep", modelo: "Renegade", ano: 2016, preco: 74990, km: 90000, cambio: "Manual", cor: "Cinza", tipo: "suv" };
const STOCK = [COMPASS, ECO_OLD, ECO_NEW, PRISMA_M, PRISMA_A, ONIX, RENEGADE];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; cambio?: string; anos?: number[]; broad?: boolean; excludeKeys?: string[] };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m) || m.includes(norm(v.marca))); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return inp.broad ? toks.some((t) => vt.includes(t)) : toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    if (inp.cambio) items = items.filter((v) => (inp.cambio === "automatic") === /autom/i.test(v.cambio ?? ""));
    if (inp.anos && inp.anos.length > 0) { const s = new Set(inp.anos); items = items.filter((v) => v.ano != null && s.has(v.ano)); }
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
// ⭐AUTORIDADE (audit Codex): os turnos-default desta suíte são BUSCAS (anos rígidos/câmbio/tipo) — a LLM real classifica
// search_stock. Declara o ATO mas resiste a chamar a tool: o executor determinístico garante a execução. Turnos
// NÃO-comerciais (desengajamento) passam responder próprio com U("other").
const resist: BrainResponder = (f, observations) => {
  const engagement = detectDisengagement(f.block ?? "");
  const hasNewCommercialRequest = /\b(quero|procuro|busco|tem)\b/i.test(f.block ?? "");
  if ((engagement === "not_interested" || engagement === "low_intent") && !hasNewCommercialRequest) {
    return finU([txt("Tudo bem, obrigado pelo retorno. Se precisar, pode me chamar." )], "disengagement", U("disengagement"));
  }
  const understanding = {
    ...U("search_stock"), requestedCapabilities: ["stock_search"] as TurnUnderstanding["requestedCapabilities"],
    evidence: [{ capability: "stock_search" as const, quote: (f.block ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || "tem" }],
  };
  const searches = observations.filter((o) => o.tool === "stock_search" && o.ok) as { ok: true; tool: "stock_search"; data: { items: VehicleFact[] } }[];
  if (searches.length === 0) return { kind: "query", call: { tool: "stock_search", input: {} }, understanding };
  const explicit = detectCommercialConstraints({ block: f.block ?? "", signals: buildFrameSignals(f.block ?? "", { relation: "ambiguous" } as TurnInterpretation), claimExtractor: extractor });
  let items = [...new Map(searches.flatMap((s) => s.data.items).map((v) => [v.vehicleKey, v])).values()];
  if (explicit.anos?.length) items = items.filter((v) => v.ano != null && explicit.anos!.includes(v.ano));
  if (explicit.cambio) items = items.filter((v) => (explicit.cambio === "automatic") === /autom/i.test(v.cambio ?? ""));
  const requested = (f.block ?? "esses critérios").replace(/[?!.]+/g, "").replace(/^\s*(tem|quero|procuro)\s+/i, "").trim();
  return items.length > 0
    ? finU([txt("Encontrei estas opções para você:"), offer(items.map((v) => v.vehicleKey)), txt("Qual delas chamou sua atenção?")], "offer_stock", understanding)
    : finU([txt(`Não encontrei ${requested} no estoque agora. Quer ajustar algum desses critérios?`)], "empty_stock_honest", understanding);
};

type Cap = { outbox: string; committed: boolean; hasMedia: boolean; exec: string[]; stockInput: Record<string, unknown> | null; reasonCode: string | null; policyFeedback: string[] };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, relation: TurnRelation, responder: BrainResponder = resist): Promise<Cap> {
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
  const stock = executed.find((e) => e.tool === "stock_search");
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed", hasMedia: outbox.some((o) => o.kind === "send_media"),
    exec: executed.map((e) => e.tool), stockInput: stock ? (stock.input as Record<string, unknown>) : null, reasonCode: r.status === "committed" ? r.decision.reasonCode : null,
    policyFeedback: r.status === "committed" ? [...r.policyFeedback] : [],
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `conv-${seq0++}`; let s = 0;
  const t = (lead: string, relation: TurnRelation = "ambiguous"): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, relation);
  const t2 = (lead: string, responder: BrainResponder, relation: TurnRelation = "ambiguous"): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, relation, responder);
  return { t, t2 };
}

async function main(): Promise<void> {
  console.log("== F2.28: ano/câmbio rígido + desinteresse ==");

  // ── PARTE 1 — PURO: anos ──
  check("[Y-1] 'EcoSport 13/14/15 manual' -> anos [2013,2014,2015] + cambio manual + modelo", (() => { const c = detectCommercialConstraints({ block: "EcoSport 13/14/15 manual", signals: buildFrameSignals("EcoSport 13/14/15 manual", { relation: "ambiguous" } as TurnInterpretation), claimExtractor: extractor }); return JSON.stringify(c.anos) === JSON.stringify([2013, 2014, 2015]) && c.cambio === "manual" && (c.modelos ?? []).some((m) => has(m, "ecosport")); })());
  check("[Y-2] '2013 a 2015' -> range [2013,2014,2015]", (() => { const c = detectCommercialConstraints({ block: "quero de 2013 a 2015", signals: buildFrameSignals("quero de 2013 a 2015", { relation: "ambiguous" } as TurnInterpretation), claimExtractor: extractor }); return JSON.stringify(c.anos) === JSON.stringify([2013, 2014, 2015]); })());
  check("[Y-3] 'até 100 mil' NÃO vira ano", (() => { const c = detectCommercialConstraints({ block: "compass até 100 mil", signals: buildFrameSignals("compass até 100 mil", { relation: "ambiguous" } as TurnInterpretation), claimExtractor: extractor }); return c.anos === undefined && c.precoMax === 100000; })());
  check("[Y-4] constraintsToStockInput passa anos", JSON.stringify((constraintsToStockInput({ modelos: ["ecosport"], anos: [2013, 2014, 2015], cambio: "manual" }) as { anos?: number[] }).anos) === JSON.stringify([2013, 2014, 2015]));

  // ── PARTE 2 — PURO: desengajamento ──
  check("[G-1] 'não solicitei nada' -> not_interested", detectDisengagement("não solicitei nada") === "not_interested");
  check("[G-2] 'não me interessa' -> not_interested", detectDisengagement("não me interessa, valeu") === "not_interested");
  check("[G-3] 'obrigado, vou pensar' -> low_intent", detectDisengagement("obrigado, vou pensar") === "low_intent");
  check("[G-3b] 'não gostei de nenhum' encerra mesmo sem agradecimento", detectDisengagement("não gostei de nenhum") === "not_interested");
  check("[G-4] 'quero um onix' -> null (não é desinteresse)", detectDisengagement("quero um onix") === null);
  check("[G-4b] 'não' isolado é resposta contextual, nunca encerramento", detectDisengagement("não") === null);

  // ── PARTE 3 — INTEGRAÇÃO Fase 2 (rígido) ──
  {
    const c = conv();
    const r = await c.t("Tem EcoSport 13/14/15 manual?");
    check("[E-1a] busca com anos [2013,2014,2015] + cambio manual", JSON.stringify(r.stockInput?.anos) === JSON.stringify([2013, 2014, 2015]) && r.stockInput?.cambio === "manual", `input=${JSON.stringify(r.stockInput)}`);
    check("[E-1b] lista EcoSport 2014 manual e NÃO o 2020 automático", has(r.outbox, "EcoSport") && has(r.outbox, "2014") && !has(r.outbox, "2020"), `outbox="${r.outbox}"`);
  }
  {
    // Sem match exato: "EcoSport 2019 manual" (não existe) -> honesto NOMEANDO o filtro, sem oferecer o 2020 auto como match.
    const c = conv();
    const r = await c.t("Tem EcoSport 2019 manual?");
    check("[E-2a] sem match -> ZERO 2020 automático na resposta", !has(r.outbox, "2020"), `outbox="${r.outbox}"`);
    check("[E-2b] LLM responde honestamente nomeando EcoSport 2019 manual", r.reasonCode === "empty_stock_honest" && has(r.outbox, "EcoSport") && has(r.outbox, "manual"), `rc=${r.reasonCode} outbox="${r.outbox}" feedback=${JSON.stringify(r.policyFeedback)}`);
  }
  {
    const c = conv();
    const r = await c.t("Tem Prisma manual?");
    check("[P-1] 'Prisma manual' -> lista Prisma manual, NÃO o automático", r.stockInput?.cambio === "manual" && has(r.outbox, "Prisma") && has(r.outbox, "2016") && !has(r.outbox, "2018"), `input=${JSON.stringify(r.stockInput)} outbox="${r.outbox}"`);
  }

  // ── PARTE 4 — INTEGRAÇÃO Fase 4 (desinteresse) ──
  // Engine SUPRIME busca/lista num turno de desinteresse; o cérebro (prompt-first) responde curto. O executor
  // determinístico de desinteresse é FALLBACK (quando o cérebro não autora). Aqui o cérebro 'resist' autora curto.
  {
    const c = conv();
    const r = await c.t("não solicitei nada");
    check("[D-1a] desinteresse -> NÃO roda stock_search", !r.exec.includes("stock_search"), `exec=${r.exec.join(",")}`);
    check("[D-1b] resposta SEM lista/oferta (não empurra venda)", r.committed && !r.hasMedia && !has(r.outbox, "opções") && !has(r.outbox, "encontrei"), `outbox="${r.outbox}"`);
  }
  {
    // Draft inicial inválido recebe feedback; a própria LLM reescreve o encerramento curto.
    const c = conv();
    const r = await c.t2("não solicitei nada", (_f, observations) => observations.some((o) => o.tool === "response" && !o.ok)
      ? finU([txt("Sem problema. Se precisar depois, fico à disposição.")], "ack_disengagement", U("other"))
      : finU([], "reply", U("other")));
    check("[D-1c] feedback faz a LLM redigir a despedida curta", r.reasonCode === "ack_disengagement" && has(r.outbox, "Sem problema") && !r.exec.includes("stock_search"), `rc=${r.reasonCode} outbox="${r.outbox}"`);
  }
  {
    const c = conv();
    const r = await c.t("Obrigado, vou pensar");
    check("[D-2] 'obrigado, vou pensar' -> sem lista/oferta", r.committed && !has(r.outbox, "opções") && !has(r.outbox, "encontrei") && !r.exec.includes("stock_search"), `outbox="${r.outbox}"`);
  }
  {
    // PEDIDO junto do agradecimento -> o pedido vence (busca Onix).
    const c = conv();
    const r = await c.t("obrigado, quero o Onix");
    check("[D-3] 'obrigado, quero o Onix' -> BUSCA (pedido vence o desinteresse)", r.exec.includes("stock_search") && has(String(r.stockInput?.modelo ?? ""), "onix"), `exec=${r.exec.join(",")} input=${JSON.stringify(r.stockInput)}`);
  }

  // ── PARTE 5 — REPLAY do smoke (turnos-chave 4→9, uma conversa; estado persiste) ──
  {
    const c = conv();
    await c.t("Quero um sedan até 100 mil");                              // T3: sedan até 100k
    const t4 = await c.t("Tem algum Compass?");                            // T4: Compass (solta sedan)
    check("[S-4] Compass sem tipo sedan, sem 'Compass SEDAN'", has(String(t4.stockInput?.modelo ?? ""), "compass") && t4.stockInput?.tipo === undefined && !has(t4.outbox, "sedan"), `input=${JSON.stringify(t4.stockInput)} outbox="${t4.outbox}"`);
    await c.t("Mas Compass não é sedan, esquece sedan");                  // T5: correção
    const t6 = await c.t("Eu quero um Compass mesmo");                     // T6: Compass
    check("[S-6] segue Compass sem sedan", has(String(t6.stockInput?.modelo ?? ""), "compass") && t6.stockInput?.tipo === undefined);
    const t7 = await c.t("Tem EcoSport 13/14/15 manual?");                 // T7: EcoSport rígido
    check("[S-7] EcoSport rígido: anos+cambio, sem 2020 automático", JSON.stringify(t7.stockInput?.anos) === JSON.stringify([2013, 2014, 2015]) && t7.stockInput?.cambio === "manual" && !has(t7.outbox, "2020"), `input=${JSON.stringify(t7.stockInput)} outbox="${t7.outbox}"`);
    const t8 = await c.t("Se não tiver, pode ser SUV manual até 80 mil");  // T8: SUV manual ≤80k
    check("[S-8] SUV manual até 80k busca por tipo (limpa modelo EcoSport)", t8.stockInput?.tipo === "suv" && t8.stockInput?.cambio === "manual" && t8.stockInput?.precoMax === 80000, `input=${JSON.stringify(t8.stockInput)}`);
    const t9 = await c.t("Obrigado, vou pensar");                         // T9: desinteresse
    check("[S-9] desinteresse final: sem lista, sem stock_search", !t9.exec.includes("stock_search") && !has(t9.outbox, "opções") && !has(t9.outbox, "encontrei"), `rc=${t9.reasonCode} exec=${t9.exec.join(",")} outbox="${t9.outbox}"`);
  }

  console.log(`\n== F2.28: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
