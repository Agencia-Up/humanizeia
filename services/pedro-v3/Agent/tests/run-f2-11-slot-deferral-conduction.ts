// ============================================================================
// F2.11 — R12-B: deferimento de slot + condução natural quando o lead IGNORA uma pergunta do funil.
// E2E pelo conversation-engine REAL in-memory com sdrPolicy + currentObjective SEMEADO (o deferimento lê o
// objetivo ATIVO, que em produção é ativado por receipt) + compose overrides (FakeLlm só estrutura). Prova os
// invariantes A–J nos 4 caminhos comerciais (runTurn / explicit_offer / more_options / continuity_conduct) e
// nas respostas de preço/detalhe. Sem efeito externo real. Offline, determinístico, $0.
//   npx tsx tests/run-f2-11-slot-deferral-conduction.ts
// ============================================================================
import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import type { ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState, PendingObjective, RenderedOfferItem } from "../src/domain/conversation-state.ts";
import type { QueryCall, QueryResult, TenantCatalog, TurnInterpretation, TurnRelation } from "../src/domain/decision.ts";
import type { AnswerKind, SlotName, VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-07-02T15:00:00.000Z";
const TENANT = "icom", AGENT = "aloan";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const STOCK: VehicleFact[] = [
  { vehicleKey: "rm:1", marca: "Citroen", modelo: "C3 Aircross", ano: 2015, preco: 47990, tipo: "suv", km: 116000, cambio: "Manual", cor: "Branco" } as VehicleFact,
  { vehicleKey: "rm:2", marca: "Honda", modelo: "CRV", ano: 2010, preco: 62990, tipo: "suv", km: 158000, cambio: "Automatico", cor: "Preto" } as VehicleFact,
  { vehicleKey: "rm:3", marca: "Peugeot", modelo: "2008", ano: 2021, preco: 66990, tipo: "suv", km: 80000, cambio: "Automatico", cor: "Branco" } as VehicleFact,
  { vehicleKey: "rm:4", marca: "Volkswagen", modelo: "Golf", ano: 2016, preco: 59990, tipo: "hatch", km: 90000, cambio: "Automatico", cor: "Prata" } as VehicleFact,
];
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: null, agentName: "Aloan", companyName: "Icom" });
const limits = { maxSteps: 4, totalTimeoutMs: 5000 };

const calls: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  calls.push(call);
  if (call.tool === "vehicle_details") {
    const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey);
    return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult
             : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
  }
  if (call.tool === "stock_search") {
    const inp = call.input as { tipo?: string; modelo?: string; precoMax?: number; excludeKeys?: string[]; broad?: boolean };
    let items = STOCK.slice();
    if (inp.tipo) items = items.filter((v) => (v as VehicleFact & { tipo?: string }).tipo === inp.tipo);
    if (inp.modelo) { const m = normalizeText(inp.modelo); items = items.filter((v) => normalizeText(v.modelo).includes(m)); }
    if (typeof inp.precoMax === "number") items = items.filter((v) => v.preco <= inp.precoMax!);
    if (Array.isArray(inp.excludeKeys)) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp }, source: "fake" } as QueryResult;
  }
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};

