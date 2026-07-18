// ============================================================================
// F2.20 — P0 TRAVA DE CONTEXTO (audit Codex, conversa Douglas): pedido de foto resolvido caía em technical_fallback
// (sem send_media) e memória velha de photo_request conduzia "você tem SUV?" a responder foto. Engine central REAL
// (singleAuthor) + AgentBrain SCRIPTADO/RESPONDER reproduzindo os erros; os INVARIANTES corrigem tudo.
//   npx tsx tests/run-f2-20-context-lock-photo.ts
//
// UNIT: deriveCurrentTurnIntent / clearStalePhotoIntent / promessa-de-foto (helpers puros exportados).
// E2E:  E1 "me manda foto do 2" + cérebro falha auth -> executor determinístico envia send_media do item 2 (nunca fallback).
//       E2 lista->foto(seta memória photo_request)->"você tem SUV?": frame limpa foto; o mesmo cérebro recebe feedback,
//          redecide stock_search e responde SUV, sem foto (reasonCode != foto, sem send_media).
//       E3 "você tem SUV?" com cérebro adversário (SÓ promete foto) -> nunca send_vehicle_photos: fallback honesto, sem mídia.
//       E4 "me manda foto do 2" SEM lista anterior -> pede qual veículo, SEM consultar estoque/detalhe arbitrário.
// ============================================================================
import { runCentralConversationTurn, deriveCurrentTurnIntent, clearStalePhotoIntent, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildFrameSignals } from "../src/engine/turn-frame-builder.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { applyAcceptedPhotoActionOutcome } from "../src/engine/central-engine.ts";
import { loadPersistedWorkingMemory } from "../src/engine/working-memory.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { AgentBrainPort, AgentBrainStep, AgentBrainDecision, AgentToolObservation, CentralQueryCall, TurnUnderstanding, WorkingMemoryV1, DecisionWorkingMemoryMutation, TurnFrame } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { deriveFallbackUnderstanding } from "../src/engine/turn-understanding.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-04T09:00:00.000Z", SHA = "sha-19";

// Estoque: 3 populares (hatch/compacto) + 1 SUV. O SEGUNDO popular = Chevrolet Onix 2018 (alvo de "foto do 2").
const POP1: VehicleFact = { vehicleKey: "revendamais:1000001", marca: "Fiat", modelo: "Mobi", ano: 2020, preco: 45990, km: 40000, cambio: "Manual", cor: "Branco", tipo: "hatch" };
const POP2: VehicleFact = { vehicleKey: "revendamais:8093653", marca: "Chevrolet", modelo: "Onix", ano: 2018, preco: 58990, km: 60000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const POP3: VehicleFact = { vehicleKey: "revendamais:1000003", marca: "Hyundai", modelo: "HB20", ano: 2019, preco: 62990, km: 55000, cambio: "Manual", cor: "Preto", tipo: "hatch" };
const SUV1: VehicleFact = { vehicleKey: "revendamais:9042878", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 89990, km: 70000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const STOCK = [POP1, POP2, POP3, SUV1];
const POPULAR = [POP1, POP2, POP3];
const ALL_KEYS = STOCK.map((v) => v.vehicleKey);
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const RUNTIME_CFG = { companyName: "Icom Motors", promptText: "Você é o Aloan, consultor da Icom Motors." } as never;

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { tipo?: string; popular?: boolean; precoMax?: number; excludeKeys?: string[] };
    let items = inp.popular ? POPULAR.slice() : STOCK.slice();
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (inp.precoMax != null) items = items.filter((v) => v.preco <= inp.precoMax!);
    if (Array.isArray(inp.excludeKeys)) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  throw new Error("runQuery: tool não suportada " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm {
  async proposeNextQueryOrFinal(): Promise<never> { throw new Error("single-author não deve chamar propose"); }
  async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "[SPY]" }] }; }
}
class RelPreparer implements TurnContextPreparer {
  relation: TurnRelation = "ambiguous";
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> {
    return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor };
  }
}

