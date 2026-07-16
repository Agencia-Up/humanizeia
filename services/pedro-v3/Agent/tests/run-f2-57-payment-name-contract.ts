// ============================================================================
// F2.57 — CONTRATO DE PAGAMENTO + REFERÊNCIA + PEDIDO HUMANO pelo ENGINE REAL (central_active, singleAuthor+llmFirst),
// com cérebro scriptado que DECLARA understanding em TODO passo (NÃO usa o wrapper que "lava" o fallback regex).
// Prova, no ciclo completo LLM -> validação -> feedback -> reautoria (não só proposeNextStep):
//   [PAY]  incidente real "Não, carta consórcio contemplada de 53 mil" respondendo TROCA: a 1ª autoria PEDE O NOME ->
//          o engine NEGA (paymentConductTurn) -> a MESMA LLM reautora SEM pedir nome; final acolhe pagamento, ZERO
//          stock_search, understanding presente, texto não pede nome/CPF.
//   [AZUL] "Mostra o azul" após uma lista: a LLM resolve offer_reference e ENVIA send_media do carro azul aterrado,
//          ZERO stock_search no turno.
//   [SPON] "tenho carta contemplada de 53 mil" espontâneo (sem alvo de compra): a LLM entende financiamento,
//          mas tenta stock_search de forma contraditória -> bloqueio pela própria intenção declarada
//          (defesa em profundidade), reautora conduzindo o pagamento.
//   [HUM]  "quero falar com um vendedor" com understanding FRACO do cérebro: tool comercial NÃO roda (backstop R7).
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
const asksName = (s: string): boolean => /\b(?:seu|o seu)\s+nome\b|qual\s+(?:o\s+)?(?:seu\s+)?nome|como\s+(?:voce\s+se\s+chama|posso\s+te\s+chamar)|me\s+(?:diz|fala|informa)\s+seu\s+nome/.test(norm(s));

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-15T09:00:00.000Z";
const SHA = "sha-f257";

const COMPASS: VehicleFact = { vehicleKey: "rm:compass", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 99000, km: 58000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const CRETA: VehicleFact = { vehicleKey: "rm:creta", marca: "Hyundai", modelo: "Creta", ano: 2021, preco: 88000, km: 40000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const ONIX_AZUL: VehicleFact = { vehicleKey: "rm:onix-azul", marca: "Chevrolet", modelo: "Onix", ano: 2023, preco: 75990, km: 62000, cambio: "Manual", cor: "Azul", tipo: "hatch" };
const ONIX_PRETO: VehicleFact = { vehicleKey: "rm:onix-preto", marca: "Chevrolet", modelo: "Onix", ano: 2025, preco: 76990, km: 43900, cambio: "Manual", cor: "Preto", tipo: "hatch" };
const STOCK = [COMPASS, CRETA, ONIX_AZUL, ONIX_PRETO];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } });

const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; excludeKeys?: string[] };
    let items = STOCK.slice();
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return toks.every((t) => vt.includes(t)); }); }
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};

class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<TurnContextPreparation> { return { interpretation: { relation: this.relation } as never, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent, evidence: TurnUnderstanding["evidence"] = [], extra: Partial<TurnUnderstanding> = {}): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence, isTopicChange: false, answeredLeadQuestions: [], ...extra });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding, effects: ProposedEffectPlan[] = [reply]): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }
const ev = (capability: string | undefined, quote: string): TurnUnderstanding["evidence"][number] => ({ capability: capability as never, quote });

