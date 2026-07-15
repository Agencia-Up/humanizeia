// ============================================================================
// F2.24 — P0 "bloco-do-lead" + RESOLUÇÃO ÚNICA de veículo + ANTI-REPETIÇÃO.
//   1) TRAVA ANTI-PARCIAL: mensagem nova durante o processamento -> turno SUPERSEDED (não despacha); bloco starved
//      processa mesmo assim (anti forever-lock). + presença (digitando/gravando) segura o debounce.
//   2) RESOLUÇÃO ÚNICA: "Me mande fotos do segundo" (ordinal na última lista) -> send_media do item EXATO (nunca
//      "de qual carro?"); sem lista/fora de faixa -> pergunta qual. Dedup de select_vehicle_focus.
//   3) ANTI-REPETIÇÃO: nome/slot já conhecido -> não repergunta (feedback ao cérebro).
// Engine central REAL, AgentBrain SCRIPTADO, effects OFF.  npx tsx tests/run-f2-24-block-await-single-resolution.ts
// ============================================================================
import { runCentralConversationTurn, canonicalizeSelectMutations, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { shouldSupersedeStaleBlock, isConversationSettled, isLeadPresenceActive } from "../src/engine/debounce-policy.ts";
import { authorizesPhotoByResolvedOrdinal, type TargetResolution } from "../src/engine/turn-understanding.ts";
import { detectQuestionRepetition } from "../src/engine/question-repetition.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createInitialState, type ConversationState } from "../src/domain/conversation-state.ts";
import type { DecisionMutation } from "../src/domain/decision.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, CentralQueryCall, TurnUnderstanding, TurnCapability, TurnSubjectKind, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact, RememberedVehicleIdentity } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-05T12:00:00.000Z", SHA = "sha-24";
const nowMs = Date.parse(NOW);

// ── Estoque de teste: dois JEEP Compass (2017 e 2019) = o cenário real do incidente + um Onix p/ rajada. ──
const COMPASS17: VehicleFact = { vehicleKey: "revendamais:7894913", marca: "Jeep", modelo: "Compass", ano: 2017, preco: 79990, km: 95000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const COMPASS19: VehicleFact = { vehicleKey: "revendamais:7894915", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 99990, km: 62000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const ONIX: VehicleFact = { vehicleKey: "revendamais:8187454", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 54990, km: 132623, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const STOCK = [COMPASS17, COMPASS19, ONIX];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  if (call.tool === "stock_search") { const inp = call.input as { modelo?: string }; let items = STOCK.slice(); if (inp.modelo) items = items.filter((v) => v.modelo.toLowerCase().includes(inp.modelo!.toLowerCase())); return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

// ── builders ──
type UOpts = { caps?: TurnCapability[]; subject?: TurnSubjectKind; subjectValue?: string | null; subjectSource?: "current_turn" | "memory" | "inference" | "none"; evidence?: { capability?: TurnCapability; quote: string }[] };
const U = (primaryIntent: PrimaryIntent, o: UOpts = {}): TurnUnderstanding => ({
  primaryIntent, requestedCapabilities: o.caps ?? [], subject: o.subject ?? "none", subjectValue: o.subjectValue ?? null,
  subjectSource: o.subjectSource ?? "none", evidence: o.evidence ?? [], isTopicChange: false, answeredLeadQuestions: [],
});
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const selMut = (v: VehicleFact) => ({ op: "select_vehicle_focus", vehicle: { kind: "vehicle", key: v.vehicleKey, label: `${v.marca} ${v.modelo} ${v.ano}` }, sourceTurnId: "t" });
function finU(parts: ResponsePart[], effects: ProposedEffectPlan[], reasonCode: string, u: TurnUnderstanding, stateMutations: unknown[] = []): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations } as AgentBrainDecision };
}

type Cap = { status: string; outbox: string; src: string; committed: boolean; hasMedia: boolean; mediaKey: string | null; exec: string[]; targetSource: string | null; recoveryReason: string | null; selectedKey: string | null; pendingAfter: number };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, relation: TurnRelation, script: AgentBrainStep[] | BrainResponder, blockAwaitMaxMs?: number): Promise<Cap> {
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
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true, blockAwaitMaxMs,
  });
  const execSnap = executed.map((e) => e.tool);
  const after = (await persistence.load(convId))?.state;
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  const pendingAfter = await persistence.pendingCount(convId);
  return {
    status: r.status,
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", src: r.status === "committed" ? r.responseSource : r.status,
    committed: r.status === "committed", hasMedia: outbox.some((o) => o.kind === "send_media"), mediaKey: r.status === "committed" ? r.resolvedVehicleKey : null,
    exec: execSnap, targetSource: r.status === "committed" ? r.targetResolutionSource : null, recoveryReason: r.status === "committed" ? r.recoveryReason : null,
    selectedKey: (after as { vehicleContext?: { selected?: { key?: string } } } | undefined)?.vehicleContext?.selected?.key ?? null, pendingAfter,
  };
}
let seq0 = 0;
function conv(seedState?: Partial<ConversationState>) {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `conv-${seq0++}`; let s = 0;
  const seed = async (): Promise<void> => { if (!seedState) return; const base = { ...createInitialState({ conversationId: id, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }), ...seedState } as ConversationState; const uow = persistence.begin(); uow.casState(id, 0, base); if (!(await uow.commit()).ok) throw new Error("seed_failed"); };
  const t = (lead: string, relation: TurnRelation, script: AgentBrainStep[] | BrainResponder, blockAwaitMaxMs?: number): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, relation, script, blockAwaitMaxMs);
  return { seed, t, persistence, clock, id };
}
const offerCtx = (vs: VehicleFact[]) => ({ lastRenderedOfferContext: { sourceTurnId: "seed", createdAt: NOW, items: vs.map((v, i) => ({ ordinal: i + 1, vehicleKey: v.vehicleKey, marca: v.marca, modelo: v.modelo, ano: v.ano, preco: v.preco })) } } as Partial<ConversationState>);
const knownSlot = (value: string) => ({ status: "known" as const, value, confidence: 1, updatedAt: NOW });

