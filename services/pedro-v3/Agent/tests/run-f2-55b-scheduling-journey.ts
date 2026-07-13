// ============================================================================
// F2.55 PARTE 2 — JORNADA INTEGRADA pelo ENGINE REAL (cérebro scriptado SEMANTICAMENTE VÁLIDO). Protege a arquitetura
// RD1-2 + P0-A/P0-B: abertura (portal) -> busca SUV -> seleção Compass -> fotos -> TROCA Hilux 2009/78km -> financeiro
// (entrada zero + parcela 1500, SEM virar busca) -> VISITA (segunda + 15h compostos, SEM technical_fallback) -> handoff.
// Invariantes (Codex P0-D): bloco atual vence memória; Hilux=troca (nunca compra), 78km->78.000; entrada zero/parcela
// não viram busca; visita não perde o Compass selecionado; segunda+15h compõem o agendamento; pedido humano gera handoff/
// notify; ZERO technical_fallback; ZERO recovery comercial; respostas comerciais só brain_final|brain_retry.
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer, TurnContextPreparation } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent, AgentToolObservation } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";

let ok = 0; let bad = 0;
function check(name: string, pass: boolean, extra?: string): void { if (pass) { ok++; console.log(`  OK  ${name}`); } else { bad++; console.error(`  RED ${name}${extra ? ` — ${extra}` : ""}`); } }
const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const has = (hay: string, needle: string): boolean => norm(hay).includes(norm(needle));

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-13T09:00:00.000Z";
const SHA = "sha-f255b";

const COMPASS: VehicleFact = { vehicleKey: "rm:compass", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 99000, km: 58000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const CRETA: VehicleFact = { vehicleKey: "rm:creta", marca: "Hyundai", modelo: "Creta", ano: 2021, preco: 88000, km: 40000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const TRACKER: VehicleFact = { vehicleKey: "rm:tracker", marca: "Chevrolet", modelo: "Tracker", ano: 2022, preco: 105000, km: 30000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2020, preco: 72000, km: 45000, cambio: "Automatico", cor: "Preto", tipo: "hatch" };
const STOCK = [COMPASS, CRETA, TRACKER, ONIX];   // catálogo do tenant = SÓ carros à venda (Hilux é troca, NÃO está aqui). Onix (hatch) prova mudança de assunto durante agendamento sem cair em busca vazia.
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; anos?: number[]; excludeKeys?: string[]; broad?: boolean };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m) || m.includes(norm(v.marca))); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return inp.broad ? toks.some((t) => vt.includes(t)) : toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    if (Array.isArray(inp.anos) && inp.anos.length > 0) items = items.filter((v) => inp.anos!.includes(v.ano));
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};

class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<TurnContextPreparation> { return { interpretation: { relation: this.relation } as never, tenantCatalog: catalog, claimExtractor: extractor }; } }

// ── construtores de step (cérebro scriptado, evidence do bloco atual) ──
const U = (primaryIntent: PrimaryIntent, evidence: TurnUnderstanding["evidence"] = []): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence, isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const handoffAct = { kind: "handoff", planId: "handoff-req", order: 1, dependsOn: [], onSuccess: [], leadId: "", reason: "explicit_human_request", briefing: "" } as unknown as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding, effects: ProposedEffectPlan[] = [reply]): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }
const ev = (capability: string | undefined, quote: string): TurnUnderstanding["evidence"][number] => ({ capability: capability as never, quote });

