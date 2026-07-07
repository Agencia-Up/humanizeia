// ============================================================================
// F2.21 — central_active LLM-FIRST (missão SDR real). Engine REAL (singleAuthor + llmFirst) + fake brain
// scriptado/adversarial provando que o ENGINE não sequestra a conversa: não escreve pergunta de funil por fora da
// LLM, não cria objetivo de funil, não encerra por falta de entrada, não repete pergunta respondida, não vira menu.
// Guardrails continuam: grounding, foto certa, sem inventar, ≤1 pergunta, erro técnico honesto.
//   npx tsx tests/run-f2-21-llm-first-sdr.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { loadPersistedWorkingMemory } from "../src/engine/working-memory.ts";
import { PolicyEngine } from "../src/engine/policy-engine.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnDecision, RenderedResponse } from "../src/domain/decision.ts";
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
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-04T09:00:00.000Z", SHA = "sha-21";

const POP1: VehicleFact = { vehicleKey: "revendamais:2000001", marca: "Fiat", modelo: "Mobi", ano: 2020, preco: 45990, km: 40000, cambio: "Manual", cor: "Branco", tipo: "hatch" };
const POP2: VehicleFact = { vehicleKey: "revendamais:2000002", marca: "Chevrolet", modelo: "Onix", ano: 2018, preco: 49990, km: 60000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const POP3: VehicleFact = { vehicleKey: "revendamais:2000003", marca: "Hyundai", modelo: "HB20", ano: 2019, preco: 48990, km: 55000, cambio: "Manual", cor: "Preto", tipo: "hatch" };
const SUV1: VehicleFact = { vehicleKey: "revendamais:2000004", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 89990, km: 70000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const STOCK = [POP1, POP2, POP3, SUV1];
const POPULAR = [POP1, POP2, POP3];
const ALL_KEYS = STOCK.map((v) => v.vehicleKey);
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const PROMPT = "Você é o Aloan, consultor da Icom Motors em Taubaté. Conduza a venda com naturalidade.";
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom Motors", promptText: PROMPT } as never);
const businessInfoStore: TenantBusinessInfoSource = { async getBusinessInfo() { return { address: "Rua das Flores, 123, Centro, Taubaté SP", hours: "Segunda a Sábado das 9h às 19h", unit: "Icom Motors", source: "test" }; } };

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { tipo?: string; modelo?: string; popular?: boolean; precoMax?: number; excludeKeys?: string[] };
    let items = inp.popular ? POPULAR.slice() : STOCK.slice();
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (inp.modelo) items = items.filter((v) => norm(v.modelo).includes(norm(inp.modelo!)));
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

const txt = (content: string): ResponsePart => ({ type: "text", content });
const offer = (vs: VehicleFact[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: vs.map((v) => v.vehicleKey) });
const moneyRef = (key: string): ResponsePart => ({ type: "money_ref", role: "vehicle_price", source: { kind: "vehicle_fact", vehicleKey: key } });
const vref = (key: string, field: "km" | "cor" | "cambio"): ResponsePart => ({ type: "vehicle_ref", vehicleKey: key, field });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const mediaEff = (v: VehicleFact): ProposedEffectPlan => ({ kind: "send_media", planId: "m", order: 1, vehicleKey: v.vehicleKey, photoIds: ["p1", "p2"], onSuccess: [] } as ProposedEffectPlan);
const q = (call: CentralQueryCall): AgentBrainStep => ({ kind: "query", call });
function fin(parts: ResponsePart[], effects?: ProposedEffectPlan[], reasonCode = "reply"): AgentBrainStep {
  const decision: AgentBrainDecision = { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects ?? [reply], memoryMutations: [], stateMutations: [] };
  return { kind: "final", decision };
}

type Cap = { outbox: string; src: string; degraded: boolean; committed: boolean; hasMedia: boolean; mediaKey: string | null; reasonCode: string; exec: QueryCall[]; slots: Record<string, string>; objSlot: string | null; inst: { topic: string; status: string }[]; selKey: string | null; policyFeedback: string[] };
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));
const anyKey = (s: string): string | null => ALL_KEYS.find((k) => s.includes(k)) ?? null;
function slotSummary(state: unknown): Record<string, string> {
  const out: Record<string, string> = {}; const slots = (state as { slots?: Record<string, { status?: string; value?: unknown }> })?.slots ?? {};
  for (const k of Object.keys(slots)) { const s = slots[k]; if (s?.status && s.status !== "unknown") out[k] = `${s.status}:${JSON.stringify(s.value ?? null)}`; }
  return out;
}