const handoffAct = { kind: "handoff", planId: "handoff-req", order: 1, dependsOn: [], onSuccess: [], leadId: "", reason: "explicit_human_request", briefing: "" } as unknown as ProposedEffectPlan;
type Cap = { outbox: string; committed: boolean; stockObs: number; primaryIntent: string | null; src: string | null; slots: ConversationState["slots"] | null; selected: string | null; hasMedia: boolean; mediaKey: string | null; reason: string | null; feedback: string[] };
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:f57_${seq0++}`; let s = 0;
  const t = async (leadMsgs: string | string[], responder: BrainResponder, rel: TurnRelation = "ambiguous"): Promise<Cap> => {
    preparer.relation = rel; brain.setResponder(responder);
    const bursts = Array.isArray(leadMsgs) ? leadMsgs : [leadMsgs];
    for (const m of bursts) { await persistence.tryInsert({ eventId: `${id}-e${++s}-${Math.random().toString(36).slice(2, 6)}`, conversationId: id, raw: redact({ text: m }), receivedAt: clock.now() }); clock.advance(300); }
    clock.advance(700);
    const turnId = `${id}-t${s}`;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
      conversationId: id, tenantId: TENANT, agentId: AGENT, leadId: LEAD, crmWriteEnabled: true,
      handoff: { enabled: true, available: true, agentName: "Aloan", leadPhone: "5512999999999", leadDisplayName: "Contato", nowLocal: "15/07/2026 09:15" } as never,
      workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
      limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 3, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    });
    while (true) {
      const claimed = await persistence.claimOutbox(id, "w", 60_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock, conversationId: id, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: id, effectId: rec.effectId, result });
      }
    }
    const outbox = (await persistence.listOutbox(id)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string }; vehicleKey?: string }[];
    const after = persistence.load(id)?.state ?? null;
    const media = outbox.find((o) => o.kind === "send_media") as { kind: string; payload?: { vehicleKey?: string } } | undefined;
    return {
      outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
      stockObs: r.status === "committed" ? r.toolObservations.filter((o) => o.tool === "stock_search").length : 0,
      primaryIntent: r.status === "committed" ? r.understanding.primaryIntent : null,
      src: r.status === "committed" ? (r.responseSource ?? null) : null,
      slots: after?.slots ?? null, selected: after?.vehicleContext.selected?.key ?? null,
      hasMedia: !!media, mediaKey: media?.payload?.vehicleKey ?? null,
      reason: r.status === "committed" ? (r.decision?.reasonCode ?? null) : null,
      feedback: r.status === "committed" ? [...(r.policyFeedback ?? [])] : [],
    };
  };
  return { t };
}
const isBrain = (s: string | null): boolean => s === "brain_final" || s === "brain_retry";
const slotVal = (c: Cap, k: keyof ConversationState["slots"]): unknown => (c.slots?.[k] as { value?: unknown } | undefined)?.value;

async function main(): Promise<void> {
  console.log("== F2.57 — contrato de pagamento/referência/humano (engine real, cérebro declara understanding) ==");

  // ── [PAY] incidente: consórcio respondendo troca -> a LLM tenta pedir o NOME -> engine nega -> reautora sem nome ──
  {
    const c = conv();
    // T1: abertura -> o agente pergunta sobre TROCA (fica pendente possuiTroca)
    await c.t("Quero saber as condições", () => finU([txt("Perfeito! Para eu montar as condições, você tem algum carro para dar de troca?")], "reply", U("financing", [ev(undefined, "condicoes")])));
    // T2: consórcio (respondendo troca). 1ª autoria PEDE O NOME (deve ser negada); reautora sem nome.
    let payAttempt = 0;
    const payResponder: BrainResponder = () => {
      payAttempt += 1;
      const u = U("financing", [ev(undefined, "consorcio")]);
      if (payAttempt === 1) return finU([txt("Entendi! E qual é o seu nome para eu registrar seu atendimento?")], "ask_name", u);   // ⛔ pede nome em pagamento
      return finU([txt("Que ótimo, você tem uma carta de consórcio contemplada! Você pretende dar algum valor de entrada além dela ou prefere usar só a carta?")], "reply", u);   // ✅ acolhe, sem nome
    };
    const pay = await c.t("Não, carta consórcio contemplada de 53 mil", payResponder, "answers_pending");
    check("[PAY-1] ⭐engine NEGOU o pedido de nome em pagamento -> houve RETRY (cérebro chamado >1x)", payAttempt >= 2, `attempts=${payAttempt}`);
    check("[PAY-2] ⭐texto final NÃO pede o nome (pagamento não é cadastro)", !asksName(pay.outbox), pay.outbox);
    check("[PAY-3] consórcio NÃO virou busca (ZERO stock_search) e brain autorou", pay.stockObs === 0 && isBrain(pay.src), `stock=${pay.stockObs} src=${pay.src}`);
    check("[PAY-4] formaPagamento=consorcio; NÃO gravou possuiTroca como interesse de compra", slotVal(pay, "formaPagamento") === "consorcio", JSON.stringify(slotVal(pay, "formaPagamento")));
    check("[PAY-5] acolhe a forma de pagamento no texto (consórcio/carta)", has(pay.outbox, "consorci") || has(pay.outbox, "carta"), pay.outbox);
  }

  // ── [AZUL] "Mostra o azul" após lista -> send_media do Onix azul aterrado, ZERO stock_search ──
  {
    const c = conv();
    // T1: busca Onix -> lista (Onix azul + preto)
    const searchOnix: BrainResponder = (_f, obs) => {
      const u: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "explicit_model", subjectValue: "Onix", subjectSource: "current_turn", evidence: [ev("stock_search", "Onix")], isTopicChange: false, answeredLeadQuestions: [] };
      const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
      if (!so) return qU({ tool: "stock_search", input: { modelo: "Onix" } }, u);
      return finU([txt("Encontrei estes Onix:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart, txt("Quer as fotos de algum deles?")], "reply", u);
    };
    await c.t("Tem Onix?", searchOnix);
    // T2: "Mostra o azul" -> request_photos offer_reference -> send_media do azul
    let azulAttempt = 0;
    const azulResponder: BrainResponder = (_f, obs) => {
      azulAttempt += 1;
      const u: TurnUnderstanding = { primaryIntent: "request_photos", requestedCapabilities: ["send_photos"], subject: "offer_reference", subjectValue: "azul", subjectSource: "memory", evidence: [ev("send_photos", "foto do azul")], isTopicChange: false, answeredLeadQuestions: [] };
      const ph = obs.find((o) => o.tool === "vehicle_photos_resolve" && o.ok) as Extract<AgentToolObservation, { tool: "vehicle_photos_resolve"; ok: true }> | undefined;
      if (!ph) return qU({ tool: "vehicle_photos_resolve", input: { vehicleRef: { key: "rm:onix-azul" } } }, u);
      const media = { kind: "send_media", planId: "media", order: 1, dependsOn: [], onSuccess: [], vehicleKey: "rm:onix-azul", photoIds: ph.data.photoIds } as unknown as ProposedEffectPlan;
      return finU([txt("Aqui estão as fotos do Chevrolet Onix 2023 azul.")], "reply", u, [reply, media]);
    };
    const azul = await c.t("Manda a foto do azul", azulResponder, "answers_pending");
    check("[AZUL-1] ⭐enviou send_media do Onix AZUL aterrado (offer_reference por cor)", azul.hasMedia && azul.mediaKey === "rm:onix-azul", `media=${azul.hasMedia} key=${azul.mediaKey}`);
    check("[AZUL-2] ZERO stock_search no turno de referência + brain", azul.stockObs === 0 && isBrain(azul.src), `stock=${azul.stockObs} src=${azul.src}`);
    check("[AZUL-3] texto não vazio nomeando o carro", azul.outbox.trim().length > 0 && has(azul.outbox, "onix"), azul.outbox);
  }

  // ── [SPON] consórcio espontâneo (sem alvo) -> a LLM declara financing, tenta tool incompatível -> feedback sem regex ──
  {
    const c = conv();
    let sponAttempt = 0;
    const sponResponder: BrainResponder = (_f, obs) => {
      sponAttempt += 1;
      const so = obs.find((o) => o.tool === "stock_search") as AgentToolObservation | undefined;
      // 1ª: entende o ato como financiamento, mas propõe uma tool incompatível;
      // o bloqueio deve vir do primaryIntent da própria LLM, nunca do regex do engine.
      if (!so && sponAttempt === 1) return qU({ tool: "stock_search", input: { precoMax: 53000 } }, U("financing", [ev("stock_search", "53 mil")]));
      return finU([txt("Perfeito, você tem uma carta de consórcio contemplada! Você já escolheu algum carro ou quer que eu te mostre opções?")], "reply", U("financing", [ev(undefined, "carta contemplada")]));
    };
    const spon = await c.t("tenho carta contemplada de 53 mil", sponResponder);
    check("[SPON-1] ⭐stock_search contraditório foi bloqueado pela intenção financing (nenhuma busca executada)", spon.stockObs === 0, `stock=${spon.stockObs}`);
    check("[SPON-2] brain reautora conduzindo (não technical_fallback)", isBrain(spon.src), `src=${spon.src}`);
    check("[SPON-3] formaPagamento=consorcio registrado", slotVal(spon, "formaPagamento") === "consorcio", JSON.stringify(slotVal(spon, "formaPagamento")));
  }

  // ── [HUM] pedido humano com understanding FRACO -> tool comercial NÃO roda (backstop R7) ──
  {
    const c = conv();
    let humAttempt = 0;
    const humResponder: BrainResponder = (_f, obs) => {
      humAttempt += 1;
      const so = obs.find((o) => o.tool === "stock_search") as AgentToolObservation | undefined;
      // understanding FRACO: evidence "vendedor" (sozinha não casa HUMAN_ACT_RX) -> untrusted; 1ª tenta stock_search.
      const weak = U("search_stock", [ev("stock_search", "vendedor")]);
      if (!so && humAttempt === 1) return qU({ tool: "stock_search", input: { tipo: "suv" } }, weak);
      return finU([txt("Claro! Vou te transferir para um consultor agora mesmo.")], "handoff", U("request_human", [ev("handoff", "quero falar com um vendedor")], { requestedCapabilities: ["handoff"] }), [reply, handoffAct]);
    };
    const hum = await c.t("quero falar com um vendedor", humResponder, "direction_change");
    check("[HUM-1] ⭐tool comercial NÃO executou no pedido humano (backstop R7)", hum.stockObs === 0, `stock=${hum.stockObs}`);
    check("[HUM-2] brain autora (não technical_fallback)", isBrain(hum.src), `src=${hum.src}`);
  }

  console.log(`\n== F2.57: ${ok} OK | ${bad} FALHA ==`);
  if (bad) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
