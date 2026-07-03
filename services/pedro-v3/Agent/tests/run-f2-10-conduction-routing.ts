// ============================================================================
// F2.10 — R12-A: o SDR Conduction Frame GOVERNA os caminhos conversacionais comerciais
// (continuity/soft-buy/more_options/buy-signal) PELO COMPOSE, não mais pelo menu robótico
// legado (applySdrConduction). Testes E2E pelo conversation-engine REAL com sdrPolicy +
// compose overrides (FakeLlm) — provam ROTEAMENTO e INVARIANTES estruturais, não wording
// (qualidade conversacional é do eval real). Offline, determinístico, $0.
//   npx tsx tests/run-f2-10-conduction-routing.ts
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
import type { DecisionStep, QueryCall, QueryResult, TenantCatalog, TurnInterpretation, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-07-02T12:00:00.000Z";
const TENANT = "icom", AGENT = "aloan";
const FALLBACK = /desculpe a lentid/i;
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Estoque com atributos completos (câmbio/cor/km) p/ o grounding aterrar vehicle_details do selecionado.
const STOCK: VehicleFact[] = [
  { vehicleKey: "rm:1", marca: "Citroen", modelo: "C3", ano: 2015, preco: 47990, tipo: "suv", km: 116000, cambio: "Manual", cor: "Branco" } as VehicleFact,
  { vehicleKey: "rm:2", marca: "Honda", modelo: "CRV", ano: 2010, preco: 62990, tipo: "suv", km: 158000, cambio: "Automatico", cor: "Preto" } as VehicleFact,
  { vehicleKey: "rm:3", marca: "Peugeot", modelo: "2008", ano: 2021, preco: 66990, tipo: "suv", km: 80000, cambio: "Automatico", cor: "Branco" } as VehicleFact,
];
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: null, agentName: "Aloan", companyName: "Icom" });
const limits = { maxSteps: 4, totalTimeoutMs: 5000 };

// runQuery que atende stock_search (tipo/precoMax/excludeKeys/modelo/broad) e vehicle_details (por key),
// registrando as chamadas p/ provar que os filtros foram mantidos ("mais opções").
const calls: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  calls.push(call);
  if (call.tool === "vehicle_details") {
    const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey);
    return v
      ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult
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
function base(): ConversationState {
  return { ...createInitialState({ conversationId: "c", tenantId: TENANT, agentId: AGENT, leadId: "l", now: NOW }), turnNumber: 3 };
}
function withSlots(slots: Record<string, unknown>, over: Partial<ConversationState> = {}): ConversationState {
  const b = base();
  return { ...b, slots: { ...b.slots, ...(slots as ConversationState["slots"]) }, ...over };
}
function offerItems(keys: string[]): RenderedOfferItem[] {
  return keys.map((key, i) => { const v = STOCK.find((s) => s.vehicleKey === key)!; return { ordinal: i + 1, vehicleKey: key, marca: v.marca, modelo: v.modelo, ano: v.ano }; });
}
function offerCtx(keys: string[]): ConversationState["lastRenderedOfferContext"] {
  return { sourceTurnId: "t-prev", createdAt: NOW, items: offerItems(keys) };
}
function selected(key: string): ConversationState["vehicleContext"]["selected"] {
  const v = STOCK.find((s) => s.vehicleKey === key)!;
  return { kind: "vehicle", key, label: `${v.marca} ${v.modelo} ${v.ano}` };
}
function pendingObj(slot: PendingObjective["slot"]): PendingObjective {
  return { id: `o-${slot}`, type: "perguntou_dados", slot, askedAt: NOW, askedInTurnId: "t0", deliveredByEffectId: "e0", deliveryLevel: "accepted", expectedAnswerKinds: ["afirmacao"], status: "pending", attempts: 0 };
}
const agentTurn = (text: string): ConversationState["recentTurns"][number] => ({ role: "agent", text, at: NOW });

