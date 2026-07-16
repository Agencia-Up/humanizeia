// ============================================================================
// F2.15 — AUTORIA ÚNICA do agente central (singleAuthor), offline/$0 (sem OpenAI).
// Prova o fim da DUPLA AUTORIA: o cérebro AUTORA um ResponseDraft, o engine RENDERIZA aterrado (SEM 2º compose),
// valida contra os fatos REAIS, deny volta ao MESMO cérebro; esgotou -> fallback técnico honesto (nunca menu).
// Fonte autoritativa das asserções = outbox.payload.text. Estado: dois Onix, o 2º selecionado + lastPhotoAction.
//   npx tsx tests/run-f2-15-central-authorship.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { AgentBrainPort, AgentBrainStep, AgentBrainDecision, AgentToolObservation, CentralQueryCall, PhotoActionMemory, TurnFrame } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { TenantBusinessInfoSource, TenantBusinessInfo } from "../src/engine/tenant-business-info.ts";
import { deriveFallbackUnderstanding } from "../src/engine/turn-understanding.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TENANT = "ecb26258", AGENT = "d4fd5c38", CONV = "conv-authorship";
const NOW = "2026-07-03T15:00:00.000Z";
const SHA = "sha-portal-fake-integral";

// Dois Onix; o 2º (2014) = evidência de produção (revendamais:8022153, 132.623 km, Manual, Branco).
const ONIX1: VehicleFact = { vehicleKey: "revendamais:1", marca: "Chevrolet", modelo: "Onix", ano: 2016, preco: 51990, km: 80000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const ONIX2: VehicleFact = { vehicleKey: "revendamais:8022153", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 42990, km: 132623, cambio: "Manual", cor: "Branco", tipo: "hatch" };
const ONIX_NOCOLOR: VehicleFact = { vehicleKey: "revendamais:9", marca: "Chevrolet", modelo: "Onix", ano: 2015, preco: 47990, km: 95000, cambio: "Manual", cor: null, tipo: "hatch" };
const ONIX_ZEROKM: VehicleFact = { vehicleKey: "revendamais:0", marca: "Chevrolet", modelo: "Onix", ano: 2024, preco: 89990, km: 0, cambio: "Automatico", cor: "Preto", tipo: "hatch" };
const STOCK: VehicleFact[] = [ONIX1, ONIX2, ONIX_NOCOLOR, ONIX_ZEROKM];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

let toolCalls: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  toolCalls.push(call);
  if (call.tool === "vehicle_details") {
    const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey);
    return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult
            : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
  }
  if (call.tool === "stock_search") return { ok: true, tool: "stock_search", data: { items: [ONIX1, ONIX2], filtersUsed: {} as Record<string, never> }, source: "fake" } as QueryResult;
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  throw new Error("runQuery: tool não suportada: " + call.tool);
};

// Spy do 2º autor: em single-author NUNCA deve ser chamado. compose() conta + marca o texto; propose() explode.
class ComposeSpyLlm implements DecisionLlm {
  composeCalls = 0;
  async proposeNextQueryOrFinal(): Promise<never> { throw new Error("single-author NÃO deve chamar proposeNextQueryOrFinal"); }
  async compose(): Promise<ResponseDraft> { this.composeCalls++; return { parts: [{ type: "text", content: "[SPY_COMPOSE_PROIBIDO]" }] }; }
}

class FixedPreparer implements TurnContextPreparer {
  constructor(private readonly relation: TurnRelation = "asks_vehicle_detail") {}
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> {
    return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor };
  }
}
class FakeBusinessInfo implements TenantBusinessInfoSource {
  async getBusinessInfo(): Promise<TenantBusinessInfo> { return { address: null, hours: null, unit: null, source: "tenant_runtime_config" }; }
}

// Os casos desta suite exercitam grounding/autoria, nao a decodificacao da LLM.
// O runtime central exige que todo passo carregue um entendimento do turno atual;
// este adaptador preserva esse contrato no cerebro deterministico do teste.
class UnderstandingBrain implements AgentBrainPort {
  constructor(private readonly inner: ScriptedAgentBrain) {}