// ── Helpers de estado ───────────────────────────────────────────────────────────────────────────────────────
const kn = (value: unknown) => ({ status: "known" as const, value, confidence: 1, updatedAt: NOW });
function expectedKinds(slot: SlotName): AnswerKind[] {
  if (slot === "nome") return ["nome"];
  if (["possuiTroca", "conheceLoja", "interesseVisita"].includes(slot)) return ["boolean", "afirmacao", "negacao"];
  if (["interesse", "tipoVeiculo", "veiculoTroca"].includes(slot)) return ["modelo"];
  if (["faixaPreco", "entrada", "parcelaDesejada"].includes(slot)) return ["valor"];
  if (slot === "diaHorario") return ["data"];
  return ["afirmacao"];
}
function pendingObj(slot: PendingObjective["slot"], deferrals = 0): PendingObjective {
  return { id: `o-${slot}`, type: "perguntou_dados", slot, askedAt: NOW, askedInTurnId: "t0", deliveredByEffectId: "e0", deliveryLevel: "accepted", expectedAnswerKinds: expectedKinds(slot as SlotName), status: "pending", attempts: 0, deferrals };
}
function base(): ConversationState {
  return { ...createInitialState({ conversationId: "c", tenantId: TENANT, agentId: AGENT, leadId: "l", now: NOW }), turnNumber: 3 };
}
function state(over: {
  slots?: Record<string, unknown>; objective?: PendingObjective | null; offer?: string[]; selected?: string; agentTurns?: string[];
}): ConversationState {
  const b = base();
  const selectedV = over.selected ? STOCK.find((s) => s.vehicleKey === over.selected)! : null;
  return {
    ...b,
    slots: { ...b.slots, ...(over.slots as ConversationState["slots"]) },
    currentObjective: over.objective ?? null,
    lastRenderedOfferContext: over.offer ? { sourceTurnId: "t-prev", createdAt: NOW, items: over.offer.map((key, i) => { const v = STOCK.find((s) => s.vehicleKey === key)!; return { ordinal: i + 1, vehicleKey: key, marca: v.marca, modelo: v.modelo, ano: v.ano } as RenderedOfferItem; }) } : null,
    vehicleContext: { focus: null, selected: selectedV ? { kind: "vehicle", key: selectedV.vehicleKey, label: `${selectedV.marca} ${selectedV.modelo} ${selectedV.ano}` } : null },
    recentTurns: (over.agentTurns ?? ["Oi! Sou o Aloan, consultor da Icom."]).map((t) => ({ role: "agent" as const, text: t, at: NOW })),
  };
}

async function e2eRun(convId: string, seeded: ConversationState, leadText: string, opts: { llm?: FakeLlm; relation?: TurnRelation } = {}) {
  calls.length = 0;
  const clock = new FakeClock(NOW);
  const p = new InMemoryPersistence(clock, new FakeIdGen());
  (p as unknown as { states: Map<string, unknown> }).states.set(convId, { state: seeded, version: 1 });
  await p.tryInsert({ eventId: convId + "-e1", conversationId: convId, raw: { __redacted: true, text: leadText } as never, receivedAt: NOW });
  const interpretation: TurnInterpretation = { relation: opts.relation ?? "answers_pending" };
  const res = await runConversationTurn({
    persistence: p, clock, llm: opts.llm ?? new FakeLlm(), runQuery,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null,
    workerId: "w", turnId: convId + "-t", leaseTtlMs: 60_000,
    interpretation, tenantCatalog: catalog, claimExtractor: extractor,
    limits, maxValidationAttempts: 2, providerCapability: { send_message: "none", send_media: "none" } as never,
    sdrPolicy,
  });
  const st = (await p.load(convId))?.state ?? null;
  return { res, state: st };
}
const kinds = (r: { outbox: { kind: string }[] }): string[] => r.outbox.map((x) => x.kind);
const plannedSlots = (s: ConversationState | null): (string | null | undefined)[] => (s?.plannedObjectives ?? []).map((o) => o.slot);
const slot = (s: ConversationState | null, name: SlotName) => (s?.slots as Record<string, { status?: string; value?: unknown }>)?.[name];
const asksName = (text: string) => /\bqual\s+(é\s+)?(o\s+)?seu\s+nome\b|\bseu\s+nome\b|\bcomo\s+(você\s+)?se\s+chama\b/i.test(text);