async function e2eRun(convId: string, seeded: ConversationState, leadText: string, opts: { llm?: FakeLlm; relation?: TurnRelation } = {}) {
  calls.length = 0;
  const clock = new FakeClock(NOW);
  const p = new InMemoryPersistence(clock, new FakeIdGen());
  (p as unknown as { states: Map<string, unknown> }).states.set(convId, { state: seeded, version: 1 });
  await p.tryInsert({ eventId: convId + "-e1", conversationId: convId, raw: { __redacted: true, text: leadText } as never, receivedAt: NOW });
  const interpretation: TurnInterpretation = { relation: opts.relation ?? "continues_offer" };
  const res = await runConversationTurn({
    persistence: p, clock, llm: opts.llm ?? new FakeLlm(), runQuery,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null,
    workerId: "w", turnId: convId + "-t", leaseTtlMs: 60_000,
    interpretation, tenantCatalog: catalog, claimExtractor: extractor,
    limits, maxValidationAttempts: 2, providerCapability: { send_message: "none", send_media: "none" } as never,
    sdrPolicy,
  });
  const state = (await p.load(convId))?.state ?? null;
  return { res, state };
}
const kinds = (r: { outbox: { kind: string }[] }): string[] => r.outbox.map((x) => x.kind);
const plannedSlots = (s: ConversationState | null): (string | null | undefined)[] => (s?.plannedObjectives ?? []).map((o) => o.slot);

// Overrides de compose (simulam o LLM lendo o guidance e produzindo UMA fala limpa) ──────────────────────────
const askTroca: ComposeOverride = () => ({ parts: [{ type: "text", content: "Que bom que você gostou! Você tem algum carro para dar na troca?" }] });
const askVisita: ComposeOverride = () => ({ parts: [{ type: "text", content: "Ele é uma ótima escolha mesmo! Quer agendar uma visita para ver de perto?" }] });
const askPagamento: ComposeOverride = () => ({ parts: [{ type: "text", content: "Perfeito! Você pensa em pagar à vista ou financiar?" }] });
const askInteresse: ComposeOverride = () => ({ parts: [{ type: "text", content: "Show, vamos agilizar! Qual modelo ou tipo de carro você procura?" }] });
const offerCompose: ComposeOverride = (_d, facts) => {
  const s = facts.find((f) => f.ok && f.tool === "stock_search");
  const keys = s && s.ok && s.tool === "stock_search" ? s.data.items.map((v) => v.vehicleKey) : [];
  return { parts: [{ type: "text", content: "Tenho mais estas opções:" }, { type: "vehicle_offer_list", vehicleKeys: keys }] };
};
const twoQuestions: ComposeOverride = () => ({ parts: [{ type: "text", content: "Você prefere à vista ou financiado? E tem carro na troca?" }] });
const reaskKnown: ComposeOverride = () => ({ parts: [{ type: "text", content: "Perfeito! Só me confirma: qual é o seu nome?" }] });
const withScript = (override: ComposeOverride): FakeLlm => {
  const llm = new FakeLlm();
  llm.setTurnScript([{ kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }], responsePlan: { guidance: "conduz" }, reasonCode: "reply", reasonSummary: "x", confidence: 1 } }], override);
  return llm;
};