function authoredUnderstanding(block: string): TurnUnderstanding {
  const normalized = block.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\bfoto|imagem/.test(normalized)) {
    const ordinal = /\b2\b/.test(normalized) ? "2" : null;
    return {
      primaryIntent: "request_photos",
      requestedCapabilities: ["send_photos"],
      subject: ordinal ? "ordinal_from_last_offer" : "none",
      subjectValue: ordinal,
      subjectSource: "current_turn",
      evidence: [{ capability: "send_photos", quote: block }],
      isTopicChange: false,
      answeredLeadQuestions: [],
    };
  }
  if (/\bsuv\b|\bpopular\b|\bsedan\b|\bhatch\b|\bpicape\b|\bonix\b/.test(normalized)) {
    return {
      primaryIntent: "search_stock",
      requestedCapabilities: ["stock_search"],
      subject: /\bsuv\b|\bsedan\b|\bhatch\b|\bpicape\b/.test(normalized) ? "vehicle_type" : "none",
      subjectValue: /\bsuv\b/.test(normalized) ? "suv" : /\bpopular\b/.test(normalized) ? "popular" : null,
      subjectSource: "current_turn",
      evidence: [{ capability: "stock_search", quote: block }],
      isTopicChange: false,
      answeredLeadQuestions: [],
    };
  }
  return deriveFallbackUnderstanding(block, { ...buildFrameSignals(block, { relation: "ambiguous" }), mentionsVehicleType: null }, extractor);
}

// Mantem o fake fiel ao contrato de central_active: a LLM sempre declara o
// entendimento do bloco atual. O teste continua decidindo apenas os passos;
// esta funcao representa a declaracao estruturada do fake, nao um fallback da engine.
class UnderstandingBrain implements AgentBrainPort {
  constructor(private readonly inner: ScriptedAgentBrain) {}

  async proposeNextStep(frame: TurnFrame, observations: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    const step = await this.inner.proposeNextStep(frame, observations);
    return step.understanding ? step : { ...step, understanding: authoredUnderstanding(frame.block) };
  }
}

// builders
const txt = (content: string): ResponsePart => ({ type: "text", content });
const offer = (vs: VehicleFact[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: vs.map((v) => v.vehicleKey) });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const q = (call: CentralQueryCall): AgentBrainStep => ({ kind: "query", call });
function fin(parts: ResponsePart[], effects?: ProposedEffectPlan[], reasonCode = "reply", mem: DecisionWorkingMemoryMutation[] = []): AgentBrainStep {
  const decision: AgentBrainDecision = { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects ?? [reply], memoryMutations: mem, stateMutations: [] };
  return { kind: "final", decision };
}
// Final que MENTE prometendo foto (reproduz o bug): texto "aqui estão as fotos" + reasonCode de foto, SEM send_media.
const finPhotoPromise = (): AgentBrainStep => fin([txt("Douglas, aqui estão as fotos do carro que você pediu.")], [reply], "send_vehicle_photos");
// Final que FALHA auth: escreve a CHAVE crua (P0-2 deny) — força o caminho do executor determinístico.
const finRawKey = (v: VehicleFact): AgentBrainStep => fin([txt(`Aqui o carro (chave ${v.vehicleKey}).`)]);
// Final com draft VAZIO: auth rejeita (sem parts) — usado quando não há key conhecida.
const finEmpty = (): AgentBrainStep => fin([]);
const stockPopular = (): CentralQueryCall => ({ tool: "stock_search", input: { popular: true } });
const stockSuv = (): CentralQueryCall => ({ tool: "stock_search", input: { tipo: "suv" } });
const detailsCall = (v: VehicleFact): CentralQueryCall => ({ tool: "vehicle_details", input: { vehicleKey: v.vehicleKey } });
const photosCall = (v: VehicleFact): CentralQueryCall => ({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: v.vehicleKey } } });

