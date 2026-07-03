// ============================================================================
// F2.13 — R13 Inc2/C+D+E: CentralConversationEngine em SHADOW, offline determinístico ($0).
// Roda o ENGINE REAL (runCentralConversationTurn) com AgentBrain SCRIPTADO + FakeLlm (compose) + tools fake.
// Prova §8.1 (Brain/11) + persistência B (WM no mesmo CAS; two-phase accepted/delivered; isolamento; restart).
//   npx tsx tests/run-f2-13-central-shadow.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, reconcileAcceptedPhotoOutcomes, isCentralShadowMode, readBrainMode, trimToOneQuestion } from "../src/engine/central-engine.ts";
import { OutboxDispatcher, type EffectDispatcher } from "../src/engine/outbox-dispatcher.ts";
import { InMemoryEffectGate } from "../src/engine/effect-gate.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen, createInMemoryBacking } from "../src/adapters/persistence/in-memory-store.ts";
import type { InMemoryBacking } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import type { ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { loadPersistedWorkingMemory } from "../src/engine/working-memory.ts";
import type { TenantBusinessInfoSource, TenantBusinessInfo } from "../src/engine/tenant-business-info.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { AgentBrainDecision, AgentBrainStep, CentralQueryCall } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, TurnRelation } from "../src/domain/decision.ts";
import type { EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { Persistence, UnitOfWorkContext } from "../src/domain/ports.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { SdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TENANT = "ecb26258", AGENT = "d4fd5c38";
const NOW = "2026-07-03T12:00:00.000Z";
const STOCK: VehicleFact[] = [
  { vehicleKey: "rm:1", marca: "Nissan", modelo: "Kicks", ano: 2018, preco: 74990, tipo: "suv", km: 60000, cambio: "Automatico", cor: "Prata" } as VehicleFact,
  { vehicleKey: "rm:2", marca: "Honda", modelo: "CRV", ano: 2010, preco: 62990, tipo: "suv", km: 158000, cambio: "Automatico", cor: "Preto" } as VehicleFact,
  { vehicleKey: "rm:3", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 89990, tipo: "suv", km: 70000, cambio: "Automatico", cor: "Branco" } as VehicleFact,
  { vehicleKey: "rm:4", marca: "Volkswagen", modelo: "Gol", ano: 2016, preco: 44990, tipo: "hatch", km: 90000, cambio: "Manual", cor: "Prata" } as VehicleFact,
];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const PHOTOS: Record<string, string[]> = { "rm:1": ["k1a", "k1b"], "rm:2": ["c2a", "c2b"], "rm:3": ["r3a"] };

class FixedPreparer implements TurnContextPreparer {
  relation: TurnRelation = "ambiguous";
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> {
    return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor };
  }
}
class FakeBusinessInfo implements TenantBusinessInfoSource {
  constructor(public info: TenantBusinessInfo) {}
  async getBusinessInfo(): Promise<TenantBusinessInfo> { return this.info; }
}
const NO_STORE_INFO: TenantBusinessInfo = { address: null, hours: null, unit: null, source: "tenant_runtime_config" };
const REAL_STORE_INFO: TenantBusinessInfo = { address: "Avenida das Nações, bairro Centro", hours: "Seg a Sex das 8h às 18h", unit: "Matriz", source: "tenant_business_info_table" };
const SDR_POLICY: SdrQualificationPolicy = {
  orderedSlots: ["nome", "interesse", "faixaPreco", "formaPagamento", "possuiTroca", "interesseVisita"],
  questions: { nome: "Qual é o seu nome?", interesse: "Qual carro você procura?" },
  agentName: "Aloan",
  introductionText: "Sou o Aloan, consultor da Icom Motors.",
};

let toolCalls: QueryCall[] = [];
let crmName = "MARIA DA SILVA SECRETA";
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  toolCalls.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { tipo?: string; modelo?: string; precoMax?: number; excludeKeys?: string[] };
    let items = STOCK.slice();
    if (inp.tipo) items = items.filter((v) => (v as VehicleFact & { tipo?: string }).tipo === inp.tipo);
    if (inp.precoMax != null) items = items.filter((v) => v.preco <= inp.precoMax!);
    if (Array.isArray(inp.excludeKeys)) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_details") {
    const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey);
    return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult
            : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") {
    const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? "";
    const ids = PHOTOS[key] ?? [];
    return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ids }, source: "fake" } as QueryResult;
  }
  if (call.tool === "crm_read") {
    return { ok: true, tool: "crm_read", data: { leadId: (call.input as { leadId: string }).leadId, name: crmName }, source: "fake" } as QueryResult;
  }
  throw new Error("fake runQuery: tool não suportada");
};