async function main(): Promise<void> {
  console.log("\n=== F2.10 R12-A Conduction Routing (frame governa via compose) ===\n");

  // 1) Após lista, "gostei" -> continuity PELO COMPOSE (não menu robótico); avança 1 slot correto (troca pendente).
  {
    const st = withSlots(
      { nome: kn("Douglas"), interesse: kn("suv"), tipoVeiculo: kn("suv"), faixaPreco: kn({ max: 70000 }) },
      { lastRenderedOfferContext: offerCtx(["rm:1", "rm:2", "rm:3"]), vehicleContext: { focus: null, selected: selected("rm:2") }, currentObjective: pendingObj("possuiTroca"), recentTurns: [agentTurn("1. Citroen C3 ... 2. Honda CRV ... 3. Peugeot 2008 ...")] },
    );
    const { res, state } = await e2eRun("c1", st, "gostei", { llm: withScript(askTroca) });
    check("1 status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("1 reasonCode continuity_conduct", res.decision.reasonCode === "continuity_conduct", res.decision.reasonCode);
      check("1 PASSOU pelo compose (não terminal-safe/menu legado)", res.terminalSafe === false, `terminalSafe=${res.terminalSafe}`);
      check("1 texto = compose (não fallback robótico 'fotos/filtre')", /gostou/i.test(res.composedText) && !/filtre por valor, c[aâ]mbio ou ano/i.test(res.composedText), res.composedText);
      check("1 avança 1 slot correto: objetivo = possuiTroca", plannedSlots(state).every((s) => s === "possuiTroca") && plannedSlots(state).includes("possuiTroca"), JSON.stringify(plannedSlots(state)));
      check("1 exatamente 1 send_message, 0 send_media", kinds(res).filter((k) => k === "send_message").length === 1 && !kinds(res).includes("send_media"), JSON.stringify(kinds(res)));
    }
  }

  // 2) Após fotos, "bonito ele" -> continuity: NÃO manda foto de novo, NÃO menu, NÃO pergunta slot known.
  {
    const st = withSlots(
      { nome: kn("Douglas"), interesse: kn("suv"), tipoVeiculo: kn("suv"), faixaPreco: kn({ max: 70000 }), formaPagamento: kn("a_vista"), possuiTroca: kn(false) },
      { lastRenderedOfferContext: offerCtx(["rm:1", "rm:2", "rm:3"]), vehicleContext: { focus: null, selected: selected("rm:2") }, recentTurns: [agentTurn("Aqui estão as fotos do Honda CRV 2010! 📸")] },
    );
    const { res } = await e2eRun("c2", st, "bonito ele", { llm: withScript(askVisita) });
    check("2 status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("2 reasonCode continuity_conduct", res.decision.reasonCode === "continuity_conduct", res.decision.reasonCode);
      check("2 NÃO reenviou foto (0 send_media)", !kinds(res).includes("send_media"), JSON.stringify(kinds(res)));
      check("2 PASSOU pelo compose (não reperguntou slot known -> não terminal-safe)", res.terminalSafe === false, `terminalSafe=${res.terminalSafe}`);
      check("2 NÃO reapresenta / não técnico", !FALLBACK.test(res.composedText) && !/(sou o aloan|me chamo|meu nome|bem-?vindo)/i.test(res.composedText), res.composedText);
    }
  }

  // 3) "mais opções" -> MANTÉM filtros (tipo=suv, teto=70k, exclui já mostrado) e passa pelo compose/frame.
  {
    const st = withSlots(
      { nome: kn("Douglas"), interesse: kn("suv"), tipoVeiculo: kn("suv"), faixaPreco: kn({ max: 70000 }) },
      { lastRenderedOfferContext: offerCtx(["rm:1"]), currentObjective: pendingObj("possuiTroca"), recentTurns: [agentTurn("1. Citroen C3 2015 — R$ 47.990")] },
    );
    const { res } = await e2eRun("c3", st, "tem mais opções?", { llm: withScript(offerCompose) });
    check("3 status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("3 reasonCode offer_more_options*", /more_options/.test(res.decision.reasonCode), res.decision.reasonCode);
      check("3 PASSOU pelo compose (não terminal-safe)", res.terminalSafe === false, `terminalSafe=${res.terminalSafe}`);
      const search = calls.find((c) => c.tool === "stock_search");
      const inp = (search?.input ?? {}) as { tipo?: string; precoMax?: number; excludeKeys?: string[] };
      check("3 mantém filtro tipo=suv", inp.tipo === "suv", JSON.stringify(inp));
      check("3 mantém teto 70000", inp.precoMax === 70000, JSON.stringify(inp));
      check("3 exclui o já mostrado (rm:1)", Array.isArray(inp.excludeKeys) && inp.excludeKeys.includes("rm:1"), JSON.stringify(inp));
    }
  }

  // 4) "ok" com objetivo pendente (formaPagamento) -> conduz SEM repetir pergunta conhecida.
  {
    const st = withSlots(
      { nome: kn("Douglas"), interesse: kn("suv"), tipoVeiculo: kn("suv"), faixaPreco: kn({ max: 70000 }) },
      { currentObjective: pendingObj("formaPagamento"), recentTurns: [agentTurn("Você pensa em pagar à vista ou financiar?")] },
    );
    const { res, state } = await e2eRun("c4", st, "ok", { llm: withScript(askPagamento), relation: "answers_pending" });
    check("4 status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("4 reasonCode continuity_conduct", res.decision.reasonCode === "continuity_conduct", res.decision.reasonCode);
      check("4 conduz sem reperguntar slot known (não terminal-safe)", res.terminalSafe === false, `terminalSafe=${res.terminalSafe}`);
      check("4 objetivo = formaPagamento (pergunta enviada)", plannedSlots(state).every((s) => s === "formaPagamento") && plannedSlots(state).includes("formaPagamento"), JSON.stringify(plannedSlots(state)));
    }
  }

  // 5) buy-signal forte "quero comprar agora" -> caminho LLM+frame: acelera qualificação mínima (pede interesse),
  //    NÃO handoff silencioso.
  {
    const st = withSlots({ nome: kn("Douglas") }, { recentTurns: [agentTurn("Oi! Sou o Aloan.")] });
    const { res, state } = await e2eRun("c5", st, "quero comprar agora", { llm: withScript(askInteresse), relation: "answers_pending" });
    check("5 status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("5 NÃO handoff silencioso (action=reply)", res.decision.action === "reply", res.decision.action);
      check("5 0 efeito de handoff no outbox", !kinds(res).some((k) => /handoff/.test(k)), JSON.stringify(kinds(res)));
      check("5 acelera: pede o dado essencial que falta (interesse)", plannedSlots(state).includes("interesse"), JSON.stringify(plannedSlots(state)));
      check("5 passou pelo compose (não terminal-safe)", res.terminalSafe === false, `terminalSafe=${res.terminalSafe}`);
    }
  }

  // 6) INVARIANTES na rota de compose da continuidade:
  //    (a) 2 perguntas -> policy nega -> terminal-safe (≤1 pergunta imposto);
  //    (b) repergunta slot KNOWN -> policy nega -> terminal-safe (sem REASK_KNOWN_SLOT);
  //    (c) pergunta slot FALTANTE diferente do pendente -> objetivo reconciliado + supersede (sem OBJECTIVE_REPLACED solto).
  {
    const stA = withSlots({ nome: kn("Douglas"), interesse: kn("suv"), tipoVeiculo: kn("suv"), faixaPreco: kn({ max: 70000 }) }, { currentObjective: pendingObj("possuiTroca"), recentTurns: [agentTurn("Tem carro na troca?")] });
    const a = await e2eRun("c6a", stA, "gostei", { llm: withScript(twoQuestions) });
    check("6a duas perguntas -> terminal-safe (≤1 imposto pela policy)", a.res.status === "committed" && a.res.terminalSafe === true, `${a.res.status}/${a.res.status === "committed" ? a.res.terminalSafe : ""}`);

    const stB = withSlots({ nome: kn("Douglas"), interesse: kn("suv"), tipoVeiculo: kn("suv"), faixaPreco: kn({ max: 70000 }) }, { currentObjective: pendingObj("possuiTroca"), recentTurns: [agentTurn("Tem carro na troca?")] });
    const b = await e2eRun("c6b", stB, "gostei", { llm: withScript(reaskKnown) });
    check("6b repergunta slot KNOWN (nome) -> terminal-safe (sem REASK_KNOWN_SLOT)", b.res.status === "committed" && b.res.terminalSafe === true, `${b.res.status}/${b.res.status === "committed" ? b.res.terminalSafe : ""}`);

    const stC = withSlots({ nome: kn("Douglas"), interesse: kn("suv"), tipoVeiculo: kn("suv"), faixaPreco: kn({ max: 70000 }) }, { currentObjective: pendingObj("formaPagamento"), recentTurns: [agentTurn("À vista ou financiado?")] });
    const c = await e2eRun("c6c", stC, "gostei", { llm: withScript(askTroca) });
    check("6c pergunta slot FALTANTE (troca) -> objetivo = troca (reconciliado)", c.res.status === "committed" && plannedSlots(c.state).every((s) => s === "possuiTroca") && plannedSlots(c.state).includes("possuiTroca"), JSON.stringify(plannedSlots(c.state)));
    check("6c NÃO terminal-safe (pergunta válida de slot faltante)", c.res.status === "committed" && c.res.terminalSafe === false, `${c.res.status === "committed" ? c.res.terminalSafe : c.res.status}`);
  }

  console.log(`\n=== F2.10 CONDUCTION ROUTING: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", String((e as Error)?.message ?? e)); process.exit(1); });