async function main(): Promise<void> {
  console.log("== F2.24: bloco-do-lead + resolução única + anti-repetição ==");

  // ─────────────────────────────────────────────────────────────────────────
  // PARTE 1 — PURO: política de debounce/anti-parcial/presença
  // ─────────────────────────────────────────────────────────────────────────
  check("[P-supersede-a] msg nova + bloco jovem -> supersede", shouldSupersedeStaleBlock({ newlyPendingCount: 1, blockAgeMs: 3000, maxWaitMs: 20000 }) === true);
  check("[P-supersede-b] msg nova + bloco starved -> NÃO supersede (anti forever-lock)", shouldSupersedeStaleBlock({ newlyPendingCount: 2, blockAgeMs: 25000, maxWaitMs: 20000 }) === false);
  check("[P-supersede-c] sem msg nova -> NÃO supersede (despacha normal)", shouldSupersedeStaleBlock({ newlyPendingCount: 0, blockAgeMs: 3000, maxWaitMs: 20000 }) === false);
  // presença no settled: quieto sem presença -> assenta; presença ativa segura; starved vence a presença.
  check("[P-settled-a] quieto 12s sem presença -> assenta", isConversationSettled({ nowMs, oldestPendingMs: nowMs - 12000, newestPendingMs: nowMs - 12000, debounceMs: 10000, maxWaitMs: 20000 }) === true);
  check("[P-settled-b] quieto 12s MAS digitando -> NÃO assenta (espera o bloco)", isConversationSettled({ nowMs, oldestPendingMs: nowMs - 12000, newestPendingMs: nowMs - 12000, debounceMs: 10000, maxWaitMs: 20000, leadPresenceActive: true }) === false);
  check("[P-settled-c] digitando MAS starved 21s -> assenta (teto vence a presença)", isConversationSettled({ nowMs, oldestPendingMs: nowMs - 21000, newestPendingMs: nowMs - 3000, debounceMs: 10000, maxWaitMs: 20000, leadPresenceActive: true }) === true);
  check("[P-presence-a] composing recente (<15s) -> ativo", isLeadPresenceActive({ nowMs, state: "composing", updatedAtMs: nowMs - 5000 }) === true);
  check("[P-presence-b] recording recente -> ativo", isLeadPresenceActive({ nowMs, state: "recording", updatedAtMs: nowMs - 8000 }) === true);
  check("[P-presence-c] composing EXPIRADO (>15s) -> inativo (lead parou)", isLeadPresenceActive({ nowMs, state: "composing", updatedAtMs: nowMs - 16000 }) === false);
  check("[P-presence-d] paused -> inativo", isLeadPresenceActive({ nowMs, state: "paused", updatedAtMs: nowMs - 1000 }) === false);

  // ─────────────────────────────────────────────────────────────────────────
  // PARTE 2 — PURO: autorização de foto por ordinal resolvido
  // ─────────────────────────────────────────────────────────────────────────
  const ordTarget: TargetResolution = { kind: "resolved", vehicleKey: COMPASS19.vehicleKey, source: "turn_ordinal", candidateVehicleKeys: [COMPASS19.vehicleKey], subjectModel: null };
  const modelTarget: TargetResolution = { kind: "resolved", vehicleKey: COMPASS19.vehicleKey, source: "turn_explicit_model", candidateVehicleKeys: [COMPASS19.vehicleKey], subjectModel: "Compass" };
  check("[P-ord-a] ordinal + 'me mande fotos do segundo' -> autoriza", authorizesPhotoByResolvedOrdinal(ordTarget, "Me mande fotos do segundo") === true);
  check("[P-ord-b] ordinal SEM pedido de foto ('gostei do segundo') -> NÃO autoriza", authorizesPhotoByResolvedOrdinal(ordTarget, "gostei do segundo") === false);
  check("[P-ord-c] ordinal + negação de foto ('foto do segundo depois') -> NÃO autoriza", authorizesPhotoByResolvedOrdinal(ordTarget, "foto do segundo depois") === false);
  check("[P-ord-d] alvo por MODELO (não ordinal) -> NÃO autoriza (só turn_ordinal)", authorizesPhotoByResolvedOrdinal(modelTarget, "me manda foto do compass") === false);
  check("[P-ord-e] alvo none -> NÃO autoriza", authorizesPhotoByResolvedOrdinal({ kind: "none", subjectModel: null }, "me manda foto do segundo") === false);

  // ─────────────────────────────────────────────────────────────────────────
  // PARTE 3 — PURO: anti-repetição de pergunta
  // ─────────────────────────────────────────────────────────────────────────
  check("[P-rep-a] nome CONHECIDO + pergunta nome -> repetição", detectQuestionRepetition({ finalText: "Perfeito! Qual é o seu nome?", slotsKnown: { nome: true, interesse: false, tipoVeiculo: false, faixaPreco: false }, recentTurns: [] })?.repeatedSlot === "nome");
  check("[P-rep-b] nome DESCONHECIDO + pergunta nome -> NÃO repete (1ª vez ok)", detectQuestionRepetition({ finalText: "Qual é o seu nome?", slotsKnown: { nome: false, interesse: false, tipoVeiculo: false, faixaPreco: false }, recentTurns: [] }) === null);
  check("[P-rep-c] interesse conhecido + 'o que você procura?' -> repetição", detectQuestionRepetition({ finalText: "Douglas, o que você está procurando em um carro?", slotsKnown: { nome: true, interesse: true, tipoVeiculo: false, faixaPreco: false }, recentTurns: [] })?.repeatedSlot === "interesse");
  check("[P-rep-d] mesma pergunta recente do agente -> repetição (histórico)", detectQuestionRepetition({ finalText: "Você prefere automático ou manual?", slotsKnown: { nome: false, interesse: false, tipoVeiculo: false, faixaPreco: false }, recentTurns: [{ role: "agent", text: "Legal! Você prefere automático ou manual?" }, { role: "lead", text: "sei lá" }] }) != null);
  check("[P-rep-e] afirmação (sem '?') nunca bloqueia", detectQuestionRepetition({ finalText: "Perfeito, Douglas! Vou te mostrar umas opções.", slotsKnown: { nome: true, interesse: true, tipoVeiculo: true, faixaPreco: true }, recentTurns: [] }) === null);
  check("[P-rep-f] pergunta NOVA (não conhecida, sem histórico) passa", detectQuestionRepetition({ finalText: "Você pretende dar um carro na troca?", slotsKnown: { nome: true, interesse: true, tipoVeiculo: false, faixaPreco: false }, recentTurns: [] }) === null);
  // P1 (audit Codex): a guarda bloqueia repergunta de SLOT, NUNCA a escolha de um item OFERTADO. "Qual desses..." é o
  // próximo passo do funil, não uma repergunta — não pode ser bloqueado mesmo com tipo/interesse já conhecidos.
  const allKnown = { nome: true, interesse: true, tipoVeiculo: true, faixaPreco: true };
  check("[P-rep-g] escolha na lista ('qual desses modelos você prefere?') NÃO bloqueia com tipo/interesse conhecidos", detectQuestionRepetition({ finalText: "Qual desses modelos você prefere?", slotsKnown: allKnown, recentTurns: [] }) === null);
  check("[P-rep-h] 'qual dos que te mostrei te interessou?' (escolha) NÃO bloqueia", detectQuestionRepetition({ finalText: "Qual dos que te mostrei te interessou mais?", slotsKnown: allKnown, recentTurns: [] }) === null);
  check("[P-rep-i] escolha na lista NÃO é barrada por histórico (mesma pergunta de escolha recente passa)", detectQuestionRepetition({ finalText: "E aí, qual desses te agradou?", slotsKnown: allKnown, recentTurns: [{ role: "agent", text: "Qual desses te agradou?" }, { role: "lead", text: "hmm" }] }) === null);
  check("[P-rep-j] repergunta de slot REAL (nome) ainda bloqueia — carve-out não afrouxa o slot", detectQuestionRepetition({ finalText: "Qual é o seu nome mesmo?", slotsKnown: allKnown, recentTurns: [] })?.repeatedSlot === "nome");

  // ─────────────────────────────────────────────────────────────────────────
  // PARTE 4 — PURO: dedup de select_vehicle_focus
  // ─────────────────────────────────────────────────────────────────────────
  {
    const st = { ...createInitialState({ conversationId: "x", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }), ...offerCtx([COMPASS17, COMPASS19]) } as ConversationState;
    const ids: RememberedVehicleIdentity[] = [];
    const dupSel: DecisionMutation[] = [selMut(COMPASS19) as unknown as DecisionMutation, selMut(COMPASS19) as unknown as DecisionMutation];
    const outDup = canonicalizeSelectMutations(dupSel, [], ids, st);
    check("[P-dedup-a] duas select do MESMO key -> 1 mutação", outDup.mutations.filter((m) => m.op === "select_vehicle_focus").length === 1, `got ${outDup.mutations.length}`);
    const twoKeys: DecisionMutation[] = [selMut(COMPASS17) as unknown as DecisionMutation, selMut(COMPASS19) as unknown as DecisionMutation];
    const outTwo = canonicalizeSelectMutations(twoKeys, [], ids, st);
    check("[P-dedup-b] selects de keys DIFERENTES -> ambas preservadas", outTwo.mutations.filter((m) => m.op === "select_vehicle_focus").length === 2);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PARTE 5 — INTEGRAÇÃO: RESOLUÇÃO ÚNICA (bug do Compass "fotos do segundo")
  // ─────────────────────────────────────────────────────────────────────────
  {
    // O cérebro inicialmente rotula "fotos do segundo" só como SELEÇÃO. O engine
    // não executa por esse rótulo: devolve feedback semântico e a própria LLM
    // corrige o ato para request_photos antes de a tool ser autorizada.
    const c = conv(offerCtx([COMPASS17, COMPASS19]));
    await c.seed();
    const selU = U("select_vehicle", { caps: ["select"], subject: "ordinal_from_last_offer", subjectValue: "2", subjectSource: "current_turn", evidence: [{ capability: "select", quote: "segundo" }] });
    const photoU = U("request_photos", { caps: ["send_photos"], subject: "ordinal_from_last_offer", subjectValue: "2", subjectSource: "current_turn", evidence: [{ capability: "send_photos", quote: "fotos do segundo" }] });
    const responder: BrainResponder = (_frame, observations) => {
      const photoReady = observations.some((o) => o.tool === "vehicle_photos_resolve" && o.ok);
      const actCorrectionRequested = observations.some((o) => o.tool === "response" && o.error?.code === "PHOTO_ACT_EXPECTED");
      return photoReady
        ? finU(
            [txt("Claro, aqui estão as fotos do Jeep Compass 2019.")],
            [reply, { kind: "send_media", planId: "photos", order: 1, vehicleKey: COMPASS19.vehicleKey, photoIds: ["p1", "p2"], onSuccess: [] } as ProposedEffectPlan],
            "send_selected_photos",
            photoU,
            [selMut(COMPASS19)],
          )
        : actCorrectionRequested
          ? finU([txt("Vou buscar as fotos do segundo veículo.")], [reply], "resolve_selected_photos", photoU, [selMut(COMPASS19)])
        : finU([txt("Boa escolha!")], [reply], "select_ack", selU, [selMut(COMPASS19)]);
    };
    const r = await c.t("Me mande fotos do segundo", "ambiguous", responder);
    check("[I-compass-a] envia mídia do item 2 (Compass 2019)", r.hasMedia === true && r.mediaKey === COMPASS19.vehicleKey, `hasMedia=${r.hasMedia} key=${r.mediaKey} src=${r.src}`);
    check("[I-compass-b] rodou vehicle_photos_resolve determinístico", r.exec.includes("vehicle_photos_resolve"), `exec=${r.exec.join(",")}`);
    check("[I-compass-c] resposta comercial é da LLM", r.src === "brain_final" || r.src === "brain_retry", `src=${r.src}`);
    check("[I-compass-d] targetSource = turn_ordinal", r.targetSource === "turn_ordinal", `ts=${r.targetSource}`);
    check("[I-compass-e] NUNCA vira 'de qual carro?' (recovery_photo_which)", r.recoveryReason !== "recovery_photo_which");
  }
  {
    // SEM lista renderizada: "fotos do segundo" não resolve ordinal -> NÃO envia mídia (pergunta qual). Cérebro pergunta.
    const c = conv();
    const askU = U("request_photos", { caps: [], evidence: [] });
    const r = await c.t("Me mande fotos do segundo", "ambiguous", () => finU([txt("De qual carro você quer as fotos?")], [reply], "ask_which", askU));
    check("[I-nolist-a] sem lista -> ZERO mídia (não chuta item)", r.hasMedia === false, `hasMedia=${r.hasMedia}`);
    check("[I-nolist-b] sem lista -> não resolve ordinal (targetSource != turn_ordinal)", r.targetSource !== "turn_ordinal");
  }
  {
    // Ordinal FORA de faixa: lista com 2, pede "o quinto" -> não resolve -> ZERO mídia (pergunta qual).
    const c = conv(offerCtx([COMPASS17, COMPASS19]));
    await c.seed();
    const askU = U("request_photos", { caps: [], evidence: [] });
    const r = await c.t("Me mande fotos do quinto", "ambiguous", () => finU([txt("Só tenho duas opções na lista, qual delas?")], [reply], "ask_which", askU));
    check("[I-range-a] ordinal fora de faixa -> ZERO mídia", r.hasMedia === false, `hasMedia=${r.hasMedia}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PARTE 6 — INTEGRAÇÃO: TRAVA ANTI-PARCIAL (starved medido no CUTOFF/claim, não pós-cérebro — audit Codex F2.24)
  // ─────────────────────────────────────────────────────────────────────────
  {
    // Mensagem NOVA chega enquanto o cérebro "pensa" (bloco jovem no cutoff) -> SUPERSEDED: não commita/despacha; reagrupa.
    const c = conv();
    let injected = false;
    const responder: BrainResponder = () => {
      if (!injected) { injected = true; c.persistence.tryInsert({ eventId: `${c.id}-mid`, conversationId: c.id, raw: redact({ text: "quero um Onix" }), receivedAt: c.clock.now() }); }
      return finU([txt("Oi! Como posso ajudar?")], [reply], "reply", U("other"));
    };
    const r = await c.t("Conheço sim", "ambiguous", responder);
    check("[I-partial-a] status = superseded", r.status === "superseded", `status=${r.status}`);
    check("[I-partial-b] NÃO despachou (sem send_message no outbox)", r.outbox === "" && r.hasMedia === false);
    check("[I-partial-c] bloco reagrupado: mensagens voltam a pending", r.pendingAfter >= 2, `pending=${r.pendingAfter}`);
  }
  {
    // ⭐BUG do audit Codex: cérebro LENTO (clock avança ALÉM do maxWait DURANTE o processamento) NÃO pode fazer o bloco
    // parecer starved retroativamente e mascarar a msg nova. Bloco NÃO estava starved no CUTOFF -> SEMPRE supersede.
    // (Com o cálculo antigo — Date.parse(clock.now()) pós-cérebro — isto commitava uma resposta PARCIAL.)
    const c = conv();
    let injected = false;
    const responder: BrainResponder = () => {
      if (!injected) { injected = true; c.clock.advance(25000); c.persistence.tryInsert({ eventId: `${c.id}-slow`, conversationId: c.id, raw: redact({ text: "e o preço?" }), receivedAt: c.clock.now() }); }
      return finU([txt("Deixa eu ver...")], [reply], "reply", U("other"));
    };
    const r = await c.t("Oi", "ambiguous", responder, 20000);
    check("[I-partial-slow-a] cérebro lento (>maxWait) NÃO starva o bloco retroativamente -> superseded", r.status === "superseded", `status=${r.status}`);
    check("[I-partial-slow-b] cérebro lento -> NÃO despachou resposta parcial", r.outbox === "" && r.hasMedia === false);
  }
  {
    // Bloco JÁ estava starved NO CUTOFF (teto pequeno < idade do bloco no claim ~1s): processa mesmo com pending nova
    // (anti forever-lock). blockAwaitMaxMs=500 e o bloco tem ~1000ms no claim -> starved no cutoff.
    const c = conv();
    let injected = false;
    const responder: BrainResponder = () => {
      if (!injected) { injected = true; c.persistence.tryInsert({ eventId: `${c.id}-starv`, conversationId: c.id, raw: redact({ text: "e aí?" }), receivedAt: c.clock.now() }); }
      return finU([txt("Opa, tudo bem? Como posso ajudar?")], [reply], "reply", U("other"));
    };
    const r = await c.t("Oi", "ambiguous", responder, 500);
    check("[I-partial-starved-a] bloco starved NO CUTOFF -> COMMITA mesmo com pending (anti forever-lock)", r.status === "committed", `status=${r.status}`);
    check("[I-partial-starved-b] despachou a resposta", r.outbox.length > 0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PARTE 7 — INTEGRAÇÃO: ANTI-REPETIÇÃO (nome já conhecido -> feedback ao cérebro)
  // ─────────────────────────────────────────────────────────────────────────
  {
    // ⭐RD1-2: não reperguntar o nome CONHECIDO é ADVISORY (knownName). A LLM advertida usa o nome e avança de 1ª; o
    // engine ENTREGA (brain_final), sem deny/recovery de estilo. O adversarial (LLM repergunta) é coberto pelos smokes.
    const c = conv({ slots: { ...createInitialState({ conversationId: "x", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }).slots, nome: knownSlot("Douglas") } } as Partial<ConversationState>);
    await c.seed();
    const okU = U("other", { evidence: [] });
    const responder: BrainResponder = () => finU([txt("Bom dia, Douglas! Você procura um modelo específico ou um tipo de carro?")], [reply], "reply", okU);
    const r = await c.t("bom dia", "ambiguous", responder);
    check("[I-rep-a] condução entregue (brain_final), sem deny/recovery de estilo", r.committed === true && (r.src ?? "").startsWith("brain"), `src=${r.src}`);
    check("[I-rep-b] resposta final NÃO repergunta o nome", !/qual .*nome/i.test(r.outbox), `outbox="${r.outbox}"`);
  }

  console.log(`\n== F2.24: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