// ── builders de passos do cérebro ─────────────────────────────────────────────────────────────────────────────
const q = (call: CentralQueryCall): AgentBrainStep => ({ kind: "query", call });
function finalStep(over: Partial<AgentBrainDecision> & { guidance: string; effects?: ProposedEffectPlan[] }): AgentBrainStep {
  const decision: AgentBrainDecision = {
    reasonCode: over.reasonCode ?? "reply", reasonSummary: over.reasonSummary ?? "resposta", confidence: over.confidence ?? 0.9,
    responsePlan: { guidance: over.guidance },
    proposedEffects: over.effects ?? [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan],
    memoryMutations: over.memoryMutations ?? [], stateMutations: over.stateMutations ?? [],
  };
  return { kind: "final", decision };
}
const sendMediaPlan = (vehicleKey: string, photoIds: string[]): ProposedEffectPlan => ({
  kind: "send_media", planId: "media", order: 1, vehicleKey, photoIds,
  onSuccess: [{ op: "mark_photos_sent", effectId: "placeholder", vehicleKey, photoIds }],
} as ProposedEffectPlan);

// compose overrides
const plainText: ComposeOverride = (d) => ({ parts: [{ type: "text", content: d.responsePlan.guidance }] });
const offerList: ComposeOverride = (_d, facts) => {
  const s = facts.find((f) => f.ok && f.tool === "stock_search");
  const keys = s && s.ok && s.tool === "stock_search" ? s.data.items.map((v) => v.vehicleKey) : [];
  return { parts: [{ type: "text", content: "Tenho estas opções:" }, { type: "vehicle_offer_list", vehicleKeys: keys }, { type: "text", content: "Quer ver as fotos de alguma?" }] };
};

// ── harness de 1 turno ────────────────────────────────────────────────────────────────────────────────────────
type RunOpts = {
  persistence: Persistence; clock: FakeClock; brain: ScriptedAgentBrain; llm: FakeLlm; businessInfo: TenantBusinessInfoSource;
  preparer: FixedPreparer; conv: string; turnId: string; leadText: string; leadId?: string | null;
  tenant?: string; agent?: string; allowedTools?: string[]; brainMaxSteps?: number;
  sdrPolicy?: SdrQualificationPolicy;
  proposeTimeoutMs?: number; eventSeq: number;
};
async function runTurn(o: RunOpts) {
  toolCalls = [];
  await o.persistence.tryInsert({ eventId: `${o.conv}-e${o.eventSeq}`, conversationId: o.conv, raw: redact({ text: o.leadText }) as never, receivedAt: o.clock.now() });
  o.clock.advance(1000);
  return runCentralConversationTurn({
    persistence: o.persistence, clock: o.clock, brain: o.brain, llm: o.llm, runQuery, businessInfo: o.businessInfo,
    contextPreparer: o.preparer, conversationId: o.conv, tenantId: o.tenant ?? TENANT, agentId: o.agent ?? AGENT, leadId: o.leadId ?? null,
    workerId: "w", turnId: o.turnId, leaseTtlMs: 60_000, portalPromptSha256: "sha-fake",
    limits: { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: o.proposeTimeoutMs ?? 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: o.brainMaxSteps ?? 4, allowedTools: o.allowedTools,
    sdrPolicy: o.sdrPolicy,
    providerCapability: { send_message: "none", send_media: "none" },
  });
}
function freshPersistence(backing?: InMemoryBacking) { return new InMemoryPersistence(new FakeClock(NOW), new FakeIdGen(), backing); }
function llmWith(override: ComposeOverride): FakeLlm { const l = new FakeLlm(); l.setTurnScript([], override); return l; }

// Simula o ciclo de receipt (accepted p/ todos; delivered opcional p/ send_media) via commitEffectOutcome REAL +
// promoção accepted-safe da WM (applyAcceptedPhotoActionOutcome). Replica o dispatcher SEM despachar.
async function settleAccepted(persistence: Persistence, clock: FakeClock, conv: string): Promise<void> {
  while (true) {
    const claimed = await persistence.claimOutbox(conv, "rcpt", 60_000, 25);
    if (claimed.length === 0) break;
    for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
      const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `pm-${rec.effectId}`, at: clock.now() };
      const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
      await commitEffectOutcome({ persistence, clock, conversationId: conv, effectId: rec.effectId, result });
      if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: conv, effectId: rec.effectId, result });
    }
  }
}
const wmOf = (s: ConversationState | null) => loadPersistedWorkingMemory(s?.workingMemory).memory;