// Overrides de compose (o LLM lê o guidance e produz UMA fala limpa) ─────────────────────────────────────────
const offerNoName: ComposeOverride = (_d, facts) => {
  const s = facts.find((f) => f.ok && f.tool === "stock_search");
  const keys = s && s.ok && s.tool === "stock_search" ? s.data.items.map((v) => v.vehicleKey) : [];
  return { parts: [{ type: "text", content: "Tenho estas opções pra você:" }, { type: "vehicle_offer_list", vehicleKeys: keys }, { type: "text", content: "Quer ver as fotos de alguma?" }] };
};
const askInteresse: ComposeOverride = () => ({ parts: [{ type: "text", content: "Show! Qual modelo ou tipo de carro você procura?" }] });
const askFaixa: ComposeOverride = () => ({ parts: [{ type: "text", content: "Legal! Qual faixa de valor você pretende investir?" }] });
const answerPriceNoName: ComposeOverride = (_d, facts) => {
  const s = facts.find((f) => f.ok && f.tool === "vehicle_details");
  const key = s && s.ok && s.tool === "vehicle_details" ? s.data.vehicle.vehicleKey : "rm:2";
  return { parts: [{ type: "text", content: "O valor dele é " }, { type: "money_ref", role: "vehicle_price", source: { kind: "vehicle_fact", vehicleKey: key } }, { type: "text", content: ". Quer ver as fotos?" }] };
};
const ackNext: ComposeOverride = () => ({ parts: [{ type: "text", content: "Perfeito! Você pensa em pagar à vista ou financiar?" }] });
const announceHandoff: ComposeOverride = () => ({ parts: [{ type: "text", content: "Show, tá tudo certo! Vou te passar agora para um consultor especialista finalizar com você, tá?" }] });
const justAck: ComposeOverride = () => ({ parts: [{ type: "text", content: "Perfeito, combinado!" }] });
const insistName: ComposeOverride = () => ({ parts: [{ type: "text", content: "Antes, me confirma: qual é o seu nome?" }] });
// override que DESOBEDECE e tenta perguntar nome mesmo no defer (testa o backstop determinístico):
const offerButInsistName: ComposeOverride = (_d, facts) => {
  const s = facts.find((f) => f.ok && f.tool === "stock_search");
  const keys = s && s.ok && s.tool === "stock_search" ? s.data.items.map((v) => v.vehicleKey) : [];
  return { parts: [{ type: "text", content: "Tenho estas opções:" }, { type: "vehicle_offer_list", vehicleKeys: keys }, { type: "text", content: "Mas antes, qual é o seu nome?" }] };
};
const withScript = (override: ComposeOverride): FakeLlm => {
  const llm = new FakeLlm();
  llm.setTurnScript([{ kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }], responsePlan: { guidance: "conduz" }, reasonCode: "reply", reasonSummary: "x", confidence: 1 } }], override);
  return llm;
};
const withCompose = (override: ComposeOverride): FakeLlm => { const llm = new FakeLlm(); llm.setTurnScript([], override); return llm; };