// Anexa um understanding DERIVADO do lead (trusted) aos steps sem understanding. F2.21 testa a CONDUÇÃO SDR (busca/
// seleção/funil/CPF), não o gate P0-2 (que é a F2.23) — isto reflete "o cérebro emite understanding" sem reescrever os
// 35 casos. fromBrain=true (é o step do brain), então em llmFirst a ação é autorizada normalmente pela semântica derivada.
class UnderstandingBrain implements AgentBrainPort {
  constructor(private readonly inner: ScriptedAgentBrain) {}
  setResponder(fn: BrainResponder): void { this.inner.setResponder(fn); }
  setTurnScript(steps: AgentBrainStep[]): void { this.inner.setTurnScript(steps); }
  async proposeNextStep(frame: TurnFrame, obs: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    const step = await this.inner.proposeNextStep(frame, obs);
    if (step.understanding) return step;
    let u = deriveFallbackUnderstanding(frame.block, frame.signals, extractor);
    if (!u.evidence || u.evidence.length === 0) { const w = frame.block.trim().split(/\s+/).slice(0, 2).join(" ") || frame.block.slice(0, 3); u = { ...u, evidence: [{ quote: w }] }; }
    return { ...step, understanding: u };
  }
}
function makeConv(convId: string, opts: { llmFirst: boolean; businessInfo?: TenantBusinessInfoSource } = { llmFirst: true }) {
  const brain = new UnderstandingBrain(new ScriptedAgentBrain());
  const preparer = new RelPreparer();
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const businessInfo = opts.businessInfo ?? ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom Motors", source: "test" }; } } as TenantBusinessInfoSource);
  let seq = 0;
  const turn = async (lead: string, relation: TurnRelation, script: AgentBrainStep[] | BrainResponder): Promise<Cap> => {
    seq += 1; executed.length = 0; preparer.relation = relation;
    if (typeof script === "function") brain.setResponder(script); else brain.setTurnScript(script);
    await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
    clock.advance(1000);
    const turnId = `${convId}-t${seq}`;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo, contextPreparer: preparer,
      conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
      limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 2, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: opts.llmFirst,
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
    const media = outbox.find((o) => o.kind === "send_media");
    return {
      outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", src: r.status === "committed" ? r.responseSource : r.status,
      degraded: r.status === "committed" && r.degraded, committed: r.status === "committed", hasMedia: !!media, mediaKey: media?.payload?.vehicleKey ?? null,
      reasonCode: r.status === "committed" ? r.decision.reasonCode : r.status, exec: execSnapshot, slots: slotSummary(after),
      objSlot: (after as { currentObjective?: { slot?: string; status?: string } } | undefined)?.currentObjective?.slot ?? null,
      inst: r.status === "committed" ? [...r.institutionalResolved] : [],
      selKey: (after as { vehicleContext?: { selected?: { key?: string } } } | undefined)?.vehicleContext?.selected?.key ?? null,
      policyFeedback: r.status === "committed" ? [...r.policyFeedback] : [],
    };
  };
  return { turn };
}