// busca: query até ter observação, depois lista (evidence do bloco atual)
const searchB = (input: Record<string, unknown>): BrainResponder => (f, obs) => {
  const q = (f.block ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || "tem";
  const u: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "vehicle_type", subjectValue: "suv", subjectSource: "current_turn", evidence: [ev("stock_search", q)], isTopicChange: false, answeredLeadQuestions: [] };
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (!so) return qU({ tool: "stock_search", input }, u);
  return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart, txt("Quer ver as fotos de algum deles?")], "reply", u);
};
// foto do carro selecionado (aceita a oferta de foto do agente / pede fotos)
const sendPhotos: BrainResponder = (_f, obs) => {
  const pu: TurnUnderstanding = { primaryIntent: "request_photos", requestedCapabilities: ["send_photos"], subject: "selected_vehicle", subjectValue: null, subjectSource: "memory", evidence: [ev("send_photos", "fotos")], isTopicChange: false, answeredLeadQuestions: [] };
  const ph = obs.find((o) => o.tool === "vehicle_photos_resolve" && o.ok) as Extract<AgentToolObservation, { tool: "vehicle_photos_resolve"; ok: true }> | undefined;
  if (!ph) return qU({ tool: "vehicle_photos_resolve", input: { vehicleRef: { key: "rm:compass" } } }, pu);
  const media = { kind: "send_media", planId: "media", order: 1, dependsOn: [], onSuccess: [], vehicleKey: "rm:compass", photoIds: ph.data.photoIds } as unknown as ProposedEffectPlan;
  return finU([txt("Aqui estão as fotos do Jeep Compass 2019.")], "reply", pu, [reply, media]);
};