type Cap = {
  lead: string; outbox: string; src: string; degraded: boolean; ts: boolean; reasonCode: string; hasMedia: boolean;
  mediaKey: string | null; exec: QueryCall[]; policyFeedback: string[]; brainFeedback: string[]; frameIntent: string | null; frameTopic: string | null; wmTopic: string | null;
};
const has = (s: string, n: string): boolean => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
const anyKey = (s: string): string | null => ALL_KEYS.find((k) => s.includes(k)) ?? null;

async function makeConv(convId: string): Promise<{ turn: (lead: string, relation: TurnRelation, script: AgentBrainStep[] | BrainResponder) => Promise<Cap> }> {
  const brain = new ScriptedAgentBrain();
  const preparer = new RelPreparer();
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const businessInfo = { async get() { return { ok: false as const, error: { code: "NOT_CONFIGURED" as const, message: "n/a" } }; } } as never;
  let seq = 0;
  const turn = async (lead: string, relation: TurnRelation, script: AgentBrainStep[] | BrainResponder): Promise<Cap> => {
    seq += 1; executed.length = 0; preparer.relation = relation;
    if (typeof script === "function") brain.setResponder(script); else brain.setTurnScript(script);
    const framesBefore = brain.seenFrames.length;
    await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
    clock.advance(1000);
    const turnId = `${convId}-t${seq}`;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain: new UnderstandingBrain(brain), llm: new ComposeSpyLlm(), runQuery, businessInfo, contextPreparer: preparer,
      conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
      limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 2, brainMaxSteps: 8, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    });
    const execSnapshot = [...executed];
    while (true) {
      const claimed = await persistence.claimOutbox(convId, "w", 120_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock, conversationId: convId, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result });
      }
    }
    clock.advance(30000);
    const after = (await persistence.load(convId))?.state;
    const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string; vehicleKey?: string } }[];
    const wm = loadPersistedWorkingMemory(after?.workingMemory).memory;
    const firstFrame: TurnFrame | undefined = brain.seenFrames[framesBefore];
    const brainFeedback = brain.seenObservations.slice(framesBefore).flat()
      .filter((o) => o.tool === "response" && !o.ok)
      .map((o) => o.ok === false ? o.error.message : "");
    const mediaRec = outbox.find((o) => o.kind === "send_media");
    return {
      lead, outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", src: r.status === "committed" ? r.responseSource : r.status,
      degraded: r.status === "committed" && r.degraded, ts: r.status === "committed" && r.terminalSafe,
      reasonCode: r.status === "committed" ? r.decision.reasonCode : r.status, hasMedia: !!mediaRec, mediaKey: mediaRec?.payload?.vehicleKey ?? null,
      exec: execSnapshot, policyFeedback: r.status === "committed" ? [...r.policyFeedback] : [],
      brainFeedback,
      frameIntent: firstFrame?.signals.currentTurnIntent ?? null, frameTopic: firstFrame?.workingMemory.activeTopic?.topic ?? null,
      wmTopic: wm.activeTopic?.topic ?? null,
    };
  };
  return { turn };
}

