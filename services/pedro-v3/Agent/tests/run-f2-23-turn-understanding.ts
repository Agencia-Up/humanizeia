// ============================================================================
// F2.23 — FONTE ÚNICA (TurnUnderstanding): elimina fallbacks por conflito cérebro×regex×memória×alvo. Engine central
// REAL, AgentBrain SCRIPTADO (emite understanding no MESMO ciclo), effects OFF. Cobre os 3 incidentes Codex + guardas.
//   npx tsx tests/run-f2-23-turn-understanding.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { createInitialState, type ConversationState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, CentralQueryCall, TurnUnderstanding, TurnCapability, TurnSubjectKind, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-05T12:00:00.000Z", SHA = "sha-23";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Estoque: Onix + 3 Kicks (o "kiks" com typo deve virar Kicks pelo cérebro; nomes/keys distintos p/ o alvo).
const ONIX: VehicleFact = { vehicleKey: "revendamais:8187454", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 54990, km: 132623, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const KICKS1: VehicleFact = { vehicleKey: "revendamais:8195951", marca: "Nissan", modelo: "Kicks", ano: 2020, preco: 82990, km: 60000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const KICKS2: VehicleFact = { vehicleKey: "revendamais:8195953", marca: "Nissan", modelo: "Kicks", ano: 2021, preco: 88990, km: 45000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const KICKS3: VehicleFact = { vehicleKey: "revendamais:8085609", marca: "Nissan", modelo: "Kicks", ano: 2022, preco: 94990, km: 30000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const KICKS_A: VehicleFact = { vehicleKey: "revendamais:8195955", marca: "Nissan", modelo: "Kicks", ano: 2022, preco: 95990, km: 28000, cambio: "Automatico", cor: "Preto", tipo: "suv" };
// Modelos de IDENTIDADE (audit Codex): Onix≠Onix Plus, HB20≠HB20S, C3≠C3 Aircross; "HB 20"=="HB20" só por formatação.
const ONIX_PLUS: VehicleFact = { vehicleKey: "revendamais:onixplus", marca: "Chevrolet", modelo: "Onix Plus", ano: 2021, preco: 74990, km: 40000, cambio: "Automatico", cor: "Branco", tipo: "sedan" };
const HB20: VehicleFact = { vehicleKey: "revendamais:hb20", marca: "Hyundai", modelo: "HB20", ano: 2019, preco: 59990, km: 55000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const HB20S: VehicleFact = { vehicleKey: "revendamais:hb20s", marca: "Hyundai", modelo: "HB20S", ano: 2019, preco: 64990, km: 52000, cambio: "Manual", cor: "Preto", tipo: "sedan" };
const C3: VehicleFact = { vehicleKey: "revendamais:c3", marca: "Citroen", modelo: "C3", ano: 2016, preco: 44990, km: 90000, cambio: "Manual", cor: "Vermelho", tipo: "hatch" };
const C3_AIRCROSS: VehicleFact = { vehicleKey: "revendamais:c3aircross", marca: "Citroen", modelo: "C3 Aircross", ano: 2015, preco: 47990, km: 116000, cambio: "Manual", cor: "Branco", tipo: "suv" };
const STOCK = [ONIX, KICKS1, KICKS2, KICKS3, KICKS_A, ONIX_PLUS, HB20, HB20S, C3, C3_AIRCROSS];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") { const inp = call.input as { tipo?: string; modelo?: string }; let items = STOCK.slice(); if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo); if (inp.modelo) items = items.filter((v) => norm(v.modelo).includes(norm(inp.modelo!))); return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

// ── builders de understanding + steps ──
type UOpts = { caps?: TurnCapability[]; subject?: TurnSubjectKind; subjectValue?: string | null; subjectSource?: "current_turn" | "memory" | "inference" | "none"; evidence?: { capability?: TurnCapability; quote: string }[]; topicChange?: boolean };
const U = (primaryIntent: PrimaryIntent, o: UOpts = {}): TurnUnderstanding => ({
  primaryIntent, requestedCapabilities: o.caps ?? [], subject: o.subject ?? "none", subjectValue: o.subjectValue ?? null,
  subjectSource: o.subjectSource ?? "none", evidence: o.evidence ?? [], isTopicChange: o.topicChange ?? false, answeredLeadQuestions: [],
});
const txt = (content: string): ResponsePart => ({ type: "text", content });
const offer = (vs: VehicleFact[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: vs.map((v) => v.vehicleKey) });
const vref = (v: VehicleFact, field: "km" | "cor"): ResponsePart => ({ type: "vehicle_ref", vehicleKey: v.vehicleKey, field });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const mediaEff = (v: VehicleFact): ProposedEffectPlan => ({ kind: "send_media", planId: "m", order: 1, vehicleKey: v.vehicleKey, photoIds: ["p1", "p2"], onSuccess: [] } as ProposedEffectPlan);
const qU = (call: CentralQueryCall, u: TurnUnderstanding): AgentBrainStep => ({ kind: "query", call, understanding: u });
function finU(parts: ResponsePart[], effects: ProposedEffectPlan[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function finUMut(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding, stateMutations: unknown[]): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations } as AgentBrainDecision };
}
const selMut = (v: VehicleFact) => ({ op: "select_vehicle_focus", vehicle: { kind: "vehicle", key: v.vehicleKey, label: `${v.marca} ${v.modelo} ${v.ano}` }, sourceTurnId: "t" });

type Cap = { outbox: string; src: string; degraded: boolean; committed: boolean; terminalSafe: boolean; hasMedia: boolean; mediaKey: string | null; exec: string[]; primaryIntent: string; targetSource: string | null; recoveryReason: string | null; fromBrain: boolean; brainSteps: number; selectedKey: string | null };
const photoResolve = (v: VehicleFact, u: TurnUnderstanding): AgentBrainStep => qU({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: v.vehicleKey } } } as CentralQueryCall, u);

async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, relation: TurnRelation, script: AgentBrainStep[] | BrainResponder): Promise<Cap> {
  executed.length = 0; preparer.relation = relation;
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
  const execSnap = executed.map((e) => e.tool);
  while (true) { const claimed = await persistence.claimOutbox(convId, "w", 120_000, 25); if (claimed.length === 0) break; for (const rec of claimed as unknown as { effectId: string; kind: string }[]) { const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev`, at: clock.now() }; const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt }; await commitEffectOutcome({ persistence, clock, conversationId: convId, effectId: rec.effectId, result }); if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result }); } }
  clock.advance(30000);
  const after = (await persistence.load(convId))?.state;
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", src: r.status === "committed" ? r.responseSource : r.status,
    degraded: r.status === "committed" && r.degraded, committed: r.status === "committed", terminalSafe: r.status === "committed" && r.terminalSafe,
    hasMedia: outbox.some((o) => o.kind === "send_media"), mediaKey: r.status === "committed" ? r.resolvedVehicleKey : null,
    exec: execSnap, primaryIntent: r.status === "committed" ? r.understanding.primaryIntent : "?", targetSource: r.status === "committed" ? r.targetResolutionSource : null,
    recoveryReason: r.status === "committed" ? r.recoveryReason : null, fromBrain: r.status === "committed" && r.understandingFromBrain, brainSteps: r.status === "committed" ? r.brainSteps : -1,
    selectedKey: (after as { vehicleContext?: { selected?: { key?: string } } } | undefined)?.vehicleContext?.selected?.key ?? null,
  };
}
let seq0 = 0;
function conv(seedState?: Partial<ConversationState>) {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `conv-${seq0++}`; let s = 0;
  const seed = async (): Promise<void> => { if (!seedState) return; const base = { ...createInitialState({ conversationId: id, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }), ...seedState } as ConversationState; const uow = persistence.begin(); uow.casState(id, 0, base); if (!(await uow.commit()).ok) throw new Error("seed_failed"); };
  const t = (lead: string, relation: TurnRelation, script: AgentBrainStep[] | BrainResponder): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, relation, script);
  return { seed, t };
}
const sel = (v: VehicleFact) => ({ vehicleContext: { selected: { kind: "vehicle" as const, key: v.vehicleKey, label: `${v.marca} ${v.modelo} ${v.ano}` } } } as Partial<ConversationState>);
const offerCtx = (vs: VehicleFact[]) => ({ lastRenderedOfferContext: { sourceTurnId: "seed", createdAt: NOW, items: vs.map((v, i) => ({ ordinal: i + 1, vehicleKey: v.vehicleKey, marca: v.marca, modelo: v.modelo, ano: v.ano, preco: v.preco })) } } as Partial<ConversationState>);
const photoMem = (v: VehicleFact) => ({ workingMemory: { ...createInitialState({ conversationId: "x", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }).workingMemory, lastPhotoAction: { vehicleKey: v.vehicleKey, label: `${v.marca} ${v.modelo} ${v.ano}`, photoIds: ["p1", "p2"], effectId: "seed:m", sourceTurnId: "seed", sourceTurnNumber: 0, acceptedAt: NOW } } } as Partial<ConversationState>);

async function main(): Promise<void> {
  console.log("== F2.23 Fonte única (TurnUnderstanding): incidentes Kicks/Onix + guardas ==");

  // A) INCIDENTE 1: selected=Onix + memória de foto; oferta tem o Kicks (assunto VERIFICÁVEL por modelo); "Quero ver
  //    fotos do Kicks"; cérebro resolve fotos do Kicks -> send_media do KICKS (assunto), NUNCA do Onix selecionado antigo.
  {
    const c = conv({ ...sel(ONIX), ...photoMem(ONIX), ...offerCtx([KICKS_A]) }); await c.seed();
    const uA = U("request_photos", { caps: ["send_photos"], subject: "explicit_model", subjectValue: "Kicks", subjectSource: "current_turn", evidence: [{ capability: "send_photos", quote: "fotos do Kicks" }], topicChange: true });
    const cap = await c.t("Certo\nQuero ver fotos do Kicks", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok) ? finU([], [reply], "send_photos", uA) : photoResolve(KICKS_A, uA));
    check("[A] Inc1: envia foto do KICKS (não do Onix antigo)", cap.hasMedia && cap.mediaKey === KICKS_A.vehicleKey && cap.mediaKey !== ONIX.vehicleKey, `mediaKey=${cap.mediaKey} src=${cap.src}`);
    check("[A] alvo do ASSUNTO verificado por modelo (não selecionado antigo), sem fallback", cap.targetSource === "turn_explicit_model" && cap.src === "deterministic_photo" && !cap.degraded, `targetSource=${cap.targetSource} src=${cap.src}`);
  }
  // J) P0-1: pediu Kicks, mas o cérebro AUTORA send_media do ONIX (carro errado) -> REJEITADO; NUNCA envia o Onix.
  {
    const c = conv({ ...sel(ONIX), ...offerCtx([KICKS_A]) }); await c.seed();
    const uJ = U("request_photos", { caps: ["send_photos"], subject: "explicit_model", subjectValue: "Kicks", subjectSource: "current_turn", evidence: [{ capability: "send_photos", quote: "fotos do Kicks" }] });
    const cap = await c.t("me manda as fotos do Kicks", "ambiguous", [finU([txt("Aqui estão:")], [reply, mediaEff(ONIX)], "send_photos", uJ), finU([txt("Aqui estão:")], [reply, mediaEff(ONIX)], "send_photos", uJ), finU([txt("Aqui estão:")], [reply, mediaEff(ONIX)], "send_photos", uJ)]);
    check("[J] P0-1: foto do carro ERRADO (Onix p/ pedido de Kicks) é REJEITADA -> ZERO mídia do Onix", !cap.hasMedia || cap.mediaKey !== ONIX.vehicleKey, `media=${cap.hasMedia} mediaKey=${cap.mediaKey}`);
  }
  // L) P0-1: 3 Kicks na oferta, "me manda fotos do Kicks" SEM ordinal/ano -> AMBÍGUO -> pergunta qual, ZERO mídia.
  {
    const c = conv({ ...offerCtx([KICKS1, KICKS2, KICKS3]) }); await c.seed();
    const uL = U("request_photos", { caps: ["send_photos"], subject: "explicit_model", subjectValue: "Kicks", subjectSource: "current_turn", evidence: [{ capability: "send_photos", quote: "fotos do Kicks" }] });
    const cap = await c.t("me manda fotos do Kicks", "ambiguous", [finU([], [reply], "send_photos", uL), finU([], [reply], "send_photos", uL)]);
    check("[L] P0-1: 3 variantes sem seleção -> pergunta QUAL, ZERO mídia", !cap.hasMedia && /qual|numero|número|ano/.test(norm(cap.outbox)), `media=${cap.hasMedia} text="${cap.outbox}"`);
  }
  // N) P0-1: selected=Onix, sem Kicks conhecido; "fotos do Kicks"; cérebro autora send_media do Onix herdando o selected
  //    -> REJEITADO (Onix não é do assunto Kicks; selected antigo NUNCA vence outro modelo). ZERO mídia do Onix.
  {
    const c = conv({ ...sel(ONIX) }); await c.seed();
    const uN = U("request_photos", { caps: ["send_photos"], subject: "explicit_model", subjectValue: "Kicks", subjectSource: "current_turn", evidence: [{ capability: "send_photos", quote: "fotos do Kicks" }], topicChange: true });
    const cap = await c.t("quero fotos do Kicks", "ambiguous", [finU([txt("Aqui:")], [reply, mediaEff(ONIX)], "send_photos", uN), finU([txt("Aqui:")], [reply, mediaEff(ONIX)], "send_photos", uN)]);
    check("[N] P0-1: modelo diferente NÃO herda o selected antigo (Onix p/ Kicks) -> ZERO mídia do Onix", !cap.hasMedia || cap.mediaKey !== ONIX.vehicleKey, `media=${cap.hasMedia} mediaKey=${cap.mediaKey}`);
  }
  // B) INCIDENTE 2: memória de foto anterior; "E o kiks, tem?"; cérebro entende search_stock (typo->Kicks); busca; sem
  //    mídia; sem falar do Onix; sem technical_fallback.
  {
    const c = conv({ ...sel(ONIX), ...photoMem(ONIX) }); await c.seed();
    const uB = U("search_stock", { caps: ["stock_search"], subject: "explicit_model", subjectValue: "Kicks", subjectSource: "inference", evidence: [{ capability: "stock_search", quote: "kiks, tem" }], topicChange: true });
    const cap = await c.t("E o kiks, tem?", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "stock_search" && o.ok) ? finU([txt("Temos sim, essas opções de Kicks:"), offer([KICKS1, KICKS2, KICKS3])], [reply], "offer", uB) : qU({ tool: "stock_search", input: { modelo: "kicks", tipo: "suv" } } as CentralQueryCall, uB));
    check("[B] Inc2: typo vira BUSCA (stock_search), sem mídia, sem technical_fallback", cap.committed && cap.exec.includes("stock_search") && !cap.hasMedia && !cap.degraded && cap.primaryIntent === "search_stock", `exec=${JSON.stringify(cap.exec)} media=${cap.hasMedia} src=${cap.src}`);
    check("[B] não fala do Onix (memória antiga não sequestra)", !has(cap.outbox, "onix"), `text="${cap.outbox}"`);
  }
  // C) INCIDENTE 3: última lista com 3 Kicks; "quero comprar o terceiro\nMe mande fotos"; seleciona o 3º, resolve fotos
  //    dele, ENVIA (o regex antigo não pegava "mande"). Sem fallback.
  {
    const c = conv({ ...offerCtx([KICKS1, KICKS2, KICKS3]) as Partial<ConversationState> }); await c.seed();
    const uC = U("request_photos", { caps: ["send_photos", "select"], subject: "ordinal_from_last_offer", subjectValue: "3", subjectSource: "current_turn", evidence: [{ capability: "send_photos", quote: "me mande fotos" }, { capability: "select", quote: "o terceiro" }] });
    const cap = await c.t("quero comprar o terceiro\nMe mande fotos", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok) ? finU([txt("Ótima escolha! Aqui estão as fotos:")], [reply, mediaEff(KICKS3)], "send_photos", uC) : photoResolve(KICKS3, uC));
    check("[C] Inc3: 'Me mande fotos' AUTORIZA envio do 3º Kicks (flexão não barra)", cap.hasMedia && cap.mediaKey === KICKS3.vehicleKey && !cap.degraded, `mediaKey=${cap.mediaKey} src=${cap.src}`);
  }
  // D) NEGAÇÃO fail-closed: "não quero fotos agora" -> zero mídia mesmo se o cérebro (errado) propuser send_media.
  {
    const c = conv({ ...sel(ONIX) }); await c.seed();
    const uD = U("request_photos", { caps: ["send_photos"], evidence: [{ capability: "send_photos", quote: "fotos" }] });   // cérebro MISCLASSIFICA
    const cap = await c.t("não quero fotos agora, obrigado", "ambiguous", [finU([txt("Tranquilo! Qualquer coisa é só chamar. 😊")], [reply, mediaEff(ONIX)], "send_photos", uD)]);
    check("[D] negação escopada -> ZERO send_media (fail-closed), acolhe e segue", cap.committed && !cap.hasMedia, `media=${cap.hasMedia} src=${cap.src}`);
  }
  // E) MEMÓRIA de foto: "qual carro eu pedi fotos?" -> recall, ZERO mídia, nomeia o veículo.
  {
    const c = conv({ ...sel(ONIX), ...photoMem(ONIX) }); await c.seed();
    const uE = U("recall_photos", { caps: ["recall"], evidence: [{ capability: "recall", quote: "qual carro eu pedi fotos" }] });
    const cap = await c.t("qual carro eu pedi fotos?", "ambiguous", [finU([txt("Você pediu as fotos do Chevrolet Onix 2014. Quer ver mais detalhes dele?")], [reply], "recall", uE)]);
    check("[E] recall de foto -> ZERO mídia + nomeia o veículo", cap.committed && !cap.hasMedia && has(cap.outbox, "Onix"), `media=${cap.hasMedia} text="${cap.outbox}"`);
  }
  // F) "Bonito ele" -> smalltalk, ZERO mídia, mantém foco.
  {
    const c = conv({ ...sel(ONIX) }); await c.seed();
    const uF = U("smalltalk", { evidence: [{ quote: "bonito ele" }] });
    const cap = await c.t("Bonito ele", "ambiguous", [finU([txt("Que bom que gostou! Quer que eu te passe as condições dele ou agende uma visita?")], [reply], "reply", uF)]);
    check("[F] smalltalk 'bonito ele' -> ZERO mídia, mantém o foco no Onix", cap.committed && !cap.hasMedia && cap.selectedKey === ONIX.vehicleKey, `media=${cap.hasMedia} sel=${cap.selectedKey}`);
  }
  // G) TROCA de veículo após fotos: T1 fotos do Onix; T2 "e o Kicks, tem?" -> busca Kicks, foco antigo não interfere.
  {
    const c = conv({ ...sel(ONIX) }); await c.seed();
    const uG1 = U("request_photos", { caps: ["send_photos"], subject: "selected_vehicle", subjectSource: "memory", evidence: [{ capability: "send_photos", quote: "foto do onix" }] });
    await c.t("me manda foto do Onix", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok) ? finU([txt("Aqui estão as fotos:")], [reply, mediaEff(ONIX)], "send_photos", uG1) : photoResolve(ONIX, uG1));
    const uG2 = U("search_stock", { caps: ["stock_search"], subject: "explicit_model", subjectValue: "Kicks", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "o kicks, tem" }], topicChange: true });
    const cap = await c.t("e o Kicks, tem?", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "stock_search" && o.ok) ? finU([txt("Temos! Olha essas opções:"), offer([KICKS1, KICKS2])], [reply], "offer", uG2) : qU({ tool: "stock_search", input: { modelo: "kicks", tipo: "suv" } } as CentralQueryCall, uG2));
    check("[G] troca de veículo: T2 busca Kicks (stock_search), sem mídia, foco antigo não interfere", cap.committed && cap.exec.includes("stock_search") && !cap.hasMedia && has(cap.outbox, "Kicks"), `exec=${JSON.stringify(cap.exec)} text="${cap.outbox}"`);
  }
  // H) FINGERPRINT: o cérebro repete o MESMO draft inválido -> detecta, NÃO gasta as 8 tentativas, RECUPERA
  //    contextual (busca c/ itens -> lista aterrada), e o texto genérico NUNCA aparece no outbox.
  {
    const c = conv(); await c.seed();
    const uH = U("search_stock", { caps: ["stock_search"], subject: "vehicle_type", subjectValue: "suv", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "quero um suv" }] });
    const cap = await c.t("quero um suv automatico", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "stock_search" && o.ok) ? finU([], [reply], "reply", uH) /* draft VAZIO repetido -> mesmo deny */ : qU({ tool: "stock_search", input: { tipo: "suv", cambio: "automatic" } } as CentralQueryCall, uH));
    // Fase 1 (LLM-first): num turno de LISTAGEM a LLM ganha retries EXTRAS (bounded, LIST_MONEY_RETRY_CAP) para tentar listar
    // antes de recuperar — então usa mais passos que antes, mas ainda NÃO gasta todos os 8 (teto). Recupera com repeated_deny.
    check("[H] deny repetido em listagem -> retries bounded, NÃO gasta todos os passos (brainSteps<=6)", cap.committed && cap.brainSteps <= 6, `brainSteps=${cap.brainSteps} src=${cap.src}`);
    check("[H] recuperação contextual: lista aterrada, SEM texto genérico no outbox", has(cap.outbox, "Kicks") && !/nao consegui confirmar|reformul/.test(norm(cap.outbox)) && (cap.recoveryReason ?? "").includes("repeated_deny"), `text="${cap.outbox}" reason=${cap.recoveryReason}`);
  }
  // I) Invariante de foto (audit Codex CTWA #2) vs. P0-2: o cérebro propõe mídia SEM understanding (step malformado) -> a
  //    proposta CRUA do cérebro é rejeitada (P0-2: fromBrain=false), MAS o alvo está resolvido (Onix SELECIONADO) e o lead
  //    pediu foto explicitamente, então o ENGINE resolve as fotos do alvo e envia a mídia ATERRADA (src=deterministic_photo,
  //    verificada por vehicle_photos_resolve + targetAcceptsKey). O envio vem do grounding do engine, não do palpite do
  //    cérebro — recuperação robusta. Codex: alvo resolvido por seleção + pedido explícito + photoIds>0 => DEVE enviar.
  //    (A trava P0-2 p/ alvo AMBÍGUO/ERRADO segue coberta em [J] carro errado e [L] variantes sem seleção.)
  {
    const c = conv({ ...sel(ONIX) }); await c.seed();
    const noU = (): AgentBrainStep => ({ kind: "final", decision: { reasonCode: "send_photos", reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts: [txt("Aqui estão as fotos:")] } }, proposedEffects: [reply, mediaEff(ONIX)], memoryMutations: [], stateMutations: [] } as AgentBrainDecision });
    const cap = await c.t("me mande fotos do Onix", "ambiguous", () => noU());
    check("[I] cérebro sem understanding: proposta crua rejeitada, mas engine ATERRA e envia a foto do alvo resolvido (Onix)", cap.hasMedia && cap.mediaKey === ONIX.vehicleKey && cap.src === "deterministic_photo" && !cap.fromBrain, `media=${cap.hasMedia} mediaKey=${cap.mediaKey} fromBrain=${cap.fromBrain} src=${cap.src}`);
  }
  // O) P0-2: "gostei das fotos" (menção, não pedido) com understanding smalltalk -> ZERO mídia (mesmo se o cérebro errar).
  {
    const c = conv({ ...sel(ONIX) }); await c.seed();
    const uO = U("smalltalk", { evidence: [{ quote: "gostei das fotos" }] });
    const cap = await c.t("gostei das fotos", "ambiguous", [finU([txt("Que bom que gostou! Quer seguir com as condições?")], [reply], "reply", uO)]);
    check("[O] P0-2: 'gostei das fotos' (menção) -> ZERO mídia", cap.committed && !cap.hasMedia, `media=${cap.hasMedia}`);
  }
  // U) P0-2/P1: understanding request_photos mas evidence do send_photos é "oi" (não menciona foto) -> NÃO autoriza. ZERO mídia.
  {
    const c = conv({ ...sel(ONIX) }); await c.seed();
    const uU = U("request_photos", { caps: ["send_photos"], subject: "selected_vehicle", subjectSource: "memory", evidence: [{ capability: "send_photos", quote: "oi" }] });
    const cap = await c.t("oi, quero saber sobre o carro", "ambiguous", [finU([txt("Aqui as fotos:")], [reply, mediaEff(ONIX)], "send_photos", uU), finU([txt("Claro! O que você quer saber?")], [reply], "reply", uU)]);
    check("[U] P1: evidence de send_photos que NÃO menciona foto ('oi') não autoriza -> ZERO mídia", !cap.hasMedia, `media=${cap.hasMedia}`);
  }
  // V) P1 (trava do assunto): passo1 search_stock (evidência "tem suv"); passo2 tenta virar request_photos SEM evidência
  //    nova de foto (mesma quote) + send_media -> a trava mantém search_stock -> mídia REJEITADA. ZERO mídia.
  {
    const c = conv({ ...sel(ONIX) }); await c.seed();
    const uV1 = U("search_stock", { caps: ["stock_search"], subject: "vehicle_type", subjectValue: "suv", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "tem suv" }] });
    const uV2 = U("request_photos", { caps: ["send_photos"], subject: "selected_vehicle", subjectSource: "memory", evidence: [{ capability: "send_photos", quote: "tem suv" }] });   // MESMA quote, sem evidência nova de foto
    let n = 0;
    const cap = await c.t("tem suv?", "ambiguous", (_f, obs) => { n++; if (obs.some((o) => o.tool === "stock_search" && o.ok)) return finU([txt("Aqui as fotos:")], [reply, mediaEff(ONIX)], "send_photos", uV2); return qU({ tool: "stock_search", input: { tipo: "suv" } } as CentralQueryCall, uV1); });
    check("[V] P1: troca arbitrária search_stock->request_photos sem evidência nova -> ZERO mídia (trava do assunto)", !cap.hasMedia, `media=${cap.hasMedia} intent=${cap.primaryIntent}`);
  }

  // ── AUTORIZAÇÃO TIPADA POR TOOL (P0-2, 2ª auditoria) ──────────────────────────────────────────────────────────
  // W) smalltalk + evidence "oi" tentando stock_search -> tool NÃO executa.
  {
    const c = conv(); await c.seed();
    const uW = U("smalltalk", { evidence: [{ quote: "oi" }] });
    const cap = await c.t("oi, tudo bem?", "ambiguous", (_f, obs) => obs.length > 0 ? finU([txt("Tudo ótimo! Como posso ajudar?")], [reply], "reply", uW) : qU({ tool: "stock_search", input: { tipo: "suv" } } as CentralQueryCall, uW));
    check("[W] P0-2: smalltalk (evidence 'oi') NÃO autoriza stock_search", cap.committed && !cap.exec.includes("stock_search"), `exec=${JSON.stringify(cap.exec)}`);
  }
  // X) smalltalk + evidence "oi" tentando vehicle_photos_resolve -> tool NÃO executa (cérebro adversarial).
  {
    const c = conv({ ...sel(ONIX) }); await c.seed();
    const uX = U("smalltalk", { evidence: [{ quote: "oi" }] });
    const cap = await c.t("oi", "ambiguous", (_f, obs) => obs.length > 0 ? finU([txt("Oi! Como posso ajudar?")], [reply], "reply", uX) : photoResolve(ONIX, uX));
    check("[X] P0-2: smalltalk (evidence 'oi') NÃO autoriza vehicle_photos_resolve, ZERO mídia", cap.committed && !cap.exec.includes("vehicle_photos_resolve") && !cap.hasMedia, `exec=${JSON.stringify(cap.exec)} media=${cap.hasMedia}`);
  }
  // Y) smalltalk propondo select_vehicle_focus SEM capability select/evidência -> foco NÃO muda (descartado).
  {
    const c = conv({ ...offerCtx([KICKS1]) }); await c.seed();
    const uY = U("smalltalk", { evidence: [{ quote: "que legal" }] });
    const cap = await c.t("que legal", "ambiguous", [finUMut([txt("Que bom!")], "reply", uY, [selMut(KICKS1)])]);
    check("[Y] P0-2: select_vehicle_focus sem cap select/evidência é DESCARTADO -> foco não muda", cap.committed && cap.selectedKey == null, `sel=${cap.selectedKey}`);
  }
  // Z) "fotos do Kicks" + understanding.subjectValue=Onix (CONFLITO com o modelo escrito) -> entendimento inválido, ZERO mídia.
  {
    const c = conv({ ...sel(ONIX), ...offerCtx([KICKS_A]) }); await c.seed();
    const uZ = U("request_photos", { caps: ["send_photos"], subject: "explicit_model", subjectValue: "Onix", subjectSource: "inference", evidence: [{ capability: "send_photos", quote: "fotos do Kicks" }] });
    const cap = await c.t("me manda as fotos do Kicks", "ambiguous", [finU([txt("Aqui:")], [reply, mediaEff(ONIX)], "send_photos", uZ), finU([txt("Aqui:")], [reply, mediaEff(ONIX)], "send_photos", uZ)]);
    check("[Z] P0-1: subjectValue(Onix) conflita com o modelo escrito(Kicks) -> inválido, ZERO mídia", cap.committed && !cap.hasMedia, `media=${cap.hasMedia} mediaKey=${cap.mediaKey}`);
  }
  // AA) typo "kiks" + inference Kicks + stock_search CONFIRMA Kicks -> autorizado (busca executa, sem mídia).
  {
    const c = conv(); await c.seed();
    const uAA = U("search_stock", { caps: ["stock_search"], subject: "explicit_model", subjectValue: "Kicks", subjectSource: "inference", evidence: [{ capability: "stock_search", quote: "kiks tem" }] });
    const cap = await c.t("e o kiks tem?", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "stock_search" && o.ok) ? finU([txt("Temos:"), offer([KICKS1, KICKS2])], [reply], "offer", uAA) : qU({ tool: "stock_search", input: { modelo: "kicks", tipo: "suv" } } as CentralQueryCall, uAA));
    check("[AA] P0-1/P0-2: typo inferido + cap stock_search + evidência -> busca EXECUTA (inferência confirmada)", cap.committed && cap.exec.includes("stock_search") && !cap.hasMedia, `exec=${JSON.stringify(cap.exec)}`);
  }
  // P4) request_photos com cap+evidência corretas -> photo tool EXECUTA (positivo).
  {
    const c = conv({ ...sel(ONIX) }); await c.seed();
    const uP4 = U("request_photos", { caps: ["send_photos"], subject: "selected_vehicle", subjectSource: "memory", evidence: [{ capability: "send_photos", quote: "me manda as fotos" }] });
    const cap = await c.t("me manda as fotos dele", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok) ? finU([txt("Aqui:")], [reply, mediaEff(ONIX)], "send_photos", uP4) : photoResolve(ONIX, uP4));
    check("[P4] positivo: request_photos com cap send_photos+evidência -> photo tool executa + mídia", cap.exec.includes("vehicle_photos_resolve") && cap.hasMedia && cap.mediaKey === ONIX.vehicleKey, `exec=${JSON.stringify(cap.exec)} media=${cap.hasMedia}`);
  }
  // P6) vehicle_detail com cap+evidência -> details EXECUTA (positivo).
  {
    const c = conv({ ...sel(ONIX), ...offerCtx([ONIX]) }); await c.seed();
    const uP6 = U("vehicle_detail", { caps: ["vehicle_details"], subject: "selected_vehicle", subjectSource: "memory", evidence: [{ capability: "vehicle_details", quote: "quantos km" }] });
    const cap = await c.t("quantos km ele tem?", "asks_vehicle_detail", (_f, obs) => obs.some((o) => o.tool === "vehicle_details" && o.ok) ? finU([txt("O Onix tem"), vref(ONIX, "km"), txt("km.")], [reply], "reply", uP6) : qU({ tool: "vehicle_details", input: { vehicleKey: ONIX.vehicleKey } } as CentralQueryCall, uP6));
    check("[P6] positivo: vehicle_detail com cap vehicle_details+evidência -> details executa + km real", cap.exec.includes("vehicle_details") && has(cap.outbox, "132.623"), `exec=${JSON.stringify(cap.exec)} text="${cap.outbox}"`);
  }

  // ── IDENTIDADE EXATA DE MODELO (P0, 4ª auditoria) — Onix≠Onix Plus, HB20≠HB20S, C3≠C3 Aircross; sem substring ──────
  const uPhoto = (subjectValue: string, quote: string): TurnUnderstanding => U("request_photos", { caps: ["send_photos"], subject: "explicit_model", subjectValue, subjectSource: "current_turn", evidence: [{ capability: "send_photos", quote }] });
  // NEGATIVO: cérebro tenta enviar a foto de `wrong` (modelo distinto do pedido) -> REJEITADO, ZERO mídia.
  const identNeg = async (name: string, offerVeh: VehicleFact, lead: string, subjectValue: string, quote: string): Promise<void> => {
    const c = conv({ ...offerCtx([offerVeh]) }); await c.seed();
    const u = uPhoto(subjectValue, quote);
    const cap = await c.t(lead, "ambiguous", [finU([txt("Aqui:")], [reply, mediaEff(offerVeh)], "send_photos", u), finU([txt("Aqui:")], [reply, mediaEff(offerVeh)], "send_photos", u)]);
    check(name, cap.committed && !cap.hasMedia, `media=${cap.hasMedia} mediaKey=${cap.mediaKey}`);
  };
  // POSITIVO: modelo com a MESMA identidade canônica -> resolve + envia.
  const identPos = async (name: string, offerVeh: VehicleFact, lead: string, subjectValue: string, quote: string): Promise<void> => {
    const c = conv({ ...offerCtx([offerVeh]) }); await c.seed();
    const u = uPhoto(subjectValue, quote);
    const cap = await c.t(lead, "ambiguous", (_f, obs) => obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok) ? finU([txt("Aqui:")], [reply, mediaEff(offerVeh)], "send_photos", u) : photoResolve(offerVeh, u));
    check(name, cap.hasMedia && cap.mediaKey === offerVeh.vehicleKey, `media=${cap.hasMedia} mediaKey=${cap.mediaKey}`);
  };
  await identNeg("[IdA] 'foto do Onix' + só Onix Plus -> ZERO mídia (Onix≠Onix Plus)", ONIX_PLUS, "me manda foto do Onix", "Onix", "foto do onix");
  await identNeg("[IdB] 'foto do Onix Plus' + só Onix -> ZERO mídia", ONIX, "me manda foto do Onix Plus", "Onix Plus", "foto do onix plus");
  await identNeg("[IdC1] 'foto do HB20' + só HB20S -> ZERO mídia (HB20≠HB20S)", HB20S, "me manda foto do HB20", "HB20", "foto do hb20");
  await identNeg("[IdC2] 'foto do HB20S' + só HB20 -> ZERO mídia", HB20, "me manda foto do HB20S", "HB20S", "foto do hb20s");
  await identNeg("[IdD1] 'foto do C3' + só C3 Aircross -> ZERO mídia (C3≠C3 Aircross)", C3_AIRCROSS, "me manda foto do C3", "C3", "foto do c3");
  await identNeg("[IdD2] 'foto do C3 Aircross' + só C3 -> ZERO mídia", C3, "me manda foto do C3 Aircross", "C3 Aircross", "foto do c3 aircross");
  await identPos("[IdE] 'HB 20' == 'HB20' (formatação) -> resolve + mídia", HB20, "me manda foto do HB 20", "HB 20", "foto do hb 20");
  await identPos("[IdF1] 'Chevrolet Onix' casa {marca:Chevrolet,modelo:Onix} -> mídia", ONIX, "me manda foto do Chevrolet Onix", "Chevrolet Onix", "foto do chevrolet onix");
  await identNeg("[IdF2] 'Chevrolet Onix' NÃO casa Onix Plus -> ZERO mídia", ONIX_PLUS, "me manda foto do Chevrolet Onix", "Chevrolet Onix", "foto do chevrolet onix");

  console.log(`\n== F2.23: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