let seq0 = 0;
type Cap = { outbox: string; committed: boolean; stockObs: number; detailObs: number; terminalSafe: boolean; primaryIntent: string | null; src: string | null; slots: ConversationState["slots"] | null; selected: string | null; hasMedia: boolean; hasHandoff: boolean; hasNotify: boolean; pendingSlot: string | null };
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:f55b_${seq0++}`; let s = 0;
  const t = async (leadMsgs: string | string[], responder: BrainResponder, rel: TurnRelation = "ambiguous"): Promise<Cap> => {
    preparer.relation = rel; brain.setResponder(responder);
    const bursts = Array.isArray(leadMsgs) ? leadMsgs : [leadMsgs];
    for (const m of bursts) { await persistence.tryInsert({ eventId: `${id}-e${++s}-${Math.random().toString(36).slice(2, 6)}`, conversationId: id, raw: redact({ text: m }), receivedAt: clock.now() }); clock.advance(300); }
    clock.advance(700);
    const turnId = `${id}-t${s}`;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
      conversationId: id, tenantId: TENANT, agentId: AGENT, leadId: LEAD, crmWriteEnabled: true,
      handoff: { enabled: true, available: true, agentName: "Aloan", leadPhone: "5512999999999", leadDisplayName: "Douglas", nowLocal: "13/07/2026 09:15" } as never,
      workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
      limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 3, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    });
    while (true) {   // dreno de outbox: marca receipts accepted (não despacha nada externo)
      const claimed = await persistence.claimOutbox(id, "w", 60_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock, conversationId: id, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: id, effectId: rec.effectId, result });
      }
    }
    const outbox = (await persistence.listOutbox(id)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
    const after = persistence.load(id)?.state ?? null;
    const wmAfter = (after?.workingMemory ?? null) as { pendingAgentQuestion?: { slot?: string } } | null;
    return {
      outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
      stockObs: r.status === "committed" ? r.toolObservations.filter((o) => o.tool === "stock_search").length : 0,
      detailObs: r.status === "committed" ? r.toolObservations.filter((o) => o.tool === "vehicle_details").length : 0,
      terminalSafe: r.status === "committed" ? r.terminalSafe : false,
      primaryIntent: r.status === "committed" ? r.understanding.primaryIntent : null,
      src: r.status === "committed" ? (r.responseSource ?? null) : null,
      slots: after?.slots ?? null, selected: after?.vehicleContext.selected?.key ?? null,
      hasMedia: outbox.some((o) => o.kind === "send_media"), hasHandoff: outbox.some((o) => o.kind === "handoff"), hasNotify: outbox.some((o) => o.kind === "notify_seller"),
      pendingSlot: (after?.workingMemory as never as { pendingAgentQuestion?: { slot?: string } })?.pendingAgentQuestion?.slot ?? wmAfter?.pendingAgentQuestion?.slot ?? null,
    };
  };
  return { t };
}
const isBrain = (s: string | null): boolean => s === "brain_final" || s === "brain_retry";
const slotVal = (c: Cap, k: keyof ConversationState["slots"]): unknown => (c.slots?.[k] as { value?: unknown } | undefined)?.value;
// detecção da PERGUNTA no texto VISÍVEL do agente (a jornada usa cérebro scriptado, mas provamos que o texto não repergunta dimensão já conhecida)
const asksDay = (s: string): boolean => /qual\s+(o\s+)?(melhor\s+)?dia|que\s+dia|em\s+que\s+dia/.test(norm(s));
const asksTime = (s: string): boolean => /qual\s+(o\s+)?(melhor\s+)?hor|que\s+hor|que\s+horas|qual\s+horario/.test(norm(s));

async function main(): Promise<void> {
  console.log("== F2.55 PARTE 2 — jornada integrada (engine real, cérebro scriptado válido) ==");
  const c = conv();

  // T1 abertura — portal-first (LLM se apresenta + faz UMA pergunta de qualificação; sem nome/telefone prematuros)
  const t1 = await c.t("Boa tarde", () => finU([txt("Boa tarde! Sou o Aloan da Icom. Você procura um modelo, um tipo de carro ou uma faixa de preço?")], "reply", U("smalltalk", [ev(undefined, "boa tarde")])));
  check("[T1] abertura entregue por brain (não terminalSafe)", isBrain(t1.src) && !t1.terminalSafe, `src=${t1.src}`);
  check("[T1b] abertura não pede nome/telefone prematuros", !has(t1.outbox, "seu nome") && !has(t1.outbox, "telefone"), t1.outbox);

  // T2 busca SUV -> lista Compass/Creta/Tracker
  const t2 = await c.t("Quero um SUV até 100 mil", searchB({ tipo: "suv", precoMax: 100000 }));
  check("[T2] busca SUV entregue (brain), com stock_search", isBrain(t2.src) && t2.stockObs >= 1 && has(t2.outbox, "compass"), `src=${t2.src} obs=${t2.stockObs}`);

  // T3 seleção Compass -> selected=rm:compass
  const t3 = await c.t("gostei do Compass 2019", () => finU([txt("Ótima escolha! O Jeep Compass 2019. Quer que eu te mande as fotos dele?")], "reply", { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "explicit_model", subjectValue: "Compass", subjectSource: "current_turn", evidence: [ev("select", "gostei")], isTopicChange: false, answeredLeadQuestions: [] }));
  check("[T3] Compass selecionado (brain, sem tool comercial)", isBrain(t3.src) && t3.selected === "rm:compass" && t3.stockObs === 0, `sel=${t3.selected} src=${t3.src}`);

  // T4 fotos do Compass
  const t4 = await c.t("me manda as fotos dele", sendPhotos);
  check("[T4] fotos enviadas (send_media) do Compass", t4.hasMedia && isBrain(t4.src), `media=${t4.hasMedia} src=${t4.src}`);
  check("[T4b] Compass CONTINUA selecionado", t4.selected === "rm:compass", `sel=${t4.selected}`);

  // T5 agente pergunta troca
  await c.t("quais as condições de pagamento?", () => finU([txt("Perfeito! Para eu te passar as condições do Compass, você tem algum carro para dar de troca?")], "reply", U("financing", [ev(undefined, "condicoes")])));

  // T6 TROCA fragmentada (rajada): Hilux 2009 78km -> trade_in, ZERO stock, Hilux NÃO é compra
  const t6 = await c.t(["Tenho", "Uma Hilux 2009", "78km rodados"], () => finU([txt("Anotei sua Toyota Hilux 2009 com 78 mil km para avaliação na troca. Você pretende dar algum valor de entrada?")], "reply", U("trade_in", [ev(undefined, "hilux")])));
  check("[T6] troca: primaryIntent=trade_in EXATO, ZERO stock/detalhe, brain", t6.primaryIntent === "trade_in" && t6.stockObs === 0 && t6.detailObs === 0 && isBrain(t6.src) && !t6.terminalSafe, `pi=${t6.primaryIntent} obs=${t6.stockObs} src=${t6.src}`);
  check("[T6b] Hilux virou TROCA (veiculoTroca), NÃO interesse de compra", JSON.stringify(slotVal(t6, "veiculoTroca") ?? {}).toLowerCase().includes("hilux"), JSON.stringify(slotVal(t6, "veiculoTroca")));
  check("[T6c] 78km normalizado para 78.000", JSON.stringify(slotVal(t6, "veiculoTroca") ?? {}).includes("78000"), JSON.stringify(slotVal(t6, "veiculoTroca")));
  check("[T6d] Compass CONTINUA selecionado durante a troca", t6.selected === "rm:compass", `sel=${t6.selected}`);

  // T7 entrada zero -> financing, NÃO vira busca (P0-B)
  const t7 = await c.t("não tenho entrada", () => finU([txt("Sem problema! Dá pra fazer com entrada zero. Qual parcela mensal caberia no seu orçamento?")], "reply", U("financing", [ev(undefined, "entrada")])), "answers_pending");
  check("[T7] entrada zero: financing, ZERO stock (não virou busca)", t7.stockObs === 0 && isBrain(t7.src) && !t7.terminalSafe, `obs=${t7.stockObs} src=${t7.src}`);
  check("[T7b] entrada=0 registrada", slotVal(t7, "entrada") === 0, JSON.stringify(slotVal(t7, "entrada")));

  // T8 parcela 1500 -> financing, NÃO vira busca (P0-B)
  const t8 = await c.t("até 1500", () => finU([txt("Anotado, parcela de até R$ 1.500. Quer já agendar uma visita para ver o Compass de perto?")], "reply", U("financing", [ev(undefined, "1500")])), "answers_pending");
  check("[T8] parcela 1500: financing, ZERO stock (não virou busca)", t8.stockObs === 0 && isBrain(t8.src) && !t8.terminalSafe, `obs=${t8.stockObs} src=${t8.src}`);
  check("[T8b] parcelaDesejada=1500", slotVal(t8, "parcelaDesejada") === 1500, JSON.stringify(slotVal(t8, "parcelaDesejada")));

  // T9 pedido de visita -> interesseVisita=true, agente pergunta o DIA
  const t9 = await c.t("Quero agendar uma visita", () => finU([txt("Perfeito! Podemos agendar sua visita ao Compass. Qual o melhor dia pra você?")], "reply", U("visit", [ev(undefined, "agendar uma visita")])));
  check("[T9] visita: primaryIntent=visit EXATO, brain, sem tool comercial", t9.primaryIntent === "visit" && t9.stockObs === 0 && t9.detailObs === 0 && isBrain(t9.src), `pi=${t9.primaryIntent} src=${t9.src}`);
  check("[T9b] interesseVisita=true", slotVal(t9, "interesseVisita") === true, JSON.stringify(slotVal(t9, "interesseVisita")));

  // ⭐T10 "Pra segunda" (dia isolado) -> P0-A: NÃO cai em technical_fallback; visit aceito; agente pergunta o HORÁRIO
  const t10 = await c.t("Pra segunda", () => finU([txt("Fechado, segunda-feira! Qual horário fica melhor pra você?")], "reply", U("visit", [ev(undefined, "segunda")])), "answers_pending");
  check("[T10] ⭐'Pra segunda' NÃO é technical_fallback (P0-A)", isBrain(t10.src) && !t10.terminalSafe, `src=${t10.src} terminalSafe=${t10.terminalSafe}`);
  check("[T10a] visit EXATO", t10.primaryIntent === "visit", `pi=${t10.primaryIntent}`);
  check("[T10b] visita mantida (sem tool comercial); Compass segue selecionado", t10.stockObs === 0 && t10.detailObs === 0 && t10.selected === "rm:compass", `obs=${t10.stockObs} sel=${t10.selected}`);
  check("[T10c] diaHorario registrou o DIA (segunda)", has(String(slotVal(t10, "diaHorario") ?? ""), "segunda"), JSON.stringify(slotVal(t10, "diaHorario")));
  check("[T10d] ⭐texto VISÍVEL NÃO repergunta o DIA (dia já dado); pode pedir só o horário", !asksDay(t10.outbox), t10.outbox);

  // ⭐T11 "Às 15h" (horário isolado) -> P0-A composição: segunda + 15h; horário não apaga o dia
  const t11 = await c.t("Às 15h", () => finU([txt("Perfeito! Sua visita ao Compass ficou para segunda-feira às 15h. Vou confirmar com o consultor.")], "reply", U("visit", [ev(undefined, "15h")])), "answers_pending");
  check("[T11] ⭐'Às 15h' NÃO é technical_fallback (P0-A)", isBrain(t11.src) && !t11.terminalSafe, `src=${t11.src}`);
  check("[T11a] visit EXATO", t11.primaryIntent === "visit", `pi=${t11.primaryIntent}`);
  check("[T11b] ⭐diaHorario COMPÔS dia+horário (segunda 15h)", has(String(slotVal(t11, "diaHorario") ?? ""), "segunda") && has(String(slotVal(t11, "diaHorario") ?? ""), "15"), JSON.stringify(slotVal(t11, "diaHorario")));
  check("[T11c] ⭐texto VISÍVEL com dia+horário conhecidos NÃO repergunta NENHUMA das duas dimensões", !asksDay(t11.outbox) && !asksTime(t11.outbox), t11.outbox);

  // T12 pedido humano -> handoff + notify_seller
  const t12 = await c.t("quero falar com um vendedor", () => finU([txt("Perfeito! Vou te transferir agora para um consultor finalizar com você.")], "handoff", { primaryIntent: "request_human", requestedCapabilities: ["handoff"], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [ev("handoff", "quero falar com um vendedor")], isTopicChange: false, answeredLeadQuestions: [] }, [reply, handoffAct]));
  check("[T12] pedido humano: request_human EXATO + handoff + notify_seller no outbox", t12.primaryIntent === "request_human" && t12.hasHandoff && t12.hasNotify, `pi=${t12.primaryIntent} handoff=${t12.hasHandoff} notify=${t12.hasNotify}`);
  check("[T12b] handoff sem tool comercial + brain", t12.stockObs === 0 && t12.detailObs === 0 && isBrain(t12.src), `src=${t12.src}`);

  // ══════════════════════════════════════════════════════════════════════════
  // CENÁRIO B — CORREÇÃO de dimensão: agendou "segunda 15h", depois "Na verdade terça"
  // → substitui SÓ o dia (terça), PRESERVA o horário (15h). Nunca vira technical_fallback.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n-- Cenário B: correção de dia (preserva horário) --");
  const cb = conv();
  await cb.t("Boa tarde", () => finU([txt("Boa tarde! Sou o Aloan da Icom. Que tipo de carro você procura?")], "reply", U("smalltalk", [ev(undefined, "boa tarde")])));
  await cb.t("gostei do Compass", () => finU([txt("Ótima escolha, o Jeep Compass 2019! Quer agendar uma visita pra conhecer?")], "reply", { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "explicit_model", subjectValue: "Compass", subjectSource: "current_turn", evidence: [ev("select", "gostei")], isTopicChange: false, answeredLeadQuestions: [] }));
  await cb.t("Quero agendar uma visita", () => finU([txt("Perfeito! Qual o melhor dia pra você?")], "reply", U("visit", [ev(undefined, "agendar uma visita")])));
  const cbA = await cb.t("Pode ser segunda às 15h", () => finU([txt("Fechado! Sua visita ao Compass ficou para segunda-feira às 15h.")], "reply", U("visit", [ev(undefined, "segunda as 15h")])), "answers_pending");
  check("[B1] agendamento inicial compôs segunda 15h", has(String(slotVal(cbA, "diaHorario") ?? ""), "segunda") && has(String(slotVal(cbA, "diaHorario") ?? ""), "15"), JSON.stringify(slotVal(cbA, "diaHorario")));
  const cbB = await cb.t("Na verdade terça", () => finU([txt("Sem problema! Troquei para terça-feira às 15h então.")], "reply", U("visit", [ev(undefined, "terca")])), "answers_pending");
  check("[B2] correção: visit EXATO, brain, NÃO technical_fallback", cbB.primaryIntent === "visit" && isBrain(cbB.src) && !cbB.terminalSafe, `pi=${cbB.primaryIntent} src=${cbB.src}`);
  check("[B3] ⭐correção substituiu SÓ o dia (terça) e PRESERVOU o horário (15h)", has(String(slotVal(cbB, "diaHorario") ?? ""), "terca") && has(String(slotVal(cbB, "diaHorario") ?? ""), "15") && !has(String(slotVal(cbB, "diaHorario") ?? ""), "segunda"), JSON.stringify(slotVal(cbB, "diaHorario")));
  check("[B4] correção NÃO virou busca/detalhe", cbB.stockObs === 0 && cbB.detailObs === 0, `stock=${cbB.stockObs} det=${cbB.detailObs}`);

  // ══════════════════════════════════════════════════════════════════════════
  // CENÁRIO C — MUDANÇA DE ASSUNTO durante agendamento: "Na verdade quero um Onix"
  // → sai da visita, vira busca (search_stock EXATO), stock_search executa. Bloco atual vence a memória de visita.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n-- Cenário C: mudança de assunto durante agendamento --");
  const cc = conv();
  await cc.t("Boa tarde", () => finU([txt("Boa tarde! Sou o Aloan da Icom. Que tipo de carro você procura?")], "reply", U("smalltalk", [ev(undefined, "boa tarde")])));
  await cc.t("gostei do Compass", () => finU([txt("Ótima escolha, o Jeep Compass 2019! Quer agendar uma visita?")], "reply", { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "explicit_model", subjectValue: "Compass", subjectSource: "current_turn", evidence: [ev("select", "gostei")], isTopicChange: false, answeredLeadQuestions: [] }));
  await cc.t("Quero agendar uma visita", () => finU([txt("Perfeito! Qual o melhor dia pra você?")], "reply", U("visit", [ev(undefined, "agendar uma visita")])));
  await cc.t("Pra segunda", () => finU([txt("Fechado, segunda! Qual horário fica melhor?")], "reply", U("visit", [ev(undefined, "segunda")])), "answers_pending");
  const ccChg = await cc.t("Na verdade quero um Onix", searchB({ modelo: "Onix" }), "direction_change");
  check("[C1] ⭐mudança de assunto venceu a visita: search_stock EXATO", ccChg.primaryIntent === "search_stock", `pi=${ccChg.primaryIntent}`);
  check("[C2] stock_search executou e ofertou o Onix", ccChg.stockObs >= 1 && has(ccChg.outbox, "onix") && isBrain(ccChg.src), `obs=${ccChg.stockObs} src=${ccChg.src} out=${ccChg.outbox}`);
  check("[C3] mudança de assunto NÃO é technical_fallback", !ccChg.terminalSafe, `terminalSafe=${ccChg.terminalSafe}`);

  // ══════════════════════════════════════════════════════════════════════════
  // CENÁRIO D — PEDIDO HUMANO no MEIO do agendamento (antes de completar dia+horário)
  // → request_human EXATO vence o funil de agendamento, gera handoff + notify_seller.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n-- Cenário D: pedido humano no meio do agendamento --");
  const cd = conv();
  await cd.t("Boa tarde", () => finU([txt("Boa tarde! Sou o Aloan da Icom. Que tipo de carro você procura?")], "reply", U("smalltalk", [ev(undefined, "boa tarde")])));
  await cd.t("gostei do Compass", () => finU([txt("Ótima escolha, o Jeep Compass 2019! Quer agendar uma visita?")], "reply", { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "explicit_model", subjectValue: "Compass", subjectSource: "current_turn", evidence: [ev("select", "gostei")], isTopicChange: false, answeredLeadQuestions: [] }));
  await cd.t("Quero agendar uma visita", () => finU([txt("Perfeito! Qual o melhor dia pra você?")], "reply", U("visit", [ev(undefined, "agendar uma visita")])));
  await cd.t("Pra segunda", () => finU([txt("Fechado, segunda! Qual horário fica melhor?")], "reply", U("visit", [ev(undefined, "segunda")])), "answers_pending");
  const cdH = await cd.t("quero falar com um vendedor agora", () => finU([txt("Claro! Vou te transferir agora para um consultor.")], "handoff", { primaryIntent: "request_human", requestedCapabilities: ["handoff"], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [ev("handoff", "quero falar com um vendedor")], isTopicChange: false, answeredLeadQuestions: [] }, [reply, handoffAct]), "direction_change");
  check("[D1] ⭐pedido humano no meio do agendamento: request_human EXATO + handoff + notify", cdH.primaryIntent === "request_human" && cdH.hasHandoff && cdH.hasNotify, `pi=${cdH.primaryIntent} handoff=${cdH.hasHandoff} notify=${cdH.hasNotify}`);
  check("[D2] handoff sem tool comercial + brain, NÃO technical_fallback", cdH.stockObs === 0 && cdH.detailObs === 0 && isBrain(cdH.src) && !cdH.terminalSafe, `src=${cdH.src}`);

  // ══════════════════════════════════════════════════════════════════════════
  // CENÁRIO E — BACKSTOP DETERMINÍSTICO do handoff (reproduz o T10 flaky do smoke real): o cérebro emite request_human com
  // entendimento FRACO (evidence "vendedor" NÃO casa HUMAN_ACT_RX -> untrusted) e, na 1ª tentativa, PEDE O NOME sem propor
  // handoff (nem promete no texto). Nem requestsHuman nem promisesHumanHandoff disparam — mas a fala LITERAL do lead pede
  // humano. O engine DEVE negar (feedback+retry) e a LLM RE-AUTORA incluindo o handoff. NUNCA vira coleta de dado.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n-- Cenário E: backstop determinístico do handoff (understanding fraco) --");
  const ce = conv();
  await ce.t("Boa tarde", () => finU([txt("Boa tarde! Sou o Aloan da Icom. Que tipo de carro você procura?")], "reply", U("smalltalk", [ev(undefined, "boa tarde")])));
  let humanAttempt = 0;
  const humanFlaky: BrainResponder = () => {
    humanAttempt += 1;
    // primaryIntent=request_human mas evidence "vendedor" (sem "quero/preciso/gostaria" na própria evidence) -> UNTRUSTED.
    const uh: TurnUnderstanding = { primaryIntent: "request_human", requestedCapabilities: ["handoff"], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [ev("handoff", "vendedor")], isTopicChange: false, answeredLeadQuestions: [] };
    if (humanAttempt === 1) return finU([txt("Claro! Qual é o seu primeiro nome para eu registrar o atendimento?")], "ask_name", uh, [reply]);   // ⛔ pede nome, SEM handoff
    return finU([txt("Perfeito! Vou te transferir para um consultor agora.")], "handoff", uh, [reply, handoffAct]);                                    // ✅ reescreve com handoff
  };
  const ceH = await ce.t("quero falar com um vendedor", humanFlaky);
  check("[E1] ⭐backstop forçou o RETRY (cérebro chamado >1x)", humanAttempt >= 2, `attempts=${humanAttempt}`);
  check("[E2] ⭐final tem handoff + notify_seller (pedido humano NUNCA vira coleta de dado)", ceH.hasHandoff && ceH.hasNotify, `handoff=${ceH.hasHandoff} notify=${ceH.hasNotify}`);
  check("[E3] resposta VISÍVEL final NÃO pede o nome (não coleta dado)", !/qual.*(seu|o)\s+(primeiro\s+)?nome|seu nome/.test(norm(ceH.outbox)), ceH.outbox);
  check("[E4] brain + sem tool comercial + não technical_fallback", isBrain(ceH.src) && ceH.stockObs === 0 && ceH.detailObs === 0 && !ceH.terminalSafe, `src=${ceH.src}`);

  // Invariante global: NENHUM turno terminou em technical_fallback
  console.log(`\n== F2.55 PARTE 2: ${ok} OK | ${bad} FALHA ==`);
  if (bad) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