async function main(): Promise<void> {
  console.log("== F2.21 central_active LLM-first ==");

  // 1) ENTRADA ZERO: agente perguntou entrada; lead "não" -> entrada=0, resposta NÃO repergunta entrada, NÃO encerra.
  {
    const { turn } = makeConv("c1");
    await turn("Quero financiar", "ambiguous", [fin([txt("Fechado! Você pretende dar algum valor de entrada?")])]);
    const c = await turn("não", "ambiguous", [fin([txt("Sem problema, Douglas. Dá pra fazer com entrada zero e simular o financiamento. Qual parcela mensal fica confortável pra você?")])]);
    check("[1] entrada NEGADA vira 0 (memória)", /:0\b/.test(c.slots.entrada ?? "") && /known/.test(c.slots.entrada ?? ""), JSON.stringify(c.slots.entrada));
    check("[1] resposta NÃO repergunta entrada e NÃO encerra", !/valor de entrada|de entrada voce|entrada voce (pretende|pensa)/i.test(c.outbox) && c.committed && !c.degraded, `text="${c.outbox}"`);
    check("[1] engine NÃO criou objetivo de funil (llm-first)", c.objSlot === null, `objSlot=${c.objSlot}`);
  }
  // 2) REPETIÇÃO SEMÂNTICA: "tenho não" = não tenho entrada (não confundir com "tenho").
  {
    const { turn } = makeConv("c2");
    await turn("Quero financiar", "ambiguous", [fin([txt("Perfeito! Tem algum valor de entrada em mente?")])]);
    const c = await turn("tenho não", "ambiguous", [fin([txt("Tranquilo! Seguimos com entrada zero então. Quer que eu simule uma parcela?")])]);
    check("[2] 'tenho não' -> entrada=0 (não vira 'sim')", /:0\b/.test(c.slots.entrada ?? ""), JSON.stringify(c.slots.entrada));
  }
  // 3) RECUPERAÇÃO: lead reforça "mas eu quero financiar" -> agente segue financiamento, não encerra.
  {
    const { turn } = makeConv("c3");
    const c = await turn("mas eu quero financiar", "ambiguous", [fin([txt("Claro, Douglas! Seguimos pelo financiamento. Posso trabalhar com entrada zero e achar uma parcela que encaixe. Você tem uma faixa de parcela em mente?")])]);
    check("[3] recupera intenção e continua (financiamento), committed sem degradar", c.committed && !c.degraded && has(c.outbox, "financiamento"), `src=${c.src} text="${c.outbox}"`);
    check("[3] formaPagamento=financiamento capturada", /financiamento/.test(c.slots.formaPagamento ?? ""), JSON.stringify(c.slots.formaPagamento));
  }
  // 4) MUDANÇA DE ASSUNTO: turno anterior foto -> "onde fica a loja?" responde loja, sem foto.
  {
    const { turn } = makeConv("c4", { llmFirst: true, businessInfo: businessInfoStore });
    await turn("Quero um carro popular", "ambiguous", [q(stockPopular()), fin([txt("Tenho estas opções:"), offer(POPULAR), txt("Quer ver as fotos de alguma?")])]);
    const c = await turn("onde fica a loja?", "ambiguous", [q({ tool: "tenant_business_info", input: { topic: "address" } }), fin([txt("Ficamos na Rua das Flores, 123, Centro, Taubaté. Posso te ajudar em mais algo?")])]);
    check("[4] responde a LOJA (endereço), sem send_media e sem texto de foto", has(c.outbox, "Rua das Flores") && !c.hasMedia && !has(c.outbox, "aqui estao as fotos"), `media=${c.hasMedia} text="${c.outbox}"`);
    check("[4] institucional address resolvido", c.inst.some((x) => x.topic === "address" && x.status === "ok"), JSON.stringify(c.inst));
  }
  // 5) ESTOQUE: "vocês tem SUV?" -> LLM chama stock_search, lista factual, engine não injeta CTA.
  {
    const { turn } = makeConv("c5");
    const c = await turn("vocês tem SUV?", "ambiguous", [q(stockSuv()), fin([txt("Temos sim! Olha essa opção:"), offer([SUV1]), txt("Quer ver as fotos?")])]);
    const st = c.exec.find((x) => x.tool === "stock_search");
    check("[5] LLM chamou stock_search tipo=suv", (st?.input as { tipo?: string })?.tipo === "suv", JSON.stringify(st?.input ?? null));
    check("[5] resposta lista o SUV (Renegade), sem chave crua", has(c.outbox, "Renegade") && !anyKey(c.outbox), `text="${c.outbox}"`);
    check("[5] engine NÃO criou objetivo de funil", c.objSlot === null && c.committed, `objSlot=${c.objSlot}`);
  }
  // 6) FOTO ORDINAL: última lista 3 carros -> "foto do segundo" -> send_media do 2º.
  {
    const { turn } = makeConv("c6");
    await turn("Quero um carro popular", "ambiguous", [q(stockPopular()), fin([txt("Olha essas opções:"), offer(POPULAR), txt("Quer ver fotos de alguma?")])]);
    const c = await turn("manda foto do segundo", "ambiguous", (_f, obs) => {
      if (!obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok)) return q({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: POP2.vehicleKey } } });
      return fin([txt("Aqui estão as fotos que você pediu! 😊")], [reply, mediaEff(POP2)], "send_vehicle_photos");
    });
    check("[6] send_media do 2º (Onix)", c.hasMedia && c.mediaKey === POP2.vehicleKey, `media=${c.hasMedia} key=${c.mediaKey}`);
  }
  // 7) RECALL: "qual carro eu pedi as fotos?" -> responde pela memória, sem enviar mídia.
  {
    const { turn } = makeConv("c7");
    await turn("Quero um carro popular", "ambiguous", [q(stockPopular()), fin([txt("Opções:"), offer(POPULAR), txt("Quer fotos?")])]);
    await turn("manda foto do segundo", "ambiguous", (_f, obs) => {
      if (!obs.some((o) => o.tool === "vehicle_photos_resolve" && o.ok)) return q({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: POP2.vehicleKey } } });
      return fin([txt("Aqui estão! 😊")], [reply, mediaEff(POP2)], "send_vehicle_photos");
    });
    const c = await turn("qual carro eu pedi as fotos?", "ambiguous", [fin([txt("Foi o carro que te enviei, um ótimo negócio.")])]);   // cérebro vago -> recall determinístico nomeia
    check("[7] recall nomeia 'Chevrolet Onix' e NÃO reenvia mídia", has(c.outbox, "Chevrolet Onix") && !c.hasMedia && !anyKey(c.outbox), `media=${c.hasMedia} text="${c.outbox}"`);
  }
  // 8) FORA DE ROTEIRO: "bonito ele" -> resposta contextual, sem menu robótico, engine não injeta funil.
  {
    const { turn } = makeConv("c8");
    await turn("Quero um carro popular", "ambiguous", [q(stockPopular()), fin([txt("Olha:"), offer(POPULAR), txt("Curtiu alguma?")])]);
    const c = await turn("bonito ele", "ambiguous", [fin([txt("É bonito mesmo, Douglas! Esse costuma agradar bastante. Quer que eu te passe as condições de financiamento dele?")])]);
    check("[8] resposta contextual preservada, sem objetivo injetado, ≤1 pergunta", has(c.outbox, "bonito") && c.objSlot === null && (c.outbox.match(/\?/g) ?? []).length <= 1, `objSlot=${c.objSlot} text="${c.outbox}"`);
  }
  // 9) PROIBIR ENGINE-SCRIPT: cérebro pergunta um SLOT de funil (nome). llm-first NÃO cria objetivo; legado CRIA.
  {
    const script: AgentBrainStep[] = [fin([txt("Prazer! Como posso te chamar?")])];
    const cLlm = await makeConv("c9a", { llmFirst: true }).turn("oi", "ambiguous", script);
    check("[9] llm-first: pergunta de slot NÃO cria objetivo de funil no engine", cLlm.objSlot === null && cLlm.committed, `objSlot=${cLlm.objSlot}`);
    const cLegacy = await makeConv("c9b", { llmFirst: false }).turn("oi", "ambiguous", [fin([txt("Prazer! Qual é o seu nome?")])]);
    check("[9] contraste: legado (reconcile) CRIA objetivo de nome", cLegacy.objSlot === "nome", `objSlot=${cLegacy.objSlot}`);
  }
  // 10) GUARDRAIL: cérebro tenta citar PREÇO de veículo NÃO consultado -> engine bloqueia (não envia mentira).
  {
    const { turn } = makeConv("c10");
    const c = await turn("quanto custa o Onix?", "asks_vehicle_detail", [
      fin([txt("O Onix sai por"), moneyRef(POP2.vehicleKey)]),   // money_ref SEM vehicle_details -> render falha fechado
      fin([txt("O Onix sai por"), moneyRef(POP2.vehicleKey)]),
      fin([txt("O Onix sai por"), moneyRef(POP2.vehicleKey)]),
      fin([txt("O Onix sai por"), moneyRef(POP2.vehicleKey)]),
    ]);
    check("[10] preço não-aterrado é BLOQUEADO -> fallback honesto (sem valor inventado)", c.committed && !/R\$|\d{2}\.\d{3}|49\.?990/.test(c.outbox), `src=${c.src} text="${c.outbox}"`);
    check("[10] recuperação contextual segura (não finge preço e não vira falha técnica)", c.committed && !c.degraded && c.src === "deterministic_recovery", `degraded=${c.degraded} src=${c.src}`);
  }

  // 11) CPF CEDO: cérebro pede CPF na qualificação (sem visita agendada) -> BLOQUEADO (não vai CPF no outbox).
  {
    const { turn } = makeConv("c11");
    await turn("Quero financiar", "ambiguous", [fin([txt("Fechado! Tem valor de entrada em mente?")])]);
    const c = await turn("não tenho", "ambiguous", [fin([txt("Perfeito! Qual o seu CPF?")]), fin([txt("Perfeito! Qual o seu CPF?")]), fin([txt("Perfeito! Qual o seu CPF?")]), fin([txt("Perfeito! Qual o seu CPF?")])]);
    check("[11] pedido de CPF cedo é BLOQUEADO (sem CPF no outbox)", !/\bcpf\b/i.test(c.outbox) && c.committed, `text="${c.outbox}"`);
  }
  // 12) NEGAÇÃO DE TROCA: agente perguntou troca; "tenho não" -> possuiTroca=false (não repergunta / não vira 'sim').
  {
    const { turn } = makeConv("c12");
    await turn("Quero financiar", "ambiguous", [fin([txt("Combinado! Você tem algum carro para dar de troca?")])]);
    const c = await turn("tenho não", "ambiguous", [fin([txt("Sem problema! Seguimos sem troca então. Quer que eu veja uma parcela que encaixe?")])]);
    check("[12] 'tenho não' (troca) -> possuiTroca=false (não vira 'sim')", /false/.test(c.slots.possuiTroca ?? ""), JSON.stringify(c.slots.possuiTroca));
  }

  // 13) SELEÇÃO natural ("gostei do segundo"): final humano SEM atributo -> committed, sem degradar, seleciona o 2º.
  {
    const { turn } = makeConv("c13");
    await turn("Quero um carro popular", "ambiguous", [q(stockPopular()), fin([txt("Olha essas opções:"), offer(POPULAR), txt("Curtiu alguma?")])]);
    const c = await turn("gostei do segundo", "ambiguous", [fin([txt("Ótima escolha, Douglas! Quer que eu te mande as fotos ou já te passo as condições?")])]);
    check("[13] seleção natural -> committed, NÃO degrada, seleciona o 2º (Onix)", c.committed && !c.degraded && c.selKey === POP2.vehicleKey, `src=${c.src} degraded=${c.degraded} selKey=${c.selKey}`);
    check("[13] resposta acolhe sem citar atributo (sem km/preço)", has(c.outbox, "escolha") && !/\bkm\b|R\$|\d{2}\.\d{3}/.test(c.outbox), `text="${c.outbox}"`);
  }
  // 14) SELEÇÃO citando ATRIBUTO sem vehicle_details -> deny com feedback ESPECÍFICO -> cérebro acolhe -> committed.
  {
    const { turn } = makeConv("c14");
    await turn("Quero um carro popular", "ambiguous", [q(stockPopular()), fin([txt("Opções:"), offer(POPULAR), txt("Curtiu?")])]);
    const c = await turn("gostei do segundo", "ambiguous", [
      fin([txt("Ótima! Esse tem"), vref(POP2.vehicleKey, "km"), txt("rodados.")]),   // cita km SEM vehicle_details -> deny específico
      fin([txt("Ótima escolha! Quer as fotos ou as condições?")]),                    // acolhe -> ok
    ]);
    check("[14] feedback ESPECÍFICO de seleção ('acolher, não cite atributo')", c.policyFeedback.some((f) => /acolher a escolha|nao cite|não cite/i.test(f)), JSON.stringify(c.policyFeedback));
    check("[14] após o feedback, acolhe e COMMITA (não degrada)", c.committed && !c.degraded && has(c.outbox, "escolha"), `src=${c.src} text="${c.outbox}"`);
  }
  // 15) DISPONIBILIDADE ("tem Onix?"): em llmFirst, final só sai após stock_search relevante (força + retry).
  {
    const { turn } = makeConv("c15");
    await turn("Quero um carro popular", "ambiguous", [q(stockPopular()), fin([txt("Opções:"), offer(POPULAR), txt("Curtiu?")])]);
    const c = await turn("tem Onix?", "ambiguous", (_f, obs) => {
      if (!obs.some((o) => o.tool === "stock_search" && o.ok)) {
        // 1º tenta responder sem buscar -> engine força; depois busca Onix
        return obs.some((o) => o.tool === "stock_search") ? q({ tool: "stock_search", input: { modelo: "onix" } }) : fin([txt("Sim, temos Onix!")]);
      }
      return fin([txt("Temos sim! Olha:"), offer([POP2]), txt("Quer ver as fotos?")]);
    });
    const st = c.exec.find((x) => x.tool === "stock_search");
    check("[15] forçou stock_search(modelo=onix) antes do final", (st?.input as { modelo?: string })?.modelo === "onix" && c.committed, JSON.stringify(st?.input ?? null));
    check("[15] responde Onix (não o assunto anterior)", has(c.outbox, "Onix"), `text="${c.outbox}"`);
  }
  // 16) "não quero foto agora": acolhe e segue -> sem media, sem technical_fallback.
  {
    const { turn } = makeConv("c16");
    await turn("Quero um carro popular", "ambiguous", [q(stockPopular()), fin([txt("Opções:"), offer(POPULAR), txt("Quer fotos de alguma?")])]);
    const c = await turn("não quero foto agora", "ambiguous", [fin([txt("Sem problema! Não envio as fotos agora. Quer que eu te passe as condições ou veja outro modelo?")])]);
    check("[16] 'não quero foto' -> sem media, sem fallback, committed", c.committed && !c.hasMedia && !c.degraded && c.src !== "technical_fallback", `src=${c.src} media=${c.hasMedia}`);
  }

  // ── DIAG conv2: 3 correções de guarda (P0-B reasonCode/texto + POL-GROUND-YEAR). 8 testes exigidos pelo dono. ──
  // Tests 1-5 (P0-B) via engine, turno NÃO-foto:
  { const { turn } = makeConv("g1"); const c = await turn("beleza", "ambiguous", [fin([txt("Tranquilo! Quer que eu veja outro modelo pra você?")], [reply], "respect_photo_decline_and_offer_next_step")]);
    check("[dg1] reasonCode 'respect_photo_decline...' NÃO é bloqueado", c.committed && !c.degraded, `src=${c.src}`); }
  { const { turn } = makeConv("g2"); const c = await turn("não quero foto agora", "ambiguous", [fin([txt("Sem problema, não envio as fotos agora. Quer as condições ou outro modelo?")])]);
    check("[dg2] recusa 'não envio as fotos agora' PASSA (sem media, sem degradar)", c.committed && !c.degraded && !c.hasMedia, `src=${c.src} text="${c.outbox}"`); }
  { const { turn } = makeConv("g3"); const c = await turn("beleza", "ambiguous", [fin([txt("Quer que eu te envie as fotos ou prefere as condições?")])]);
    check("[dg3] OFERTA 'quer que eu te envie as fotos?' PASSA (sem send_media)", c.committed && !c.degraded && !c.hasMedia, `src=${c.src} text="${c.outbox}"`); }
  { const { turn } = makeConv("g4"); const c = await turn("beleza", "ambiguous", [fin([txt("Aqui estão as fotos!")]), fin([txt("Aqui estão as fotos!")]), fin([txt("Aqui estão as fotos!")]), fin([txt("Aqui estão as fotos!")])]);
    check("[dg4] 'Aqui estão as fotos' (sem send_media) continua BLOQUEADO", !has(c.outbox, "aqui estao as fotos") && c.policyFeedback.some((f) => /pediu fotos/i.test(f)), `text="${c.outbox}" fb=${JSON.stringify(c.policyFeedback)}`); }
  { const { turn } = makeConv("g5"); const c = await turn("beleza", "ambiguous", [fin([txt("Vou enviar as fotos pra você agora!")]), fin([txt("Vou enviar as fotos pra você agora!")]), fin([txt("Vou enviar as fotos pra você agora!")]), fin([txt("Vou enviar as fotos pra você agora!")])]);
    check("[dg5] 'Vou enviar as fotos' (sem send_media) continua BLOQUEADO", !has(c.outbox, "vou enviar as fotos") && c.policyFeedback.some((f) => /pediu fotos/i.test(f)), `text="${c.outbox}"`); }
  // Tests 6-8 (POL-GROUND-YEAR) via validateResponse direto:
  {
    const CRV = { vehicleKey: "revendamais:8065690", marca: "Honda", modelo: "CR-V", ano: 2010, preco: 62990, km: 158000, cambio: "Automatico", cor: "Preto", tipo: "suv" } as VehicleFact;
    const cat = buildTenantCatalog([CRV]); const ext = new CatalogClaimExtractor(cat);
    const st = { ...createInitialState({ conversationId: "gy", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }), vehicleContext: { selected: { kind: "vehicle", key: CRV.vehicleKey, label: "Honda CR-V 2010" } } } as never;
    const gfacts: QueryResult[] = [{ ok: true, tool: "vehicle_details", data: { vehicle: CRV }, source: "x" } as QueryResult];
    const gdec = { action: "reply", target: null, reasonCode: "r", reasonSummary: "", confidence: 0.9, decisionMutations: [], effectPlan: [], responsePlan: { guidance: "" }, policyChecks: [] } as unknown as TurnDecision;
    const gctx = (rel: string) => ({ state: st, turnId: "tg", leadMessage: "gostei do segundo", now: NOW, interpretation: { relation: rel }, tenantCatalog: cat, claimExtractor: ext } as never);
    const denies = (text: string, rel = "asks_vehicle_detail"): boolean => PolicyEngine.validateResponse({ draft: { parts: [{ type: "text", content: text }] }, text } as RenderedResponse, gfacts, gdec, gctx(rel)).some((v) => v.outcome === "deny");
    check("[dg6] 'Honda CR-V 2010' (label do selecionado aterrado) PASSA", !denies("Ótima escolha desse Honda CR-V 2010!"), "");
    check("[dg7] 'Honda CR-V 2020' (ano errado) continua BLOQUEADO", denies("Ele é um Honda CR-V 2020."), "");
    check("[dg8] ano solto inventado ('ele é 2020') continua BLOQUEADO", denies("Ele é 2020."), "");
  }

  console.log(`\n== F2.21: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
const stockPopular = (): CentralQueryCall => ({ tool: "stock_search", input: { popular: true } });
const stockSuv = (): CentralQueryCall => ({ tool: "stock_search", input: { tipo: "suv" } });
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