async function main(): Promise<void> {
  console.log("== F2.13 Central Conversation Engine (shadow) ==");

  // [0] flag
  check("[0] flag central_shadow lida", readBrainMode({ PEDRO_V3_BRAIN_MODE: "central_shadow" }) === "central_shadow" && isCentralShadowMode({ PEDRO_V3_BRAIN_MODE: "central_shadow" }) === true && isCentralShadowMode({}) === false);

  // [1] SAUDAÇÃO: zero tool.
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setTurnScript([finalStep({ guidance: "Oi! Como posso ajudar você hoje?" })]);
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c1", turnId: "c1-t1", leadText: "oi bom dia", eventSeq: 1 });
    check("[1] saudação commit + zero tool", r.status === "committed" && toolCalls.length === 0, `${r.status} tools=${toolCalls.length}`);
    check("[1] saudação zero send_media", r.status === "committed" && !r.outbox.some((o) => o.kind === "send_media"));
  }

  // [2] LOJA: só tenant_business_info (endereço real). Não chama estoque/foto.
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setTurnScript([q({ tool: "tenant_business_info", input: { topic: "address" } }), finalStep({ guidance: `Nossa loja fica em ${REAL_STORE_INFO.address}. Posso ajudar com um carro?` })]);
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(REAL_STORE_INFO), preparer: prep, conv: "c2", turnId: "c2-t1", leadText: "onde fica a loja?", eventSeq: 1 });
    check("[2] loja: só tenant_business_info", r.status === "committed" && toolCalls.length === 0 && r.toolObservations.length === 1 && r.toolObservations[0].tool === "tenant_business_info" && r.toolObservations[0].ok === true, `tools=${toolCalls.map((c) => c.tool)}`);
    check("[2] loja: endereço real na resposta", r.status === "committed" && r.composedText.includes("Avenida das Nações"));
    check("[2] loja: zero estoque/foto", toolCalls.length === 0);
  }

  // [2b] LOJA sem fonte factual -> honesto (NOT_CONFIGURED), NUNCA inventa.
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setResponder((_f, obs, i) => i === 0 ? q({ tool: "tenant_business_info", input: { topic: "address" } })
      : finalStep({ guidance: obs.some((o) => o.tool === "tenant_business_info" && !o.ok) ? "Vou confirmar o endereço certinho e já te retorno, tá?" : "Endereço: (inventado)" }));
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c2b", turnId: "c2b-t1", leadText: "qual o endereço?", eventSeq: 1 });
    check("[2b] loja sem fonte: honesto (não inventa)", r.status === "committed" && r.composedText.includes("confirmar") && !r.composedText.includes("inventado"));
  }

  // [3] ESTOQUE: stock_search. [10] exatamente UMA decisão. [18/19] EffectGate OFF / zero dispatch.
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    prep.relation = "direction_change";
    brain.setTurnScript([q({ tool: "stock_search", input: { tipo: "suv" } }), finalStep({ guidance: "Achei estas SUVs pra você:" })]);
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(offerList), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c3", turnId: "c3-t1", leadText: "quero uma suv", eventSeq: 1 });
    check("[3] estoque chamou stock_search", r.status === "committed" && toolCalls.some((c) => c.tool === "stock_search") && toolCalls.every((c) => c.tool === "stock_search"), `${r.status}`);
    check("[3] não-terminal-safe (oferta aterrada)", r.status === "committed" && r.terminalSafe === false, r.status === "committed" ? r.decision.reasonSummary : "");
    check("[10] exatamente UMA decisão (1 send_message)", r.status === "committed" && r.outbox.filter((o) => o.kind === "send_message").length === 1);
    check("[18/19] EffectGate OFF: outbox pending, nada despachado", r.status === "committed" && r.outbox.every((o) => o.status === "pending"));
  }

  // [3b] "mais opções" não pode finalizar sem consultar estoque novamente.
  {
    const p = freshPersistence(); const clock = new FakeClock(NOW); const prep = new FixedPreparer();
    const firstBrain = new ScriptedAgentBrain();
    firstBrain.setTurnScript([q({ tool: "stock_search", input: { tipo: "suv", precoMax: 80_000 } }), finalStep({ guidance: "Encontrei estas opções." })]);
    const first = await runTurn({ persistence: p, clock, brain: firstBrain, llm: llmWith(offerList), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c3b", turnId: "c3b-t1", leadText: "quero SUV até 80 mil", eventSeq: 1 });
    check("[3b] oferta inicial registrada", first.status === "committed" && first.composedText.includes("Kicks") && first.composedText.includes("CRV"));

    const moreBrain = new ScriptedAgentBrain();
    moreBrain.setResponder((frame, observations, index) => {
      if (index === 0) return finalStep({ guidance: "Tenho outras opções." }); // tentativa inválida: sem tool
      const stock = observations.find((o) => o.tool === "stock_search" && o.ok);
      if (!stock) return q({ tool: "stock_search", input: { tipo: "suv", excludeKeys: [...(frame.workingMemory.lastOffer?.vehicleKeys ?? [])] } });
      return finalStep({ guidance: "Encontrei mais esta opção." });
    });
    const more = await runTurn({ persistence: p, clock, brain: moreBrain, llm: llmWith(offerList), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c3b", turnId: "c3b-t2", leadText: "Tem outras?", eventSeq: 2 });
    check("[3b] final sem tool foi recusado e stock_search executou", more.status === "committed" && toolCalls.some((call) => call.tool === "stock_search"), more.status);
    check("[3b] mais opções lista somente veículo novo", more.status === "committed" && more.composedText.includes("Renegade") && !more.composedText.includes("Kicks") && !more.composedText.includes("CRV"), more.status === "committed" ? more.composedText : more.status);
  }

  // [3c] A pergunta realmente enviada cria objetivo; a resposta curta é ligada ao slot antes do cérebro.
  {
    const p = freshPersistence(); const clock = new FakeClock(NOW); const prep = new FixedPreparer();
    const askBrain = new ScriptedAgentBrain();
    askBrain.setTurnScript([finalStep({ guidance: "Para continuar, qual é o seu nome?" })]);
    const asked = await runTurn({ persistence: p, clock, brain: askBrain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c3c", turnId: "c3c-t1", leadText: "tem SUV?", eventSeq: 1, sdrPolicy: SDR_POLICY });
    await settleAccepted(p, clock, "c3c");
    const pending = (await p.load("c3c"))?.state.currentObjective;
    check("[3c] pergunta enviada ativou objetivo nome no accepted", asked.status === "committed" && pending?.slot === "nome" && pending.status === "pending", JSON.stringify(pending));

    const answerBrain = new ScriptedAgentBrain();
    answerBrain.setResponder((frame) => finalStep({
      guidance: frame.workingMemory.funnel.known.includes("nome")
        ? "Prazer, Douglas. Agora me diga qual tipo de carro você procura."
        : "Qual é o seu nome?",
    }));
    const answered = await runTurn({ persistence: p, clock, brain: answerBrain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c3c", turnId: "c3c-t2", leadText: "Douglas", eventSeq: 2, sdrPolicy: SDR_POLICY });
    const after = (await p.load("c3c"))?.state;
    check("[3c] resposta curta vinculada ao nome antes do cérebro", after?.slots.nome.status === "known" && after.slots.nome.value === "Douglas", JSON.stringify(after?.slots.nome));
    check("[3c] nome conhecido não é reperguntado", answered.status === "committed" && !/qual.{0,20}nome/i.test(answered.composedText), answered.status === "committed" ? answered.composedText : answered.status);
  }

  // [4] DETALHE: vehicle_details quando necessário.
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    prep.relation = "asks_vehicle_detail";
    brain.setTurnScript([q({ tool: "vehicle_details", input: { vehicleKey: "rm:2" } }), finalStep({ guidance: "Esse tem câmbio automático e está em bom estado." })]);
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c4", turnId: "c4-t1", leadText: "e o cambio dele?", eventSeq: 1 });
    check("[4] detalhe chamou vehicle_details", r.status === "committed" && toolCalls.some((c) => c.tool === "vehicle_details"));
  }

  // [6] PEDIR FOTO: resolve + propõe send_media (dispatch OFF). [5-setup] deixa lastPhotoAction p/ o recall.
  const photoBacking = createInMemoryBacking();
  {
    const p = freshPersistence(photoBacking); const clock = new FakeClock(NOW); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    // seed inicial: uma oferta anterior de SUV (Kicks) selecionada.
    const seed = createInitialState({ conversationId: "cph", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    seed.vehicleContext.selected = { kind: "vehicle", key: "rm:1", label: "Nissan Kicks 2018" };
    seed.lastRenderedOfferContext = { sourceTurnId: "t0", createdAt: NOW, items: [{ ordinal: 1, vehicleKey: "rm:1", marca: "Nissan", modelo: "Kicks", ano: 2018 }] };
    const s0 = p.begin(); s0.casState("cph", 0, seed); const seeded = s0.commit(); if (!seeded.ok) throw new Error("seed cph");
    brain.setTurnScript([q({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: "rm:1" } } }), finalStep({ guidance: "Aqui estão as fotos do Nissan Kicks 2018:", effects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan, sendMediaPlan("rm:1", PHOTOS["rm:1"])] })]);
    const r = await runTurn({ persistence: p, clock, brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "cph", turnId: "cph-t1", leadText: "manda as fotos", eventSeq: 1 });
    check("[6] foto: resolve + send_media", r.status === "committed" && toolCalls.some((c) => c.tool === "vehicle_photos_resolve") && r.outbox.some((o) => o.kind === "send_media"), `${r.status}`);
    // [13/14] receipt accepted -> lastPhotoAction (WM), NÃO photoLedger. Depois delivered -> photoLedger.
    await settleAccepted(p, clock, "cph");
    const after = (await p.load("cph"))?.state ?? null;
    const wm = wmOf(after);
    check("[13] accepted: WM.lastPhotoAction = Kicks; ledger VAZIO", wm.lastPhotoAction?.vehicleKey === "rm:1" && wm.lastPhotoAction?.label === "Nissan Kicks 2018" && Object.keys(after?.photoLedger.sentByVehicle ?? {}).length === 0, JSON.stringify(wm.lastPhotoAction));
    check("[13] appliedAcceptedEffectIds registrado (idempotência independente)", (after?.appliedAcceptedEffectIds ?? []).some((id) => id.endsWith(":media")));
    // delivered posterior: photoLedger avança; lastPhotoAction NÃO reaplica.
    const mediaRec = (await p.listOutbox("cph")).find((o) => o.kind === "send_media")!;
    const dResult: EffectResult = { status: "succeeded", effectId: mediaRec.effectId, receipt: { effectId: mediaRec.effectId, level: "delivered", at: clock.now(), perItem: PHOTOS["rm:1"].map((id) => ({ photoId: id, status: "succeeded" as const })) } };
    await commitEffectOutcome({ persistence: p, clock, conversationId: "cph", effectId: mediaRec.effectId, result: dResult });
    const wmBeforeDeliveredWm = wmOf((await p.load("cph"))?.state ?? null);
    const del = await applyAcceptedPhotoActionOutcome({ persistence: p, conversationId: "cph", effectId: mediaRec.effectId, result: dResult });
    const after2 = (await p.load("cph"))?.state ?? null;
    check("[14] delivered: photoLedger avança pelos photoIds", (after2?.photoLedger.sentByVehicle["rm:1"] ?? []).length === 2);
    check("[14] delivered: lastPhotoAction NÃO reaplica (idempotente)", del.ok === true && del.applied === false && JSON.stringify(wmOf(after2).lastPhotoAction) === JSON.stringify(wmBeforeDeliveredWm.lastPhotoAction));
  }

  // [5] LEMBRAR foto anterior: zero tool E zero send_media (usa a WM). Continua na MESMA conversa (photoBacking).
  {
    const p = freshPersistence(photoBacking); const clock = new FakeClock("2026-07-03T12:30:00.000Z"); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setResponder((frame) => finalStep({ guidance: `Você pediu as fotos do ${frame.workingMemory.lastPhotoAction?.label ?? "(desconhecido)"}.` }));
    const r = await runTurn({ persistence: p, clock, brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "cph", turnId: "cph-t2", leadText: "qual carro eu pedi as fotos mesmo?", eventSeq: 2 });
    check("[5] recall: zero tool E zero send_media", r.status === "committed" && toolCalls.length === 0 && !r.outbox.some((o) => o.kind === "send_media"), `tools=${toolCalls.length}`);
    check("[5] recall: responde 'Nissan Kicks 2018' da memória", r.status === "committed" && r.composedText.includes("Nissan Kicks 2018"), r.status === "committed" ? r.composedText : "");
  }

  // [E5] recall DETERMINÍSTICO: se o cérebro responde VAGO numa pergunta de memória, o engine nomeia o veículo lembrado.
  {
    const p = freshPersistence(photoBacking); const clock = new FakeClock("2026-07-03T12:45:00.000Z"); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setResponder(() => finalStep({ guidance: "Foi o veículo que te enviei antes, um ótimo carro." })); // NÃO nomeia
    const r = await runTurn({ persistence: p, clock, brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "cph", turnId: "cph-t3", leadText: "qual carro eu pedi as fotos?", eventSeq: 3 });
    check("[E5] recall determinístico nomeia o veículo lembrado quando o cérebro é vago", r.status === "committed" && r.composedText.includes("Nissan Kicks 2018") && toolCalls.length === 0 && !r.outbox.some((o) => o.kind === "send_media"), r.status === "committed" ? r.composedText.slice(0, 50) : r.status);
  }

  // [E6] Reconciliação DURÁVEL (audit Codex): a promoção da WM falha (transiente) no dispatch -> a mídia NÃO é
  //      reenviada e o rastro durável (send_media succeeded sem appliedAcceptedEffectIds) fica; restart + reconcile
  //      promove a WM SEM 2º dispatch.
  {
    const backing = createInMemoryBacking();
    const clock = new FakeClock(NOW);
    class FailWmPromotion extends InMemoryPersistence {
      commitWorkingMemoryOutcome(): { ok: true; applied: boolean; version: number } | { ok: false; reason: string } { return { ok: false, reason: "transient_wm_failure" }; }
    }
    const p1 = new FailWmPromotion(clock, new FakeIdGen(), backing);
    const seed = createInitialState({ conversationId: "cr6", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    seed.vehicleContext.selected = { kind: "vehicle", key: "rm:2", label: "Honda CRV 2010" };
    const s0 = p1.begin(); s0.casState("cr6", 0, seed); s0.commit();
    const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setTurnScript([q({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: "rm:2" } } }), finalStep({ guidance: "Aqui estão as fotos 📸", effects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan, sendMediaPlan("rm:2", PHOTOS["rm:2"])] })]);
    await runTurn({ persistence: p1, clock, brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "cr6", turnId: "cr6-t1", leadText: "manda as fotos", eventSeq: 1 });
    // dispatch REAL (gate ativo + dispatcher fake accepted) — a mídia é despachada; a promoção da WM falha (logged).
    let dispatchCount = 0;
    const fakeDispatcher: EffectDispatcher = { async dispatch(rec: OutboxRecord) { dispatchCount++; return { status: "succeeded", effectId: rec.effectId, receipt: { effectId: rec.effectId, level: "accepted", at: clock.now() } }; } };
    const gate = new InMemoryEffectGate(); gate.setActiveMode("cr6", true);
    await new OutboxDispatcher(p1, clock, fakeDispatcher, gate, "d").dispatchConversation("cr6");
    const wmAfterFail = wmOf((await p1.load("cr6"))?.state ?? null);
    const mediaRec1 = (await p1.listOutbox("cr6")).find((o) => o.kind === "send_media")!;
    check("[E6] falha de promoção NÃO reenvia mídia (send_media succeeded) + WM NÃO avança", wmAfterFail.lastPhotoAction === null && mediaRec1.status === "succeeded" && dispatchCount === 2, `wm=${wmAfterFail.lastPhotoAction} media=${mediaRec1.status} disp=${dispatchCount}`);
    // RESTART: nova persistence REAL no MESMO backing -> reconcilia o rastro durável -> promove SEM 2º dispatch.
    const p2 = new InMemoryPersistence(clock, new FakeIdGen(), backing);
    const rec = await reconcileAcceptedPhotoOutcomes({ persistence: p2, conversationId: "cr6" });
    const wmAfterReconcile = wmOf((await p2.load("cr6"))?.state ?? null);
    const mediaRec2 = (await p2.listOutbox("cr6")).find((o) => o.kind === "send_media")!;
    check("[E6] restart+reconcile promove a WM (Honda CRV 2010) SEM 2º dispatch", rec.reconciled === 1 && wmAfterReconcile.lastPhotoAction?.label === "Honda CRV 2010" && mediaRec2.status === "succeeded" && dispatchCount === 2, `${JSON.stringify(rec)} label=${wmAfterReconcile.lastPhotoAction?.label}`);
    // idempotência: reconciliar de novo não faz nada (já promovido).
    const rec2 = await reconcileAcceptedPhotoOutcomes({ persistence: p2, conversationId: "cr6" });
    check("[E6] reconcile idempotente (nada a fazer 2ª vez)", rec2.reconciled === 0 && rec2.pending === 0);
  }

  // [7] MAIS OPÇÕES preserva filtros (tipo) + exclusões.
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setTurnScript([q({ tool: "stock_search", input: { tipo: "suv", excludeKeys: ["rm:1", "rm:2"] } }), finalStep({ guidance: "Mais estas opções:" })]);
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(offerList), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c7", turnId: "c7-t1", leadText: "tem mais opções?", eventSeq: 1 });
    const ss = toolCalls.find((c) => c.tool === "stock_search")?.input as { tipo?: string; excludeKeys?: string[] } | undefined;
    check("[7] mais opções preserva tipo + exclui mostrados", r.status === "committed" && ss?.tipo === "suv" && Array.isArray(ss?.excludeKeys) && ss!.excludeKeys!.includes("rm:1"));
  }

  // [8] TOOL PROIBIDA não executa (allowlist sem vehicle_photos_resolve).
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setResponder((_f, obs, i) => i === 0 ? q({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: "rm:1" } } })
      : finalStep({ guidance: "Não consegui as fotos agora, mas posso te ajudar com os detalhes." }));
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c8", turnId: "c8-t1", leadText: "foto", allowedTools: ["stock_search", "vehicle_details", "tenant_business_info"], eventSeq: 1 });
    const executed = toolCalls.some((c) => c.tool === "vehicle_photos_resolve");
    const forbiddenObs = r.status === "committed" && r.toolObservations.some((o) => o.tool === "vehicle_photos_resolve" && !o.ok && o.error.code === "FORBIDDEN");
    check("[8] tool proibida NÃO executa + observação FORBIDDEN", r.status === "committed" && !executed && forbiddenObs);
  }

  // [E1] send_media ESPÚRIO (bloco não pede foto) é REMOVIDO pelo engine (invariante 8), mesmo se o cérebro propor.
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setTurnScript([finalStep({ guidance: "Que bom que gostou!", effects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan, sendMediaPlan("rm:1", PHOTOS["rm:1"])] })]);
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "ce1", turnId: "ce1-t1", leadText: "gostei muito", eventSeq: 1 });
    check("[E1] send_media espúrio removido (bloco não pede foto)", r.status === "committed" && !r.outbox.some((o) => o.kind === "send_media"), r.status);
  }
  // [E2] trimToOneQuestion: mantém a 1ª pergunta + sentenças não-interrogativas; descarta perguntas extras.
  {
    const one = trimToOneQuestion("Tenho opções. Quer ver fotos? Ou prefere filtrar por preço?");
    const zero = trimToOneQuestion("Aqui está o carro. Bonito, né.");
    check("[E2] trimToOneQuestion mantém 1 pergunta", (one.match(/\?/g) ?? []).length === 1 && one.includes("Tenho opções") && one.includes("Quer ver fotos?") && !one.includes("prefere filtrar"));
    check("[E2] trimToOneQuestion não altera texto com ≤1 pergunta", (zero.match(/\?/g) ?? []).length === 0);
  }

  // [E3] compose do LLM FALHA grounding (cita 'Fusca' inexistente) -> executor DETERMINÍSTICO renderiza a oferta
  //      aterrada dos fatos do turno, NÃO terminal_safe.
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setTurnScript([q({ tool: "stock_search", input: { tipo: "suv" } }), finalStep({ guidance: "aqui vão as opções" })]);
    const ungrounded: ComposeOverride = () => ({ parts: [{ type: "text", content: "Temos o Fusca por R$ 5.000, quer ver?" }] });
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(ungrounded), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "ce3", turnId: "ce3-t1", leadText: "tem suv?", eventSeq: 1 });
    check("[E3] compose ungrounded -> executor determinístico (oferta), NÃO terminal_safe", r.status === "committed" && r.terminalSafe === false && /Kicks|CRV|Renegade/.test(r.composedText), r.status === "committed" ? `ts=${r.terminalSafe} resp=${r.composedText.slice(0, 50)}` : r.status);
  }
  // [E4] compose FALHA grounding num turno de FOTO -> executor determinístico MANTÉM o send_media (não cancela).
  {
    const p = freshPersistence(); const clock = new FakeClock(NOW); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    const seed = createInitialState({ conversationId: "ce4", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    seed.vehicleContext.selected = { kind: "vehicle", key: "rm:2", label: "Honda CRV 2010" };
    const s0 = p.begin(); s0.casState("ce4", 0, seed); s0.commit();
    brain.setTurnScript([q({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: "rm:2" } } }), finalStep({ guidance: "enviando", effects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan, sendMediaPlan("rm:2", PHOTOS["rm:2"])] })]);
    const ungrounded: ComposeOverride = () => ({ parts: [{ type: "text", content: "Aqui está o seu Fusca, olha que lindo!" }] });
    const r = await runTurn({ persistence: p, clock, brain, llm: llmWith(ungrounded), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "ce4", turnId: "ce4-t1", leadText: "manda as fotos", eventSeq: 1 });
    check("[E4] compose ungrounded em foto -> determinístico mantém send_media, NÃO terminal_safe", r.status === "committed" && r.terminalSafe === false && r.outbox.some((o) => o.kind === "send_media"), r.status === "committed" ? `ts=${r.terminalSafe}` : r.status);
  }

  // [9a] LIMITE do loop: cérebro nunca finaliza -> fallback seguro (não trava, não silêncio).
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setResponder(() => q({ tool: "stock_search", input: { tipo: "suv" } })); // sempre query
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c9", turnId: "c9-t1", leadText: "oi", brainMaxSteps: 3, eventSeq: 1 });
    check("[9a] loop limite: committed com fallback + brainSteps=3", r.status === "committed" && r.brainSteps === 3 && r.composedText.length > 0, `${r.status} steps=${r.status === "committed" ? r.brainSteps : "?"}`);
  }
  // [9b] TIMEOUT do passo do cérebro -> fallback seguro.
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setResponder(() => new Promise<AgentBrainStep>((res) => setTimeout(() => res(finalStep({ guidance: "tarde demais" })), 400)));
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c9b", turnId: "c9b-t1", leadText: "oi", proposeTimeoutMs: 60, eventSeq: 1 });
    check("[9b] timeout do cérebro: committed com fallback", r.status === "committed" && r.composedText.length > 0, `${r.status}`);
  }

  // [11/17] NENHUMA tool fala com o lead + ZERO PII: crm_read devolve nome; nome NUNCA na resposta nem na WM.
  {
    const p = freshPersistence(); const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setResponder((_f, _o, i) => i === 0 ? q({ tool: "crm_read", input: { leadId: "lead-xyz" } }) : finalStep({ guidance: "Legal! Qual tipo de carro você procura?" }));
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "c11", turnId: "c11-t1", leadText: "oi", leadId: "lead-xyz", eventSeq: 1 });
    const after = (await p.load("c11"))?.state ?? null;
    const wmStr = JSON.stringify(after?.workingMemory);
    check("[11] resposta = compose (tool não fala com o lead)", r.status === "committed" && !r.composedText.includes("SECRETA"));
    check("[17] zero PII na WM persistida (crm sem nome)", !wmStr.includes("SECRETA") && !wmStr.includes("MARIA"), wmStr.slice(0, 120));
    check("[17] telemetria de crm sem nome", r.status === "committed" && r.toolTelemetry.every((t) => JSON.stringify(t).indexOf("SECRETA") < 0));
  }

  // [12a] CAS: dois UnitOfWork na MESMA versão -> o segundo falha (mecanismo que o commit do engine usa).
  {
    const p = freshPersistence();
    const seed = createInitialState({ conversationId: "ccas", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    const s0 = p.begin(); s0.casState("ccas", 0, seed); s0.commit();
    const a = p.begin(); a.casState("ccas", 1, seed); const ra = a.commit();
    const b = p.begin(); b.casState("ccas", 1, seed); const rb = b.commit();
    check("[12a] CAS concorrente: 1º ok, 2º falha", ra.ok === true && rb.ok === false);
  }
  // [12b] Engine trata commit_failed: libera o claim (inbox re-claimável), sem persistir decisão.
  {
    const backing = createInMemoryBacking();
    const p = new FailCommitOnce(new FakeClock(NOW), new FakeIdGen(), backing);
    const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setTurnScript([finalStep({ guidance: "oi" })]);
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "ccf", turnId: "ccf-t1", leadText: "oi", eventSeq: 1 });
    const pending = await p.pendingCount("ccf");
    check("[12b] commit_failed: status + claim liberado (re-claimável)", r.status === "commit_failed" && pending === 1, `${r.status} pending=${pending}`);
  }

  // [15] RESTART: nova instância de persistence + engine sobre o MESMO backing durável -> memória recuperada.
  {
    const backing = createInMemoryBacking();
    // instância 1: roda um turno que grava conversationSummary na WM.
    const p1 = freshPersistence(backing); const brain1 = new ScriptedAgentBrain(); const prep1 = new FixedPreparer();
    brain1.setTurnScript([finalStep({ guidance: "Prazer! Vou te ajudar a achar um carro.", memoryMutations: [{ op: "set_conversation_summary", summary: "lead quer SUV automática até 90k", turnId: "cr-t1" }] })]);
    const r1 = await runTurn({ persistence: p1, clock: new FakeClock(NOW), brain: brain1, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep1, conv: "cr", turnId: "cr-t1", leadText: "oi", eventSeq: 1 });
    check("[15] turno 1 commitou", r1.status === "committed");
    // "destrói" a instância (dropa a referência) e cria uma NOVA persistence + NOVO engine sobre o mesmo backing.
    const p2 = freshPersistence(backing); const brain2 = new ScriptedAgentBrain(); const prep2 = new FixedPreparer();
    let seenSummary = "";
    brain2.setResponder((frame) => { seenSummary = frame.workingMemory.conversationSummary; return finalStep({ guidance: "Perfeito, continuando." }); });
    const r2 = await runTurn({ persistence: p2, clock: new FakeClock("2026-07-03T13:00:00.000Z"), brain: brain2, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep2, conv: "cr", turnId: "cr-t2", leadText: "e ai?", eventSeq: 2 });
    check("[15] restart: WM recuperada do backing (não de estado global)", r2.status === "committed" && seenSummary === "lead quer SUV automática até 90k", seenSummary);
  }

  // [16] CROSS-TENANT / CROSS-AGENT: estado de outra conta falha fechado (não vaza, não commita).
  {
    const p = freshPersistence();
    const seed = createInitialState({ conversationId: "cx", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    const s0 = p.begin(); s0.casState("cx", 0, seed); s0.commit();
    const brain = new ScriptedAgentBrain(); const prep = new FixedPreparer();
    brain.setTurnScript([finalStep({ guidance: "oi" })]);
    const r = await runTurn({ persistence: p, clock: new FakeClock(NOW), brain, llm: llmWith(plainText), businessInfo: new FakeBusinessInfo(NO_STORE_INFO), preparer: prep, conv: "cx", turnId: "cx-t9", leadText: "oi", tenant: "OUTRO-TENANT", eventSeq: 1 });
    check("[16] cross-tenant: falha fechada (ownership mismatch)", r.status === "commit_failed" && /ownership mismatch/.test(r.reason), `${r.status} ${r.status === "commit_failed" ? r.reason : ""}`);
  }

  console.log(`\n== F2.13: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}

// Persistence que FALHA o 1º commit (simula CAS concorrente real no ponto de commit do engine), depois normal.
class FailCommitOnce extends InMemoryPersistence {
  private failedOnce = false;
  begin(_context?: UnitOfWorkContext) {
    const uow = super.begin();
    const self = this;
    return {
      ...uow,
      commit() {
        if (!self.failedOnce) { self.failedOnce = true; return { ok: false as const, reason: "CAS conflito (injected concurrent commit)" }; }
        return uow.commit();
      },
    };
  }
}

main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
