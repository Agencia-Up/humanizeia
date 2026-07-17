// ============================================================================
// F2.22 — ROTEAMENTO POR DOMÍNIO (missão P0): cada policy só atua no domínio certo. Uma pergunta INSTITUCIONAL não pode
// ser barrada por policy de veículo/funil, e institucional resolvido NUNCA vira technical_fallback. Mas veículo/estoque/
// foto continuam exigindo suas tools; conversa normal e financiamento sem entrada não travam.
//   npx tsx tests/run-f2-22-domain-policy-routing.ts
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
import type { AgentBrainStep, AgentBrainDecision, CentralQueryCall, AgentBrainPort, AgentToolObservation, TurnFrame } from "../src/domain/agent-brain.ts";
import { deriveFallbackUnderstanding } from "../src/engine/turn-understanding.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-04T22:00:00.000Z", SHA = "sha-22";
const ADDR = "Avenida Charles Schnneider, 1700, Jardim das Bandeiras, Taubaté SP";
const HOURS = "Segunda a Sábado das 9h às 19h";

const ONIX: VehicleFact = { vehicleKey: "revendamais:2000002", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 54990, km: 132623, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const RENE: VehicleFact = { vehicleKey: "revendamais:2000004", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 89990, km: 70000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const STOCK = [ONIX, RENE];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (address: string | null, hours: string | null): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address, hours, unit: "Icom Motors", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") { const inp = call.input as { tipo?: string; modelo?: string }; let items = STOCK.slice(); if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo); if (inp.modelo) items = items.filter((v) => normalizeText(v.modelo).includes(normalizeText(inp.modelo!))); return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  throw new Error("tool " + call.tool);
};
const normalizeText = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const txt = (content: string): ResponsePart => ({ type: "text", content });
const vref = (v: VehicleFact, field: "km" | "cor"): ResponsePart => ({ type: "vehicle_ref", vehicleKey: v.vehicleKey, field });
const offer = (vs: VehicleFact[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: vs.map((v) => v.vehicleKey) });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const mediaEff = (v: VehicleFact): ProposedEffectPlan => ({ kind: "send_media", planId: "m", order: 1, vehicleKey: v.vehicleKey, photoIds: ["p1", "p2"], onSuccess: [] } as ProposedEffectPlan);
const q = (call: CentralQueryCall): AgentBrainStep => ({ kind: "query", call });
function fin(parts: ResponsePart[], effects?: ProposedEffectPlan[], reasonCode = "reply"): AgentBrainStep {
  return { kind: "final", decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects ?? [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}

type Cap = { outbox: string; src: string; degraded: boolean; committed: boolean; hasMedia: boolean; exec: string[]; slots: Record<string, string>; objSlot: string | null; policyFeedback: string[] };
const has = (s: string, n: string): boolean => normalizeText(s).includes(normalizeText(n));
const slotSummary = (state: unknown): Record<string, string> => { const out: Record<string, string> = {}; const slots = (state as { slots?: Record<string, { status?: string; value?: unknown }> })?.slots ?? {}; for (const k of Object.keys(slots)) { const s = slots[k]; if (s?.status && s.status !== "unknown") out[k] = `${s.status}:${JSON.stringify(s.value ?? null)}`; } return out; };

async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: UnderstandingBrain, preparer: RelPreparer, businessInfo: TenantBusinessInfoSource, convId: string, seq: number, lead: string, relation: TurnRelation, script: AgentBrainStep[] | BrainResponder): Promise<Cap> {
  executed.length = 0; preparer.relation = relation;
  const asksInstitutional = /loja|onde\s+fica|endere[cç]|hor[aá]|atendimento/i.test(lead);
  const businessTopic = /hor[aá]|atendimento/i.test(lead) ? "hours" : "address";
  if (typeof script === "function") {
    const original = script;
    brain.setResponder((frame, observations, stepIndex) => {
      if (asksInstitutional && !observations.some((observation) => observation.tool === "tenant_business_info")) {
        return q({ tool: "tenant_business_info", input: { topic: businessTopic as "address" | "hours" } });
      }
      return original(frame, observations, stepIndex);
    });
  } else {
    brain.setTurnScript(asksInstitutional && script[0]?.kind !== "query" ? [q({ tool: "tenant_business_info", input: { topic: businessTopic as "address" | "hours" } }), ...script] : script);
  }
  await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t${seq}`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo, contextPreparer: preparer,
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
    degraded: r.status === "committed" && r.degraded, committed: r.status === "committed", hasMedia: outbox.some((o) => o.kind === "send_media"),
    exec: execSnap, slots: slotSummary(after), objSlot: (after as { currentObjective?: { slot?: string } } | undefined)?.currentObjective?.slot ?? null,
    policyFeedback: r.status === "committed" ? [...r.policyFeedback] : [],
  };
}
// Anexa understanding DERIVADO do lead (trusted) aos steps sem ele — F2.22 testa roteamento/completude, não o gate P0-2.
class UnderstandingBrain implements AgentBrainPort {
  constructor(private readonly inner: ScriptedAgentBrain) {}
  setResponder(fn: BrainResponder): void { this.inner.setResponder(fn); }
  setTurnScript(steps: AgentBrainStep[]): void { this.inner.setTurnScript(steps); }
  async proposeNextStep(frame: TurnFrame, obs: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    const step = await this.inner.proposeNextStep(frame, obs);
    if (step.understanding) return step;
    let u = deriveFallbackUnderstanding(frame.block, frame.signals, extractor);
    // Os scripts historicos nao carregavam entendimento. Para refletir o
    // contrato do cerebro real, uma intencao explicita de financiamento deve
    // declarar financing em vez de other.
    if (/\bfinanci/i.test(frame.block)) u = { ...u, primaryIntent: "financing" };
    if (!u.evidence || u.evidence.length === 0) { const w = frame.block.trim().split(/\s+/).slice(0, 2).join(" ") || frame.block.slice(0, 3); u = { ...u, evidence: [{ quote: w }] }; }
    return { ...step, understanding: u };
  }
}
let seq0 = 0;
function conv(businessInfo: TenantBusinessInfoSource, seedState?: Partial<ConversationState>) {
  const brain = new UnderstandingBrain(new ScriptedAgentBrain()); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `conv-${seq0++}`;
  let s = 0;
  const seed = async (): Promise<void> => { if (!seedState) return; const base = { ...createInitialState({ conversationId: id, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }), ...seedState } as ConversationState; const uow = persistence.begin(); uow.casState(id, 0, base); if (!(await uow.commit()).ok) throw new Error("seed_failed"); };
  const t = (lead: string, relation: TurnRelation, script: AgentBrainStep[] | BrainResponder): Promise<Cap> => turn(persistence, clock, brain, preparer, businessInfo, id, ++s, lead, relation, script);
  return { seed, t };
}
const known = (value: unknown) => ({ status: "known" as const, value, confidence: 1, updatedAt: NOW });
const finEmpty = (): AgentBrainStep => ({ kind: "final", decision: { reasonCode: "reply", reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts: [] } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision });
const initialSlots = createInitialState({ conversationId: "x", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }).slots;
const selectedOnix = { vehicleContext: { selected: { kind: "vehicle" as const, key: ONIX.vehicleKey, label: "Chevrolet Onix 2014" } } } as Partial<ConversationState>;
const visitSeed = { ...selectedOnix, slots: { ...initialSlots, interesseVisita: known(true), diaHorario: known("segunda") } } as Partial<ConversationState>;
const bSeed = { ...selectedOnix, slots: { ...initialSlots, interesseVisita: known(true) }, recentTurns: [{ role: "agent" as const, text: "Qual dia e horário ficam melhores para sua visita?", at: NOW }] } as Partial<ConversationState>;

async function main(): Promise<void> {
  console.log("== F2.22 Roteamento por domínio (institucional × veículo/funil) ==");

  // A) INSTITUCIONAL PURO passa (endereço, sem fallback, sem vehicle_details) — resposta institucional-pura.
  {
    const c = conv(makeBI(ADDR, HOURS), visitSeed); await c.seed();
    const aFin = fin([txt(`Claro! A loja fica na ${ADDR}. Posso te ajudar em mais alguma coisa?`)]);
    const cap = await c.t("aonde fica a loja?", "ambiguous", [q({ tool: "tenant_business_info", input: { topic: "address" } }), aFin]);
    check("[A] institucional PURO -> endereço, sem fallback, sem vehicle_details/stock", cap.committed && !cap.degraded && has(cap.outbox, "Charles Schnneider") && !cap.exec.includes("vehicle_details") && !cap.exec.includes("stock_search"), `src=${cap.src} exec=${JSON.stringify(cap.exec)}`);
    check("[A] sem feedback de veículo/funil", !cap.policyFeedback.some((f) => /vehicle_details|slot|km|cor/i.test(f)), JSON.stringify(cap.policyFeedback));
  }
  // A2) INSTITUCIONAL nomeando o carro LEMBRADO (grounding de memória) — sem atributo, sem reask de slot -> passa.
  {
    const c = conv(makeBI(ADDR, HOURS), selectedOnix); await c.seed();
    const a2 = fin([txt(`Claro! A loja fica na ${ADDR}, pertinho de onde você viu o Onix. Posso ajudar?`)]);
    const cap = await c.t("aonde fica a loja?", "ambiguous", [q({ tool: "tenant_business_info", input: { topic: "address" } }), a2]);
    check("[A2] institucional NOMEANDO o carro lembrado passa (memória aterra o nome)", cap.committed && !cap.degraded && has(cap.outbox, "Charles Schnneider") && has(cap.outbox, "Onix"), `src=${cap.src} text="${cap.outbox}"`);
  }
  // B) MISTO: institucional + ATRIBUTO de veículo. "ele é automático" (Onix é Manual) SEM vehicle_details -> BLOQUEADO;
  //    institucional continua respondido (não vira technical_fallback). Atributo inventado nunca passa por ser institucional.
  {
    const c = conv(makeBI(ADDR, HOURS), selectedOnix); await c.seed();
    const cap = await c.t("aonde fica a loja e ele é automático?", "asks_vehicle_detail", (_frame, obs) => {
      if (obs.some((o) => !o.ok && o.error.code === "FINAL_AUTHORSHIP_REQUIRED")) return fin([txt(`A loja fica na ${ADDR}.`)]);
      return fin([txt(`A loja fica na ${ADDR}. Ele é automático.`)]);
    });
    check("[B] atributo inventado (automático) BLOQUEADO mesmo em msg institucional", cap.committed && !has(cap.outbox, "automatic"), `text="${cap.outbox}"`);
    check("[B] institucional ainda respondido (endereço), sem technical_fallback", has(cap.outbox, "Charles Schnneider") && !cap.degraded, `src=${cap.src}`);
  }
  // C) MISTO: institucional + km. Exige vehicle_details do selecionado; responde horário + km REAL.
  {
    const c = conv(makeBI(ADDR, HOURS), selectedOnix); await c.seed();
    const cap = await c.t("qual horário e quantos km ele tem?", "asks_vehicle_detail", (_f, obs) => obs.some((o) => o.tool === "vehicle_details" && o.ok) ? fin([txt(`Atendemos das 9h às 19h. O Onix tem`), vref(ONIX, "km"), txt("km rodados.")]) : q({ tool: "vehicle_details", input: { vehicleKey: ONIX.vehicleKey } }));
    check("[C] institucional + km: horário + vehicle_details + km real (132.623)", cap.committed && !cap.degraded && has(cap.outbox, "9h") && cap.exec.includes("vehicle_details") && has(cap.outbox, "132.623"), `exec=${JSON.stringify(cap.exec)} text="${cap.outbox}"`);
  }
  // D) MISTO: institucional + disponibilidade de veículo NÃO ATERRADO no turno (Renegade, do catálogo mas sem
  //    stock_search/seleção). Afirmar disponibilidade sem grounding é BLOQUEADO (força stock_search); endereço respondido.
  //    NOTA: modelo FORA do catálogo (ex.: "Corolla") não é capturado pelo CatalogClaimExtractor — gap GERAL pré-existente,
  //    não do roteamento por domínio (registrado no handoff). Aqui usamos um modelo do catálogo não-aterrado.
  {
    const c = conv(makeBI(ADDR, HOURS)); await c.seed();
    const cap = await c.t("onde fica a loja e o Renegade 2019 está disponível?", "ambiguous", (_frame, obs) => {
      if (obs.some((o) => !o.ok && o.error.code === "FINAL_AUTHORSHIP_REQUIRED")) return fin([txt(`A loja fica na ${ADDR}. Ainda preciso consultar a disponibilidade desse veículo.`)]);
      return fin([txt(`A loja fica na ${ADDR}. O Renegade 2019 está disponível sim!`)]);
    });
    check("[D] disponibilidade de veículo não-aterrado BLOQUEADA mesmo em msg institucional", cap.committed && !has(cap.outbox, "renegade"), `text="${cap.outbox}"`);
    check("[D] endereço respondido, sem technical_fallback", has(cap.outbox, "Charles Schnneider") && !cap.degraded, `src=${cap.src}`);
  }
  // E) MISTO: institucional + FOTO. Endereço + send_media (foto exige mídia, não promete sem enviar).
  {
    const c = conv(makeBI(ADDR, HOURS), selectedOnix); await c.seed();
    const cap = await c.t("onde fica a loja e me manda foto dele", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok) ? fin([txt(`A loja fica na ${ADDR}. Aqui estão as fotos! 😊`)], [reply, mediaEff(ONIX)], "send_vehicle_photos") : q({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: ONIX.vehicleKey } } }));
    check("[E] institucional + foto: endereço + vehicle_photos_resolve + send_media", cap.committed && has(cap.outbox, "Charles Schnneider") && cap.exec.includes("vehicle_photos_resolve") && cap.hasMedia, `exec=${JSON.stringify(cap.exec)} media=${cap.hasMedia}`);
  }
  // F) AMBOS institucionais AUSENTES (NOT_CONFIGURED) -> fatos da source; a LLM redige a ausência honesta.
  {
    const c = conv(makeBI(null, null)); await c.seed();
    const cap = await c.t("onde fica e qual horário?", "ambiguous", (_frame, obs) => obs.some((o) => !o.ok && o.error.code === "FINAL_AUTHORSHIP_REQUIRED")
      ? fin([txt("O endereço e o horário da loja não estão configurados nas informações disponíveis agora.")])
      : finEmpty());
    check("[F] ambos ausentes -> LLM honesta com os fatos, sem technical_fallback", cap.committed && !cap.degraded && cap.src === "brain_retry" && /nao tenho|configurad/i.test(normalizeText(cap.outbox)), `src=${cap.src} text="${cap.outbox}"`);
  }
  // G) CONTATO (instagram) — não é topic da tool: honesto, sem technical_fallback.
  {
    const c = conv(makeBI(ADDR, HOURS)); await c.seed();
    const cap = await c.t("qual o instagram de vocês?", "ambiguous", (_frame, obs) => obs.some((o) => !o.ok && o.error.code === "FINAL_AUTHORSHIP_REQUIRED")
      ? fin([txt("Não tenho o Instagram confirmado nas informações disponíveis agora.")])
      : finEmpty());
    check("[G] contato -> LLM honesta, sem technical_fallback", cap.committed && !cap.degraded && cap.src === "brain_retry" && /contato|confirmo|instagram/i.test(normalizeText(cap.outbox)), `src=${cap.src} text="${cap.outbox}"`);
  }
  // H) VEÍCULO puro AINDA exige vehicle_details: "ele tem quantos km?".
  {
    const c = conv(makeBI(ADDR, HOURS), selectedOnix); await c.seed();
    const cap = await c.t("ele tem quantos km?", "asks_vehicle_detail", (_f, obs) => obs.some((o) => o.tool === "vehicle_details" && o.ok) ? fin([txt("O Onix tem"), vref(ONIX, "km"), txt("km rodados.")]) : q({ tool: "vehicle_details", input: { vehicleKey: ONIX.vehicleKey } }));
    check("[H] atributo de veículo puro AINDA exige vehicle_details + km real", cap.committed && cap.exec.includes("vehicle_details") && has(cap.outbox, "132.623"), `exec=${JSON.stringify(cap.exec)}`);
  }
  // I) ESTOQUE puro AINDA exige stock_search: "tem Onix?".
  {
    const c = conv(makeBI(ADDR, HOURS)); await c.seed();
    const cap = await c.t("tem Onix?", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "stock_search" && o.ok) ? fin([txt("Temos sim:"), offer([ONIX]), txt("Quer ver as fotos?")]) : q({ tool: "stock_search", input: { modelo: "onix" } }));
    check("[I] disponibilidade pura AINDA exige stock_search antes de citar", cap.committed && cap.exec.includes("stock_search") && has(cap.outbox, "Onix"), `exec=${JSON.stringify(cap.exec)}`);
  }
  // J) CONVERSA NORMAL não bloqueia: "obrigado".
  {
    const c = conv(makeBI(ADDR, HOURS)); await c.seed();
    const cap = await c.t("obrigado", "ambiguous", [fin([txt("Imagina, Douglas! Qualquer coisa é só chamar. 😊")])]);
    check("[J] 'obrigado' -> resposta natural, sem tool obrigatória, sem fallback", cap.committed && !cap.degraded && cap.exec.length === 0, `src=${cap.src} exec=${JSON.stringify(cap.exec)}`);
  }
  // K) FINANCIAMENTO sem entrada não encerra + reperguntar nome CONHECIDO num turno de FUNIL continua barrado (não é institucional).
  {
    const c = conv(makeBI(ADDR, HOURS)); await c.seed();
    const cap = await c.t("não tenho entrada, mas quero financiar", "ambiguous", [fin([txt("Sem problema! Dá pra fazer com entrada zero. Qual parcela mensal fica confortável pra você?")])]);
    check("[K] financiamento sem entrada -> acolhe e continua, sem encerrar/degradar", cap.committed && !cap.degraded && has(cap.outbox, "entrada zero") && /financiamento/.test(cap.slots.formaPagamento ?? ""), `slots=${JSON.stringify(cap.slots)} text="${cap.outbox}"`);
  }
  // L) ⭐RD1-2: não reperguntar slot CONHECIDO é ADVISORY (knownName). A LLM advertida usa o nome e avança; o engine
  //    ENTREGA (brain_final). O adversarial (LLM repergunta) é coberto pelos smokes.
  {
    const c = conv(makeBI(ADDR, HOURS), { slots: { ...initialSlots, nome: known("Douglas") } } as Partial<ConversationState>); await c.seed();
    const cap = await c.t("beleza", "ambiguous", [fin([txt("Que bom, Douglas! Quer ver mais alguma opção?")])]);
    check("[L] nome conhecido: condução entregue (brain_final), sem reperguntar nome", !/qual.{0,15}(seu\s+)?nome/i.test(cap.outbox) && cap.committed, `text="${cap.outbox}"`);
  }
  // ── COMPLETUDE DO TURNO (prompt-first): a resposta não pode IGNORAR um pedido explícito ──────────────────────────
  // M) HORÁRIO pedido, resposta só ENDEREÇO (ignora horário) -> REJEITADA (feedback) e o RETRY responde o horário.
  //    O 1º final é pré-emptado pela resolução institucional; o 2º só-endereço é NEGADO pela completude; o 3º acerta.
  {
    const c = conv(makeBI(ADDR, HOURS)); await c.seed();
    let n = 0;
    const cap = await c.t("qual o horário de vocês?", "ambiguous", () => { n++; return n >= 3 ? fin([txt("Atendemos de segunda a sábado, das 9h às 19h!")]) : fin([txt(`Nossa loja fica na ${ADDR}.`)]); });
    check("[M] horário pedido: resposta só-endereço é REJEITADA e o retry responde o HORÁRIO", cap.committed && !cap.degraded && has(cap.outbox, "9h") && !has(cap.outbox, "Charles"), `src=${cap.src} text="${cap.outbox}"`);
    check("[M] feedback de completude citou o tópico pedido (horário)", cap.policyFeedback.some((f) => /horario/.test(normalizeText(f))), JSON.stringify(cap.policyFeedback));
  }
  // N) HORÁRIO respondido corretamente passa de primeira (guarda não over-fire quando o pedido é atendido).
  {
    const c = conv(makeBI(ADDR, HOURS)); await c.seed();
    const nFin = fin([txt("Atendemos de segunda a sábado, das 9h às 19h! 😊")]);
    const cap = await c.t("qual o horário?", "ambiguous", [nFin, nFin, nFin]);
    check("[N] horário respondido -> passa sem deny (completude satisfeita)", cap.committed && !cap.degraded && has(cap.outbox, "9h") && !cap.policyFeedback.some((f) => /horario/.test(normalizeText(f))), `src=${cap.src} fb=${JSON.stringify(cap.policyFeedback)}`);
  }
  // O) FOTO pedida: a não-resposta é REJEITADA e o Onix SELECIONADO é resolvido pelo executor factual.
  //    A LLM recebe os photoIds aterrados e é quem redige/propoe o send_media no passe final.
  //    (A ausência honesta LEGÍTIMA — alvo sem fotos — segue honrada; coberto em F2.33 A-7.)
  {
    const c = conv(makeBI(ADDR, HOURS), selectedOnix); await c.seed();
    let n = 0;
    const cap = await c.t("me manda foto do Onix", "ambiguous", (_frame, obs) => {
      if (obs.some((o) => !o.ok && o.error.code === "FINAL_AUTHORSHIP_REQUIRED") && obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok)) {
        return fin([txt("Aqui estão as fotos do Onix!")], [reply, mediaEff(ONIX)], "send_vehicle_photos");
      }
      n++;
      return n >= 2 ? fin([txt("Poxa, não localizei as fotos do Onix agora, mas confirmo com a equipe e já te envio!")]) : fin([txt("Beleza! Deixa eu providenciar isso pra você.")]);
    });
    check("[O] executor resolve fotos e a LLM autora o send_media", cap.committed && cap.hasMedia && cap.src === "brain_retry" && cap.policyFeedback.some((f) => /foto/.test(normalizeText(f))), `src=${cap.src} text="${cap.outbox}" media=${cap.hasMedia} fb=${JSON.stringify(cap.policyFeedback)}`);
  }
  // P) FOTO pura com send_media satisfaz a completude (passa) — não força ausência honesta quando há mídia.
  {
    const c = conv(makeBI(ADDR, HOURS), selectedOnix); await c.seed();
    const cap = await c.t("me manda as fotos do Onix", "ambiguous", (_f, obs) => obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok) ? fin([txt("Aqui estão as fotos do Onix! 😊")], [reply, mediaEff(ONIX)], "send_vehicle_photos") : q({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: ONIX.vehicleKey } } }));
    check("[P] foto pura com send_media -> completude satisfeita (passa)", cap.committed && cap.hasMedia && !cap.degraded && !cap.policyFeedback.some((f) => /foto/.test(normalizeText(f))), `media=${cap.hasMedia} fb=${JSON.stringify(cap.policyFeedback)}`);
  }

  console.log(`\n== F2.22: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