async function main(): Promise<void> {
  console.log("== F2.20 P0 trava de contexto (foto/busca) ==");

  // ── UNIT: helpers puros ────────────────────────────────────────────────────────────────────────────────────────
  const sig = (msg: string) => buildFrameSignals(msg, { relation: "ambiguous" });
  check("[U1] 'você tem SUV?' -> currentTurnIntent=search", deriveCurrentTurnIntent("você tem SUV?", sig("você tem SUV?"), extractor) === "search");
  check("[U2] 'me manda foto do 2' -> photo_request", deriveCurrentTurnIntent("me manda foto do 2", sig("me manda foto do 2"), extractor) === "photo_request");
  check("[U3] 'qual carro eu pedi as fotos?' -> photo_memory", deriveCurrentTurnIntent("qual carro eu pedi as fotos?", sig("qual carro eu pedi as fotos?"), extractor) === "photo_memory");
  check("[U4] 'quero um onix' (modelo) -> search", deriveCurrentTurnIntent("quero um onix", sig("quero um onix"), extractor) === "search");
  check("[U5] 'quero algo até 50 mil' (orçamento) -> search", deriveCurrentTurnIntent("quero algo até 50 mil", sig("quero algo até 50 mil"), extractor) === "search");
  check("[U5b] explicit commercial pivot -> search", deriveCurrentTurnIntent("na verdade quero um sedan automatico ate 120 mil", sig("na verdade quero um sedan automatico ate 120 mil"), extractor) === "search");
  {
    const wmPhoto: WorkingMemoryV1 = { ...createInitialPersistedWorkingMemory(), activeTopic: { topic: "photo_request", sinceTurnId: "t0", origin: "lead_message" }, currentLeadIntent: { intent: "photo_request", confidence: 0.9, evidence: [] }, selectedVehicle: null, lastOffer: null, funnel: {} as never, photoLedger: [] as never } as never;
    const cleared = clearStalePhotoIntent(wmPhoto, "search");
    check("[U6] search limpa activeTopic/currentLeadIntent de foto do frame", cleared.activeTopic === null && cleared.currentLeadIntent === null, JSON.stringify({ t: cleared.activeTopic, i: cleared.currentLeadIntent }));
    const keptPhotoTurn = clearStalePhotoIntent(wmPhoto, "photo_request");
    check("[U7] turno de FOTO não limpa a memória de foto", keptPhotoTurn.activeTopic?.topic === "photo_request");
    const wmSearch: WorkingMemoryV1 = { ...wmPhoto, activeTopic: { topic: "discover_stock", sinceTurnId: "t0", origin: "lead_message" }, currentLeadIntent: { intent: "discover_stock", confidence: 0.9, evidence: [] } } as never;
    check("[U8] search NÃO mexe em tópico não-foto", clearStalePhotoIntent(wmSearch, "search").activeTopic?.topic === "discover_stock");
  }

  // ── E1: pedido de foto resolvido + LLM autora send_media do item 2. ───────────────────────────────────────────────
  {
    const { turn } = await makeConv("E1");
    await turn("Quero um carro popular", "ambiguous", [q(stockPopular()), fin([txt("Tenho estas opções populares:"), offer(POPULAR), txt("Quer ver as fotos de alguma?")])]);
    const c = await turn("Me manda foto do 2", "ambiguous", [
      q(photosCall(POP2)),
      fin([txt("Aqui estao as fotos do Chevrolet Onix 2018 que voce pediu.")], [reply, { kind: "send_media", planId: "m", order: 1, vehicleKey: POP2.vehicleKey, photoIds: ["p1", "p2"], onSuccess: [] } as ProposedEffectPlan], "send_vehicle_photos"),
    ]);
    check("[E1] 'foto do 2' resolvido -> LLM envia send_media do item 2 (Onix)", c.hasMedia && c.mediaKey === POP2.vehicleKey && (c.src === "brain_final" || c.src === "brain_retry"), `hasMedia=${c.hasMedia} key=${c.mediaKey} src=${c.src}`);
    check("[E1] NÃO cai em technical_fallback nem degradado", c.src !== "technical_fallback" && !c.degraded, `src=${c.src} degraded=${c.degraded}`);
    check("[E1] texto nomeia o carro (não a chave crua)", has(c.outbox, "Chevrolet Onix") && !anyKey(c.outbox), `text="${c.outbox}"`);
  }

  // ── E2: lista -> foto(seta memória photo_request) -> "você tem SUV?": frame limpa foto e não herda o assunto. ─────
  {
    const { turn } = await makeConv("E2");
    await turn("Quero um carro popular", "ambiguous", [q(stockPopular()), fin([txt("Tenho estas opções:"), offer(POPULAR), txt("Quer ver as fotos?")])]);
    // T2: foto do 2, cérebro AUTORA send_media E seta memória activeTopic/currentLeadIntent=photo_request (turnId do frame).
    const photoResp: BrainResponder = (frame, obs) => {
      if (!obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok)) return q(photosCall(POP2));
      const mem: DecisionWorkingMemoryMutation[] = [
        { op: "set_active_topic", topic: "photo_request", origin: "lead_message", turnId: frame.turnId },
        { op: "set_lead_intent", intent: "photo_request", confidence: 0.9, evidence: ["foto"], turnId: frame.turnId },
      ];
      return fin([txt("Aqui estão as fotos que você pediu! 😊")], [reply, { kind: "send_media", planId: "m", order: 1, vehicleKey: POP2.vehicleKey, photoIds: ["p1", "p2"], onSuccess: [] } as ProposedEffectPlan], "send_vehicle_photos", mem);
    };
    const cPhoto = await turn("Me manda foto do 2", "ambiguous", photoResp);
    check("[E2-pre] turno de foto ENVIA mídia e SETA memória photo_request", cPhoto.hasMedia && cPhoto.wmTopic === "photo_request", `media=${cPhoto.hasMedia} wmTopic=${cPhoto.wmTopic}`);
    // T3: "você tem SUV?" — a memória de foto não conduz o turno; o mesmo cérebro recebe feedback e declara a busca.
    const suvResp: BrainResponder = (_frame, obs, i) => {
      const stockDone = obs.some((o) => o.tool === "stock_search" && o.ok);
      const brainRejected = obs.some((o) => o.tool === "response" && !o.ok);
      if (!stockDone) return i === 0 ? finPhotoPromise() : q(stockSuv());
      return brainRejected ? fin([txt("Tenho esta opção de SUV pra você:"), offer([SUV1]), txt("Quer ver as fotos?")]) : finPhotoPromise();
    };
    const c = await turn("Você tem SUV?", "ambiguous", suvResp);
    const suvStock = c.exec.find((x) => x.tool === "stock_search");
    check("[E2] frame do turno vê currentTurnIntent=search + activeTopic de foto LIMPO", c.frameIntent === "search" && c.frameTopic === null, `intent=${c.frameIntent} topic=${c.frameTopic}`);
    check("[E2] executa stock_search tipo=suv", (suvStock?.input as { tipo?: string })?.tipo === "suv", JSON.stringify(suvStock?.input ?? null));
    check("[E2] responde SUV (Renegade), SEM texto de foto e SEM send_media", has(c.outbox, "Renegade") && !c.hasMedia && !has(c.outbox, "aqui estao as fotos"), `media=${c.hasMedia} text="${c.outbox}"`);
    check("[E2] reasonCode NÃO é de foto", !/photo|foto/i.test(c.reasonCode), `reasonCode=${c.reasonCode}`);
    check("[E2] engine devolveu feedback ao mesmo cerebro e ele reescreveu sem foto", c.brainFeedback.length > 0, JSON.stringify(c.brainFeedback));
  }

  // ── E3: "você tem SUV?" com cérebro adversário que SÓ promete foto -> nunca send_vehicle_photos: fallback honesto. ──
  {
    const { turn } = await makeConv("E3");
    const c = await turn("Você tem SUV?", "ambiguous", () => finPhotoPromise());
    check("[E3] cérebro só promete foto -> NUNCA envia mídia e reasonCode não é de foto", !c.hasMedia && !/photo|foto/i.test(c.reasonCode), `media=${c.hasMedia} reason=${c.reasonCode}`);
    check("[E3] resposta não promete foto (recuperação honesta/degradado)", !has(c.outbox, "aqui estao as fotos") && (c.src === "technical_fallback" || c.src === "deterministic_recovery" || c.src === "brain_final" || c.src === "brain_retry"), `src=${c.src} text="${c.outbox}"`);
  }

  // E3b: pedido explícito de foto + promessa de terceirizar o envio sem
  // send_media. A engine não aceita a promessa nem a transforma em resposta;
  // devolve a incoerência ao mesmo cérebro para ele enviar a mídia ou admitir
  // honestamente que não a localizou.
  {
    const { turn } = await makeConv("E3b");
    const c = await turn("Esse carro tem foto?", "ambiguous", () => fin([txt("Vou pedir para a nossa equipe enviar para você.")]));
    check("[E3b] promessa de equipe sem send_media nunca é aceita", !c.hasMedia && !has(c.outbox, "vou pedir para a nossa equipe"), `src=${c.src} text="${c.outbox}"`);
    check("[E3b] feedback rejeita promessa de envio futuro", c.brainFeedback.some((f) => /prometeu|efeito execut[aá]vel|envio futuro/i.test(f)), JSON.stringify(c.brainFeedback));
  }

  // ── E4: "me manda foto do 2" SEM lista anterior -> pede qual veículo, SEM consultar arbitrário. ───────────────────
  {
    const { turn } = await makeConv("E4");
    const c = await turn("Me manda foto do 2", "ambiguous", [fin([txt("De qual carro voce quer ver as fotos?")])]);
    check("[E4] sem lista -> pede QUAL veículo (LLM)", (c.src === "brain_final" || c.src === "brain_retry") && has(c.outbox, "qual carro") && !c.hasMedia, `src=${c.src} text="${c.outbox}"`);
    check("[E4] NÃO consulta estoque/detalhe arbitrário", !c.exec.some((x) => x.tool === "stock_search" || x.tool === "vehicle_details"), JSON.stringify(c.exec.map((x) => x.tool)));
  }

  // E5: se a LLM mostra DOIS veiculos por refs avulsas, o texto fica natural,
  // mas o estado ainda precisa preservar ordem/chaves para o turno seguinte.
  // Nao obrigamos a LLM a usar lista: a infraestrutura apenas espelha as refs
  // tipadas e aterradas que o renderer realmente materializou.
  {
    const { turn } = await makeConv("E5");
    const malformedThenStructured: BrainResponder = (_frame, obs) => {
      const stock = [...obs].reverse().find((o) => o.tool === "stock_search" && o.ok);
      if (!stock) return q(stockPopular());
      return fin([
        txt("Dentro do seu valor, tenho "),
        { type: "vehicle_ref", vehicleKey: POP1.vehicleKey, field: "modelo" },
        txt(" por "),
        { type: "money_ref", role: "vehicle_price", source: { kind: "vehicle_fact", vehicleKey: POP1.vehicleKey } },
        txt(" e "),
        { type: "vehicle_ref", vehicleKey: POP2.vehicleKey, field: "modelo" },
        txt(" por "),
        { type: "money_ref", role: "vehicle_price", source: { kind: "vehicle_fact", vehicleKey: POP2.vehicleKey } },
        txt("."),
      ]);
    };
    const offerTurn = await turn("Quero um carro popular ate 70 mil", "ambiguous", malformedThenStructured);
    check("[E5] multiplos veiculos aterrados preservam resposta natural", offerTurn.src !== "technical_fallback" && has(offerTurn.outbox, "Mobi") && has(offerTurn.outbox, "Onix"), JSON.stringify({ feedback: offerTurn.brainFeedback, text: offerTurn.outbox }));

    const photoTurn = await turn("Pode mandar a foto do Onix", "ambiguous", [
      q(photosCall(POP2)),
      fin([txt("Aqui estao as fotos do Chevrolet Onix 2018.")], [reply, { kind: "send_media", planId: "m", order: 1, vehicleKey: POP2.vehicleKey, photoIds: ["p1", "p2"], onSuccess: [] } as ProposedEffectPlan], "send_vehicle_photos"),
    ]);
    check("[E5] pedido posterior por modelo envia a foto do carro correto", photoTurn.hasMedia && photoTurn.mediaKey === POP2.vehicleKey && photoTurn.src !== "technical_fallback", JSON.stringify({ media: photoTurn.hasMedia, key: photoTurn.mediaKey, src: photoTurn.src, feedback: photoTurn.brainFeedback }));
  }

  console.log(`\n== F2.20: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