async function main(): Promise<void> {
  console.log("\n=== F2.11 R12-B Slot Deferral & Conduction (A–J) ===\n");

  // A. nome pendente + "Douglas" -> nome known, objetivo RESOLVIDO (runTurn).
  {
    const st = state({ slots: {}, objective: pendingObj("nome") });
    const { res, state: after } = await e2eRun("cA", st, "Douglas", { llm: withScript(askInteresse) });
    check("A status committed", res.status === "committed", res.status);
    check("A nome capturado (known)", slot(after, "nome")?.status === "known" && slot(after, "nome")?.value === "Douglas", JSON.stringify(slot(after, "nome")));
    check("A objetivo nome RESOLVIDO (satisfied, não superseded)", after?.currentObjective?.slot === "nome" && after?.currentObjective?.status === "satisfied", `${after?.currentObjective?.slot}/${after?.currentObjective?.status}`);
  }

  // B. nome pendente + "tem SUV automático?" -> responde estoque; NÃO vira nome; NÃO repete nome; DEFERIMENTO.
  {
    const st = state({ slots: {}, objective: pendingObj("nome") });
    const { res, state: after } = await e2eRun("cB", st, "tem SUV automático?", { llm: withCompose(offerNoName) });
    check("B status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("B respondeu estoque (explicit_offer, não terminal-safe)", res.decision.reasonCode === "explicit_offer" && res.terminalSafe === false, `${res.decision.reasonCode}/${res.terminalSafe}`);
      check("B 'tem SUV automático?' NÃO virou nome", slot(after, "nome")?.status !== "known", JSON.stringify(slot(after, "nome")));
      check("B NÃO repergunta nome no texto", !asksName(res.composedText), res.composedText);
      check("B DEFERIMENTO registrado (currentObjective nome, deferrals=1)", after?.currentObjective?.slot === "nome" && after?.currentObjective?.status === "pending" && after?.currentObjective?.deferrals === 1, `${after?.currentObjective?.status}/def=${after?.currentObjective?.deferrals}`);
    }
  }

  // B-backstop. mesmo caso, mas o LLM DESOBEDECE e tenta perguntar nome -> backstop determinístico REMOVE a pergunta.
  {
    const st = state({ slots: {}, objective: pendingObj("nome") });
    const { res } = await e2eRun("cBk", st, "tem SUV automático?", { llm: withCompose(offerButInsistName) });
    check("B-backstop: LLM insistiu no nome -> backstop tira a pergunta (texto NÃO pergunta nome)", res.status === "committed" && !asksName(res.composedText), res.status === "committed" ? res.composedText : res.status);
  }

  // C. após outro desvio comercial (deferrals=1) -> AVANÇA (supersede nome), sem ficar preso (explicit_offer).
  {
    const st = state({ slots: { interesse: kn("suv"), tipoVeiculo: kn("suv") }, objective: pendingObj("nome", 1) });
    const { res, state: after } = await e2eRun("cC", st, "tem hatch automático?", { llm: withCompose(askFaixa) });
    check("C status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("C AVANÇOU: objetivo nome superseded (não travou)", after?.currentObjective?.slot === "nome" && after?.currentObjective?.status === "superseded", `${after?.currentObjective?.slot}/${after?.currentObjective?.status}`);
      check("C novo objetivo = faixaPreco (slot faltante diferente)", plannedSlots(after).includes("faixaPreco"), JSON.stringify(plannedSlots(after)));
      check("C NÃO repergunta nome", !asksName(res.composedText), res.composedText);
    }
  }

  // D. "Mostra mais opções" -> NUNCA vira nome; preserva filtros/teto/exclusões (more_options).
  {
    const st = state({ slots: { interesse: kn("suv"), tipoVeiculo: kn("suv"), faixaPreco: kn({ max: 70000 }) }, objective: pendingObj("nome"), offer: ["rm:1"] });
    const { res, state: after } = await e2eRun("cD", st, "Mostra mais opções", { llm: withCompose(offerNoName) });
    check("D status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("D reasonCode offer_more_options*", /more_options/.test(res.decision.reasonCode), res.decision.reasonCode);
      check("D 'Mostra mais opções' NÃO virou nome", slot(after, "nome")?.status !== "known");
      const s = calls.find((c) => c.tool === "stock_search");
      const inp = (s?.input ?? {}) as { tipo?: string; precoMax?: number; excludeKeys?: string[] };
      check("D preserva filtro tipo=suv + teto 70000 + exclui rm:1", inp.tipo === "suv" && inp.precoMax === 70000 && Array.isArray(inp.excludeKeys) && inp.excludeKeys.includes("rm:1"), JSON.stringify(inp));
    }
  }

  // E. troca pendente + "não tenho carro para troca" -> possuiTroca=false, RESOLVIDO, nunca pergunta dados da troca.
  {
    const st = state({ slots: { nome: kn("Douglas"), interesse: kn("suv") }, objective: pendingObj("possuiTroca") });
    const { res, state: after } = await e2eRun("cE", st, "não tenho carro para troca", { llm: withScript(ackNext) });
    check("E status committed", res.status === "committed", res.status);
    check("E possuiTroca=false", slot(after, "possuiTroca")?.status === "known" && slot(after, "possuiTroca")?.value === false, JSON.stringify(slot(after, "possuiTroca")));
    check("E objetivo troca RESOLVIDO (satisfied)", after?.currentObjective?.slot === "possuiTroca" && after?.currentObjective?.status === "satisfied", `${after?.currentObjective?.status}`);
    if (res.status === "committed") check("E NÃO pergunta dados do veículo de troca", !/modelo.*troca|ano.*troca|quilometragem.*troca/i.test(res.composedText), res.composedText);
  }

  // F. troca pendente + pergunta de PREÇO do selecionado -> responde primeiro, NÃO inventa que a troca foi respondida.
  {
    const st = state({ slots: { nome: kn("Douglas"), interesse: kn("suv") }, objective: pendingObj("possuiTroca"), selected: "rm:2", offer: ["rm:2"] });
    const { res, state: after } = await e2eRun("cF", st, "qual o valor dele?", { llm: withScript(answerPriceNoName), relation: "asks_vehicle_detail" });
    check("F status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("F respondeu o preço (não terminal-safe)", res.terminalSafe === false && /62\.?990|R\$/.test(res.composedText), res.composedText);
      check("F NÃO inventou que a troca foi respondida (possuiTroca segue unknown)", slot(after, "possuiTroca")?.status !== "known", JSON.stringify(slot(after, "possuiTroca")));
      check("F objetivo troca segue pendente (deferido, não resolvido)", after?.currentObjective?.slot === "possuiTroca" && after?.currentObjective?.status === "pending", `${after?.currentObjective?.status}`);
    }
  }

  // G. buy signal forte + funil incompleto -> acelera com o dado essencial faltante (interesse); SEM handoff (runTurn).
  {
    const st = state({ slots: { nome: kn("Douglas") }, objective: null });
    const { res, state: after } = await e2eRun("cG", st, "quero comprar agora", { llm: withScript(askInteresse) });
    check("G status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("G SEM handoff silencioso (action=reply, 0 efeito handoff)", res.decision.action === "reply" && !kinds(res).some((k) => /handoff/.test(k)), `${res.decision.action}/${JSON.stringify(kinds(res))}`);
      check("G acelera: pede o essencial faltante (interesse)", plannedSlots(after).includes("interesse"), JSON.stringify(plannedSlots(after)));
    }
  }

  // H. buy signal forte + funil completo -> handoff elegível, mas ANÚNCIO ao lead precede a transferência (runTurn).
  {
    const st = state({ slots: { nome: kn("Douglas"), interesse: kn("suv"), faixaPreco: kn({ max: 80000 }), formaPagamento: kn("a_vista"), possuiTroca: kn(false), interesseVisita: kn(true), diaHorario: kn("sábado") }, objective: null });
    const { res } = await e2eRun("cH", st, "quero fechar", { llm: withScript(announceHandoff) });
    check("H status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("H NÃO transferência silenciosa (action=reply, 0 efeito handoff)", res.decision.action === "reply" && !kinds(res).some((k) => /handoff/.test(k)), `${res.decision.action}/${JSON.stringify(kinds(res))}`);
      check("H ANÚNCIO ao lead precede a transferência (texto avisa)", /consultor|especialista|passar|transferir|finalizar/i.test(res.composedText), res.composedText);
    }
  }

  // I. pergunta já respondida (nome known) + LLM tenta reperguntar -> POLICY nega -> zero REASK_KNOWN_SLOT (terminal-safe).
  {
    const st = state({ slots: { nome: kn("Douglas"), interesse: kn("suv") }, objective: null });
    const { res } = await e2eRun("cI", st, "ok", { llm: withCompose(insistName) });
    check("I reperguntar slot KNOWN é BLOQUEADO (terminal-safe, zero REASK_KNOWN_SLOT)", res.status === "committed" && res.terminalSafe === true, `${res.status}/${res.status === "committed" ? res.terminalSafe : ""}`);
  }

  // J. resposta sem pergunta -> nenhum novo objetivo persistido.
  {
    const st = state({ slots: { nome: kn("Douglas"), interesse: kn("suv") }, objective: null });
    const { res, state: after } = await e2eRun("cJ", st, "ok", { llm: withCompose(justAck) });
    check("J status committed", res.status === "committed", res.status);
    check("J nenhuma pergunta -> nenhum objetivo novo persistido", plannedSlots(after).length === 0, JSON.stringify(plannedSlots(after)));
  }

  // K. continuity_conduct (soft-buy "gostei") com objetivo pendente -> defere, não repergunta o slot ignorado.
  {
    const st = state({ slots: { interesse: kn("suv"), tipoVeiculo: kn("suv") }, objective: pendingObj("nome"), offer: ["rm:1", "rm:2"], selected: "rm:2" });
    const { res, state: after } = await e2eRun("cK", st, "gostei", { llm: withCompose(justAck), relation: "continues_offer" });
    check("K continuity com nome pendente -> defere (não repergunta nome, deferrals=1)", res.status === "committed" && res.decision.reasonCode === "continuity_conduct" && !asksName(res.composedText) && after?.currentObjective?.deferrals === 1, `${res.status === "committed" ? res.decision.reasonCode : res.status}/def=${after?.currentObjective?.deferrals}`);
  }

  // L. RAJADA: "não tenho troca | quero ver SUV" com troca pendente -> resolve troca=false E conduz, sem travar.
  {
    const st = state({ slots: { nome: kn("Douglas") }, objective: pendingObj("possuiTroca") });
    const { res, state: after } = await e2eRun("cL", st, "não tenho troca\nquero ver SUV até 70 mil", { llm: withCompose(offerNoName) });
    check("L rajada: possuiTroca=false capturado no bloco inteiro", slot(after, "possuiTroca")?.value === false, JSON.stringify(slot(after, "possuiTroca")));
    check("L rajada: conduz (committed, não terminal-safe)", res.status === "committed" && res.terminalSafe === false, res.status);
  }

  console.log(`\n=== F2.11 SLOT DEFERRAL: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", String((e as Error)?.message ?? e)); process.exit(1); });