  async proposeNextStep(frame: TurnFrame, observations: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    const step = await this.inner.proposeNextStep(frame, observations);
    return step.understanding
      ? step
      : { ...step, understanding: deriveFallbackUnderstanding(frame.block, frame.signals, extractor) };
  }
}

const label = (v: VehicleFact): string => `${v.marca} ${v.modelo} ${v.ano}`;
function seedState(selected: VehicleFact, opts: { offer?: VehicleFact[]; withPhotoMemory?: boolean } = {}): ConversationState {
  const s = createInitialState({ conversationId: CONV, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
  s.vehicleContext.selected = { kind: "vehicle", key: selected.vehicleKey, label: label(selected) };
  const offer = opts.offer ?? [ONIX1, ONIX2];
  s.lastRenderedOfferContext = { sourceTurnId: "seed-t0", createdAt: NOW, items: offer.map((v, i) => ({ ordinal: i + 1, vehicleKey: v.vehicleKey, marca: v.marca, modelo: v.modelo, ano: v.ano, preco: v.preco })) };
  if (opts.withPhotoMemory) {
    const photoMem: PhotoActionMemory = { vehicleKey: selected.vehicleKey, label: label(selected), photoIds: ["p1", "p2"], effectId: "seed-t0:media", sourceTurnId: "seed-t0", sourceTurnNumber: 0, acceptedAt: NOW };
    s.workingMemory = { ...s.workingMemory!, lastPhotoAction: photoMem };
  }
  return s;
}

// ── builders de passos do cérebro ─────────────────────────────────────────────────────────────────────────────
const q = (call: CentralQueryCall): AgentBrainStep => ({ kind: "query", call });
function finalDraft(parts: ResponsePart[], effects?: ProposedEffectPlan[]): AgentBrainStep {
  const decision: AgentBrainDecision = {
    reasonCode: "answer", reasonSummary: "resposta", confidence: 0.9,
    responsePlan: { guidance: "responder o cliente", draft: { parts } },
    proposedEffects: effects ?? [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan],
    memoryMutations: [], stateMutations: [],
  };
  return { kind: "final", decision };
}
const vref = (v: VehicleFact, field: "marca" | "modelo" | "ano" | "km" | "cambio" | "cor"): ResponsePart => ({ type: "vehicle_ref", vehicleKey: v.vehicleKey, field });
const price = (v: VehicleFact): ResponsePart => ({ type: "money_ref", role: "vehicle_price", source: { kind: "vehicle_fact", vehicleKey: v.vehicleKey } });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const media = (v: VehicleFact, photoIds: string[]): ProposedEffectPlan => ({ kind: "send_media", planId: "media", order: 1, vehicleKey: v.vehicleKey, photoIds, onSuccess: [{ op: "mark_photos_sent", effectId: "x", vehicleKey: v.vehicleKey, photoIds }] } as ProposedEffectPlan);

const producedTexts: string[] = [];
const srcOf = (r: CentralTurnResult): string => (r.status === "committed" ? r.responseSource : r.status);
const degradedOf = (r: CentralTurnResult): boolean => r.status === "committed" && r.degraded;
// Recuperação fechada pode ser contextual (não degradada) ou técnica (degradada). O ponto é nunca inventar atributo.
const isRecoverySrc = (r: CentralTurnResult): boolean => srcOf(r) === "technical_fallback" || srcOf(r) === "deterministic_recovery";
const hasMedia = (r: CentralTurnResult): boolean => r.status === "committed" && r.outbox.some((o) => o.kind === "send_media");

let seq = 0;
async function runTurn(opts: { state: ConversationState; leadText: string; script: AgentBrainStep[]; relation?: TurnRelation; brainMaxSteps?: number }): Promise<{ result: CentralTurnResult; outboxText: string; toolCalls: QueryCall[]; composeCalls: number; brain: ScriptedAgentBrain }> {
  toolCalls = [];
  seq += 1;
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  { const uow = persistence.begin(); uow.casState(CONV, 0, opts.state); await uow.commit(); }
  await persistence.tryInsert({ eventId: `${CONV}-e${seq}`, conversationId: CONV, raw: redact({ text: opts.leadText }), receivedAt: clock.now() });
  clock.advance(1000);
  const brain = new ScriptedAgentBrain();
  brain.setTurnScript(opts.script);
  const llm = new ComposeSpyLlm();
  const result = await runCentralConversationTurn({
    persistence, clock, brain: new UnderstandingBrain(brain), llm, runQuery, businessInfo: new FakeBusinessInfo(),
    contextPreparer: new FixedPreparer(opts.relation ?? "asks_vehicle_detail"),
    conversationId: CONV, tenantId: TENANT, agentId: AGENT, leadId: null,
    workerId: "w", turnId: `${CONV}-t${seq}`, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: opts.brainMaxSteps ?? 4,
    allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" },
    singleAuthor: true,
  });
  const outbox = await persistence.listOutbox(CONV);
  const sendMsg = outbox.find((o) => o.kind === "send_message");
  const outboxText = typeof (sendMsg?.payload as any)?.text === "string" ? (sendMsg!.payload as any).text : "";
  producedTexts.push(outboxText);
  return { result, outboxText, toolCalls: [...toolCalls], composeCalls: llm.composeCalls, brain };
}
const calledDetailsOf = (calls: QueryCall[], key: string): boolean => calls.some((c) => c.tool === "vehicle_details" && (c.input as { vehicleKey?: string }).vehicleKey === key);

async function main(): Promise<void> {
  console.log("== F2.15 Autoria única do agente central (offline, $0) ==");

  // [1]+[6]+[10] km: consulta vehicle_details do 2º e envia EXATAMENTE 132.623 km; ZERO compose; valor == fato.
  const r1 = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "ele tem quantos km?", script: [
    q({ tool: "vehicle_details", input: { vehicleKey: ONIX2.vehicleKey } }),
    finalDraft([txt("Esse Onix tem"), vref(ONIX2, "km"), txt("rodados. Quer agendar uma visita pra ver de perto?")]),
  ] });
  check("[1] km: vehicle_details da key do 2º + envia 132.623 km", r1.result.status === "committed" && calledDetailsOf(r1.toolCalls, ONIX2.vehicleKey) && r1.outboxText.includes("132.623 km"), `${r1.result.status} text="${r1.outboxText}"`);
  check("[6] central_active faz ZERO chamadas a DecisionLlm.compose", r1.composeCalls === 0);
  check("[10] o km enviado é o do QueryResult do MESMO vehicleKey", r1.outboxText.includes(ONIX2.km!.toLocaleString("pt-BR")) && !r1.outboxText.includes(ONIX1.km!.toLocaleString("pt-BR")));

  // [2] cor do 2º -> Branco (e não Prata do 1º).
  const r2 = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "E a cor dele, é qual?", script: [
    q({ tool: "vehicle_details", input: { vehicleKey: ONIX2.vehicleKey } }),
    finalDraft([txt("Ele é na cor"), vref(ONIX2, "cor"), txt(". Quer ver de perto?")]),
  ] });
  check("[2] cor: mantém a mesma key e envia Branco (não Prata)", r2.result.status === "committed" && r2.outboxText.includes("Branco") && !r2.outboxText.includes("Prata") && r2.composeCalls === 0, `text="${r2.outboxText}"`);

  // [3] câmbio / ano / preço seguem a mesma regra (fato do MESMO vehicleKey).
  const r3a = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "qual o câmbio?", script: [
    q({ tool: "vehicle_details", input: { vehicleKey: ONIX2.vehicleKey } }), finalDraft([txt("O câmbio é"), vref(ONIX2, "cambio"), txt(".")]),
  ] });
  const r3b = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "qual o ano?", relation: "asks_vehicle_detail", script: [
    q({ tool: "vehicle_details", input: { vehicleKey: ONIX2.vehicleKey } }), finalDraft([txt("É"), vref(ONIX2, "ano"), txt(".")]),
  ] });
  const r3c = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "qual o preço dele?", script: [
    q({ tool: "vehicle_details", input: { vehicleKey: ONIX2.vehicleKey } }), finalDraft([txt("Ele sai por"), price(ONIX2), txt(".")]),
  ] });
  check("[3] câmbio=Manual, ano=2014, preço=R$ 42.990 (todos do fato certo)", r3a.outboxText.includes("Manual") && r3b.outboxText.includes("2014") && r3c.outboxText.includes("R$ 42.990") && r3a.composeCalls === 0 && r3b.composeCalls === 0 && r3c.composeCalls === 0, `cambio="${r3a.outboxText}" ano="${r3b.outboxText}" preco="${r3c.outboxText}"`);

  // [4] campo AUSENTE (cor null) -> render falha fechado -> retry -> defere honesto; nunca 0/vazio/cor de outro carro.
  const r4 = await runTurn({ state: seedState(ONIX_NOCOLOR), leadText: "qual a cor dele?", script: [
    q({ tool: "vehicle_details", input: { vehicleKey: ONIX_NOCOLOR.vehicleKey } }),
    finalDraft([txt("A cor é"), vref(ONIX_NOCOLOR, "cor")]),        // cor null -> falha fechada
    finalDraft([txt("Deixa eu confirmar a cor certinho e já te falo.")]),  // retry honesto
  ] });
  const r4NoFabric = !/\bbranc|\bprat|\bpret|\bcinz|\bverm/i.test(r4.outboxText) && !/(^|\D)0(\D|$)/.test(r4.outboxText);
  check("[4] campo ausente -> defere honesto (sem 0/vazio/cor de outro carro)", r4.result.status === "committed" && /confirmar/i.test(r4.outboxText) && r4NoFabric && r4.composeCalls === 0, `text="${r4.outboxText}"`);

  // [5] "0 km" SÓ com zero factual retornado pela tool.
  const r5 = await runTurn({ state: seedState(ONIX_ZEROKM), leadText: "quantos km ele tem?", script: [
    q({ tool: "vehicle_details", input: { vehicleKey: ONIX_ZEROKM.vehicleKey } }),
    finalDraft([txt("Esse é"), vref(ONIX_ZEROKM, "km"), txt("— zero rodados!")]),
  ] });
  check("[5] '0 km' aparece SÓ com zero factual da tool", r5.result.status === "committed" && r5.outboxText.includes("0 km") && r5.composeCalls === 0, `text="${r5.outboxText}"`);
  // [5b] sem fato real, km NUNCA vira "0 km" (fabricação eliminada) -> falha fechada -> fallback honesto.
  const r5b = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "quantos km?", brainMaxSteps: 1, script: [
    finalDraft([txt("Tem"), vref(ONIX2, "km"), txt("km")]),  // sem fetch -> identidade sem km -> falha fechada
  ] });
  check("[5b] sem fato real km NÃO vira '0 km' nem valor do transcript", r5b.result.status === "committed" && !r5b.outboxText.includes("0 km") && !r5b.outboxText.includes("132.623") && isRecoverySrc(r5b.result), `text="${r5b.outboxText}"`);

  // [7] draft AUTORADO rejeitado (render/policy deny) -> feedback ao MESMO cérebro -> re-autora aterrado (brain_retry).
  // (Já tem o vehicle_details do selecionado; o 1º draft cita a KM de OUTRO carro NÃO consultado -> render falha.)
  const r7 = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "quantos km ele tem?", script: [
    q({ tool: "vehicle_details", input: { vehicleKey: ONIX2.vehicleKey } }),                  // satisfaz B2 (selecionado)
    finalDraft([txt("Sobre o outro, tem"), vref(ONIX1, "km"), txt("km")]),                    // ONIX1 NÃO consultado -> render deny
    finalDraft([txt("Tem"), vref(ONIX2, "km"), txt("km rodados.")]),                          // corrige com a key certa
  ] });
  check("[7] draft rejeitado -> retry corretivo no MESMO cérebro -> acerta (brain_retry)", r7.result.status === "committed" && calledDetailsOf(r7.toolCalls, ONIX2.vehicleKey) && r7.outboxText.includes("132.623 km") && !r7.outboxText.includes("80.000") && srcOf(r7.result) === "brain_retry" && r7.composeCalls === 0, `text="${r7.outboxText}" src=${srcOf(r7.result)}`);

  // [8] retry falha (cérebro NUNCA consulta) -> fallback técnico honesto, SEM menu comercial desconectado.
  const r8 = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "quantos km?", script: [
    finalDraft([vref(ONIX2, "km")]), finalDraft([vref(ONIX2, "km")]), finalDraft([vref(ONIX2, "km")]), finalDraft([vref(ONIX2, "km")]),
  ] });
  const r8NoMenu = !/opç|opcoes|opções|tenho estas|essas opç|\n\s*\d\.\s/i.test(r8.outboxText);
  check("[8] retry falha -> fallback técnico honesto, SEM menu comercial", r8.result.status === "committed" && isRecoverySrc(r8.result) && r8NoMenu && r8.outboxText.length > 0 && r8.composeCalls === 0, `src=${srcOf(r8.result)} text="${r8.outboxText}"`);

  // [12] pergunta simples sem necessidade NÃO chama tool.
  const r12 = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "bom dia!", relation: "ambiguous", script: [
    finalDraft([txt("Bom dia! Como posso te ajudar hoje?")]),
  ] });
  check("[12] pergunta simples sem necessidade NÃO chama tool", r12.result.status === "committed" && r12.toolCalls.length === 0 && r12.outboxText.includes("Bom dia") && r12.composeCalls === 0, `tools=${r12.toolCalls.length}`);

  // [13] o ÚNICO AgentBrain recebe a prova do prompt do portal (SHA integral no frame).
  const r13 = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "oi", relation: "ambiguous", script: [finalDraft([txt("Oi! Tudo bem?")])] });
  check("[13] prompt do portal integral no único AgentBrain (SHA no frame)", r13.brain.seenFrames.length >= 1 && r13.brain.seenFrames[0].portalPromptSha256 === SHA, `sha=${r13.brain.seenFrames[0]?.portalPromptSha256}`);

  // [14] no máximo UMA pergunta ao lead (o draft trouxe duas; o engine trima).
  const r14 = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "quantos km e qual a cor?", script: [
    q({ tool: "vehicle_details", input: { vehicleKey: ONIX2.vehicleKey } }),
    finalDraft([txt("Tem"), vref(ONIX2, "km"), txt("km, cor"), vref(ONIX2, "cor"), txt(". Quer ver de perto? Prefere manhã ou tarde?")]),
  ] });
  const q14 = (r14.outboxText.match(/\?/g) ?? []).length;
  check("[14] no máximo UMA pergunta ao lead", r14.result.status === "committed" && q14 <= 1 && r14.outboxText.includes("132.623 km") && r14.outboxText.includes("Branco"), `perguntas=${q14} text="${r14.outboxText}"`);

  // [15] B2: pergunta de atributo do selecionado SEM vehicle_details -> nunca afirma o atributo -> recuperação contextual.
  const r15 = await runTurn({ state: seedState(ONIX2, { withPhotoMemory: true }), leadText: "quantos km ele tem?", script: [
    finalDraft([txt("Tem"), vref(ONIX2, "km"), txt("km")]), finalDraft([txt("Tem"), vref(ONIX2, "km"), txt("km")]),
    finalDraft([txt("Tem"), vref(ONIX2, "km"), txt("km")]), finalDraft([txt("Tem"), vref(ONIX2, "km"), txt("km")]),
  ] });
  check("[15] B2: final sem vehicle_details do selecionado -> nunca envia atributo -> recuperação contextual", r15.result.status === "committed" && isRecoverySrc(r15.result) && degradedOf(r15.result) === false && !r15.outboxText.includes("132.623") && r15.composeCalls === 0, `src=${srcOf(r15.result)} degraded=${degradedOf(r15.result)} text="${r15.outboxText}"`);

  // [16] postQuery deny (POL-TRACK-001: responder pagamento não vira envio de foto) -> draft original NÃO vai;
  //      feedback -> re-autora sem o efeito comercial. NENHUM send_media original sobrevive no outbox.
  const payState = seedState(ONIX2, { withPhotoMemory: true });
  payState.currentObjective = { id: "obj-pay", type: "perguntou_pagamento", slot: "formaPagamento", askedAt: NOW, askedInTurnId: "seed-t0", deliveredByEffectId: "seed-t0:msg", deliveryLevel: "accepted", expectedAnswerKinds: ["valor"], status: "pending", attempts: 1 };
  const r16 = await runTurn({ state: payState, leadText: "me manda a foto dele", relation: "answers_pending", script: [
    finalDraft([txt("Aqui as fotos!")], [reply, media(ONIX2, ["p1", "p2"])]),        // send_photos -> POL-TRACK-001 deny
    finalDraft([txt("Sobre o pagamento, trabalhamos com à vista e financiamento. Como você prefere?")]),  // re-autora sem foto
  ] });
  check("[16] postQuery deny -> draft original não vai; nenhum send_media original sobrevive (brain_retry)", r16.result.status === "committed" && !hasMedia(r16.result) && srcOf(r16.result) === "brain_retry" && /pagamento/i.test(r16.outboxText) && r16.composeCalls === 0, `media=${hasMedia(r16.result)} src=${srcOf(r16.result)} text="${r16.outboxText}"`);

  // [17] identidade LEMBRADA sem ano/preço NUNCA vira 0/-1: sem fetch, vehicle_ref(ano)/money_ref falham fechado.
  const noYearState = seedState(ONIX2, {});
  noYearState.vehicleContext.selected = { kind: "vehicle", key: ONIX2.vehicleKey, label: "Chevrolet Onix" }; // sem ano no label
  noYearState.lastRenderedOfferContext = { sourceTurnId: "seed-t0", createdAt: NOW, items: [{ ordinal: 1, vehicleKey: ONIX2.vehicleKey, marca: "Chevrolet", modelo: "Onix", ano: null, preco: null }] };
  const r17a = await runTurn({ state: noYearState, leadText: "de que ano é?", relation: "ambiguous", brainMaxSteps: 1, script: [finalDraft([txt("É de"), vref(ONIX2, "ano")])] });
  const r17b = await runTurn({ state: noYearState, leadText: "qual o preço?", relation: "ambiguous", brainMaxSteps: 1, script: [finalDraft([txt("Sai por"), price(ONIX2)])] });
  const r17aNoZero = !/\b0\b/.test(r17a.outboxText) && !/\b-?1\b/.test(r17a.outboxText);
  const r17bNoZero = !/R\$\s*-?1\b/.test(r17b.outboxText) && !/R\$\s*0\b/.test(r17b.outboxText);
  check("[17] identidade sem ano/preço não vira 0/-1 (falha fechada contextual)", isRecoverySrc(r17a.result) && isRecoverySrc(r17b.result) && degradedOf(r17a.result) === false && degradedOf(r17b.result) === false && r17aNoZero && r17bNoZero && r17a.composeCalls === 0 && r17b.composeCalls === 0, `ano="${r17a.outboxText}" preco="${r17b.outboxText}"`);

  // [9] fonte autoritativa = outbox.payload.text (todos os checks acima leram outboxText, nunca reasonSummary).
  check("[9] asserções examinam outbox.payload.text (não reasonSummary)", producedTexts.length >= 12 && producedTexts.every((t) => typeof t === "string"));
  // [11] nenhum U+FFFD em nenhuma resposta enviada.
  check("[11] nenhum U+FFFD nas respostas enviadas", producedTexts.every((t) => !t.includes("�")), producedTexts.find((t) => t.includes("�")) ?? "");

  if (fail > 0) { console.error(`\nF2.15 AUTORIA ÚNICA: ${ok} OK | ${fail} FALHA`); for (const f of fails) console.error(` - ${f}`); process.exit(1); }
  console.log(`\nF2.15 AUTORIA ÚNICA: ${ok} OK | 0 FALHA`);
}
main().catch((e) => { console.error(e); process.exit(1); });
