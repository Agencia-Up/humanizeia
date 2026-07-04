// ============================================================================
// F2.17 — REPLAY OFFLINE DETERMINÍSTICO dos 11 turnos do smoke (audit smoke #2). Engine central REAL (singleAuthor)
// + AgentBrain SCRIPTADO (reproduz os ERROS do smoke #2: T3 pergunta em vez de listar, T7 escreve a CHAVE crua,
// T9 sem excludeKeys) — e os INVARIANTES corrigem tudo. Prova em outbox.payload.text + tool EXECUTADA + estado + WM:
//   zero vehicleKey no texto; T3 contém lista; T7 nomeia "Honda CRV 2010"; T9 executa excludeKeys; T11 persiste
//   visita+sábado; T8 extrai endereço+horário reais do prompt (com regra de saudação "Se o horário for..." como armadilha).
//   npx tsx tests/run-f2-17-smoke-replay.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { extractLeadSlots } from "../src/engine/lead-extraction.ts";
import { loadPersistedWorkingMemory } from "../src/engine/working-memory.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { applyAcceptedPhotoActionOutcome } from "../src/engine/central-engine.ts";
import { PromptTenantBusinessInfoSource, extractTenantBusinessFacts } from "../src/engine/tenant-business-info.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { AgentBrainStep, AgentBrainDecision, CentralQueryCall } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", CONV = "replay", NOW = "2026-07-04T09:00:00.000Z", SHA = "sha-replay";

// Estoque: SUV automático <= 90 mil. O SEGUNDO da lista = Honda CRV 2010 (p/ "gostei do segundo" -> CRV). +Jeep p/ T9.
const PEUGEOT: VehicleFact = { vehicleKey: "revendamais:7906712", marca: "Peugeot", modelo: "2008", ano: 2021, preco: 66990, km: 80000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const CRV: VehicleFact = { vehicleKey: "revendamais:8065690", marca: "Honda", modelo: "CRV", ano: 2010, preco: 62990, km: 158000, cambio: "Automatico", cor: "Preto", tipo: "suv" };
const JEEP: VehicleFact = { vehicleKey: "revendamais:9042878", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 89990, km: 70000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const STOCK = [PEUGEOT, CRV, JEEP];
const ALL_KEYS = STOCK.map((v) => v.vehicleKey);
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

// Prompt REAL-like: regra de SAUDAÇÃO com "horário" (armadilha do smoke #2) + Bloco 9 rotulado.
const PROMPT = [
  "Você é o Aloan, consultor da Icom Motors em Taubaté.",
  'Regra de saudação: Se o horário for entre 00h e 11h59 → "Bom dia!". Se for entre 12h e 17h59 → "Boa tarde!".',
  "Seja cordial e objetivo. Conduza o funil de vendas.",
  "Bloco 9 — Informações da loja:",
  "Endereço: Avenida Charles Schnneider, 1234, Jardim das Bandeiras, Taubaté SP",
  "Horário: Segunda a Sábado das 9h às 19h",
].join("\n");
const RUNTIME_CFG = { companyName: "Icom Motors", promptText: PROMPT } as never;
const EXPECTED_ADDR = "Avenida Charles Schnneider, 1234, Jardim das Bandeiras, Taubaté SP";
const EXPECTED_HOURS = "Segunda a Sábado das 9h às 19h";

// runQuery que FILTRA por tipo/cambio/precoMax/excludeKeys e CAPTURA a chamada EXECUTADA (prova P0-4).
const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { tipo?: string; cambio?: string; precoMax?: number; excludeKeys?: string[] };
    let items = STOCK.slice();
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (inp.cambio === "automatic") items = items.filter((v) => /automat/i.test(v.cambio ?? ""));
    if (inp.precoMax != null) items = items.filter((v) => v.preco <= inp.precoMax!);
    if (Array.isArray(inp.excludeKeys)) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  throw new Error("runQuery: tool não suportada " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm {
  composeCalls = 0;
  async proposeNextQueryOrFinal(): Promise<never> { throw new Error("single-author não deve chamar propose"); }
  async compose(): Promise<ResponseDraft> { this.composeCalls++; return { parts: [{ type: "text", content: "[SPY]" }] }; }
}
class RelPreparer implements TurnContextPreparer {
  relation: TurnRelation = "ambiguous";
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> {
    return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor };
  }
}

// builders
const txt = (content: string): ResponsePart => ({ type: "text", content });
const vref = (v: VehicleFact, field: "marca" | "modelo" | "ano" | "km" | "cambio" | "cor"): ResponsePart => ({ type: "vehicle_ref", vehicleKey: v.vehicleKey, field });
const offer = (vs: VehicleFact[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: vs.map((v) => v.vehicleKey) });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const media = (v: VehicleFact): ProposedEffectPlan => ({ kind: "send_media", planId: "media", order: 1, vehicleKey: v.vehicleKey, photoIds: ["p1", "p2"], onSuccess: [{ op: "mark_photos_sent", effectId: "x", vehicleKey: v.vehicleKey, photoIds: ["p1", "p2"] }] } as ProposedEffectPlan);
const q = (call: CentralQueryCall): AgentBrainStep => ({ kind: "query", call });
function fin(parts: ResponsePart[], effects?: ProposedEffectPlan[]): AgentBrainStep {
  const decision: AgentBrainDecision = { reasonCode: "reply", reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects ?? [reply], memoryMutations: [], stateMutations: [] };
  return { kind: "final", decision };
}
const stockCall = (): CentralQueryCall => ({ tool: "stock_search", input: { tipo: "suv", cambio: "automatic", precoMax: 90000 } });

type Cap = { i: number; lead: string; outbox: string; src: string; degraded: boolean; ts: boolean; selKey: string | null; selLabel: string | null; offerCount: number; inst: { topic: string; status: string }[]; wmPhotoLabel: string | null; slots: Record<string, string>; hasMedia: boolean; exec: QueryCall[] };
const brain = new ScriptedAgentBrain();
const preparer = new RelPreparer();
const clock = new FakeClock(NOW);
const persistence = new InMemoryPersistence(clock, new FakeIdGen());
const businessInfo = new PromptTenantBusinessInfoSource(RUNTIME_CFG);
let seq = 0;
function slotSummary(state: unknown): Record<string, string> {
  const out: Record<string, string> = {}; const slots = (state as { slots?: Record<string, { status?: string; value?: unknown }> })?.slots ?? {};
  for (const k of Object.keys(slots)) { const s = slots[k]; if (s?.status && s.status !== "unknown") out[k] = `${s.status}:${JSON.stringify(s.value ?? null)}`; }
  return out;
}
async function turn(lead: string, relation: TurnRelation, script: AgentBrainStep[]): Promise<Cap> {
  seq += 1; executed.length = 0; preparer.relation = relation; brain.setTurnScript(script);
  await persistence.tryInsert({ eventId: `${CONV}-e${seq}`, conversationId: CONV, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${CONV}-t${seq}`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo, contextPreparer: preparer,
    conversationId: CONV, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 5, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 5, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true,
  });
  const execSnapshot = [...executed];   // chamadas EXECUTADAS deste turno (executed é resetado no próximo turno)
  // simula receipt accepted (SEM dispatch) -> promove lastPhotoAction.
  while (true) {
    const claimed = await persistence.claimOutbox(CONV, "w", 120_000, 25);
    if (claimed.length === 0) break;
    for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
      const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
      const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
      await commitEffectOutcome({ persistence, clock, conversationId: CONV, effectId: rec.effectId, result });
      if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: CONV, effectId: rec.effectId, result });
    }
  }
  clock.advance(30000);
  const after = (await persistence.load(CONV))?.state;
  const outbox = (await persistence.listOutbox(CONV)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  const wm = loadPersistedWorkingMemory(after?.workingMemory).memory;
  return {
    i: seq, lead, outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", src: r.status === "committed" ? r.responseSource : r.status,
    degraded: r.status === "committed" && r.degraded, ts: r.status === "committed" && r.terminalSafe,
    selKey: (after as { vehicleContext?: { selected?: { key?: string } } } | undefined)?.vehicleContext?.selected?.key ?? null,
    selLabel: (after as { vehicleContext?: { selected?: { label?: string } } } | undefined)?.vehicleContext?.selected?.label ?? null,
    offerCount: after?.lastRenderedOfferContext?.items.length ?? 0, inst: r.status === "committed" ? [...r.institutionalResolved] : [],
    wmPhotoLabel: wm.lastPhotoAction?.label ?? null, slots: slotSummary(after), hasMedia: outbox.some((o) => o.kind === "send_media"), exec: execSnapshot,
  };
}
const has = (s: string, n: string): boolean => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
const anyKey = (s: string): string | null => ALL_KEYS.find((k) => s.includes(k)) ?? null;
const statusOf = (c: Cap, t: string): string | undefined => c.inst.find((x) => x.topic === t)?.status;

async function main(): Promise<void> {
  console.log("== F2.17 Replay determinístico dos 11 turnos (invariantes) ==");
  // P0-1: fixture com regra de saudação + Bloco 9 -> extrai o Bloco 9, NUNCA a regra.
  const facts = extractTenantBusinessFacts(RUNTIME_CFG);
  check("[P0-1] extrai endereço/horário do Bloco 9 (não a regra de saudação)", facts.address.value === EXPECTED_ADDR && facts.hours.value === EXPECTED_HOURS && !/bom dia|00h/i.test(facts.hours.value ?? ""), `addr=${facts.address.value} hours=${facts.hours.value}`);

  const caps: Cap[] = [];
  caps.push(await turn("Bom dia", "ambiguous", [fin([txt("Bom dia! Sou o Aloan, consultor da Icom Motors. Como posso ajudar?")])]));
  caps.push(await turn("Ele tem quantos km?", "asks_vehicle_detail", [fin([txt("Pra te informar o km, qual carro você tem em mente?")])]));
  // T3: brain PERGUNTA em vez de listar (erro do smoke #2) -> P0-3 deny -> re-autora COM a lista.
  caps.push(await turn("Quero um SUV automático até 90 mil", "ambiguous", [
    q(stockCall()),
    fin([txt("Encontrei ótimas opções de SUV automático até 90 mil. Quer que eu te mostre a lista?")]),         // sem offer_list -> deny
    fin([txt("Tenho estas opções pra você:"), offer([PEUGEOT, CRV]), txt("Quer ver as fotos de alguma?")]),      // com offer_list -> ok
  ]));
  // T4: "gostei do segundo" -> engine seleciona o 2º (CRV) + canonicaliza o label a partir do fato/oferta.
  caps.push(await turn("Gostei do segundo", "ambiguous", [fin([txt("Ótima escolha! Quer que eu te passe os detalhes ou já mando as fotos?")])]));
  // T5: km/cor reais do MESMO selecionado.
  caps.push(await turn("Ele tem quantos km e qual é a cor?", "asks_vehicle_detail", [
    q({ tool: "vehicle_details", input: { vehicleKey: CRV.vehicleKey } }),
    fin([txt("O Honda CRV 2010 tem"), vref(CRV, "km"), txt("e a cor é"), vref(CRV, "cor"), txt(". Quer ver as fotos?")]),
  ]));
  // T6: fotos do selecionado (send_media, sem despacho real).
  caps.push(await turn("Manda as fotos dele", "ambiguous", [
    q({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: CRV.vehicleKey } } }),
    fin([txt("Aqui estão as fotos que você pediu! 😊")], [reply, media(CRV)]),   // referência genérica (nome vem no recall)
  ]));
  // T7: brain ESCREVE A CHAVE CRUA (erro do smoke #2) -> guard P0-2 rejeita -> recall determinístico nomeia o carro.
  caps.push(await turn("Qual carro eu pedi as fotos?", "ambiguous", [fin([txt(`Você pediu as fotos do veículo com a chave ${CRV.vehicleKey}.`)])]));
  // T8: endereço + horário -> engine auto-resolve; brain responde os dois (fixture: address+hours presentes).
  caps.push(await turn("Onde fica a loja e qual o horário?", "ambiguous", [
    fin([txt("Deixa eu ver.")]),
    fin([txt(`Ficamos na ${EXPECTED_ADDR} e atendemos ${EXPECTED_HOURS}. Posso te ajudar em mais algo?`)]),
  ]));
  // T9: "outras opções" -> engine ENRIQUECE excludeKeys (brain NÃO manda) -> nova lista (Jeep).
  caps.push(await turn("Tem outras opções automáticas até 90 mil?", "ambiguous", [
    q(stockCall()),   // sem excludeKeys -> engine enriquece
    fin([txt("Tenho também esta opção:"), offer([JEEP]), txt("Quer ver as fotos?")]),
  ]));
  // T10: nome + sem troca (fato do lead, determinístico).
  caps.push(await turn("Meu nome é Douglas e não tenho carro para troca", "ambiguous", [fin([txt("Ótimo, Douglas! Anotado que você não tem troca. Qual valor de entrada você pensa?")])]));
  // T11: visita + sábado (fato do lead, sem objetivo pendente).
  caps.push(await turn("Quero visitar sábado", "ambiguous", [fin([txt("Perfeito, Douglas! Anotei sua visita para sábado. Já vou preparar tudo para o seu atendimento.")])]));

  const c = (n: number): Cap => caps[n - 1];
  // GLOBAIS
  const keyLeak = caps.map((cap) => ({ i: cap.i, k: anyKey(cap.outbox) })).find((x) => x.k);
  check("[G] ZERO vehicleKey em qualquer resposta ao lead", !keyLeak, keyLeak ? `T${keyLeak.i} vazou ${keyLeak.k}` : "");
  check("[G] zero degraded / zero terminal_safe / todos committed", caps.every((cap) => !cap.degraded && !cap.ts && cap.src !== "commit_failed" && cap.src !== "no_op"), JSON.stringify(caps.map((x) => ({ i: x.i, src: x.src, d: x.degraded, ts: x.ts }))));
  check("[G] nenhum U+FFFD", caps.every((cap) => !cap.outbox.includes("�")));
  // T3: contém lista (ambos os itens ofertados).
  check("[T3] resposta contém a LISTA (Peugeot 2008 + Honda CRV) — não 'quer ver?'", has(c(3).outbox, "Peugeot 2008") && has(c(3).outbox, "Honda CRV") && c(3).offerCount >= 2 && !/quer que eu te mostre a lista/i.test(c(3).outbox), `offer=${c(3).offerCount} text="${c(3).outbox}"`);
  // T4: seleciona o 2º (CRV) com LABEL humano (nunca a key).
  check("[T4] seleciona o 2º = Honda CRV 2010, label humano (não a key)", c(4).selKey === CRV.vehicleKey && c(4).selLabel === "Honda CRV 2010", `selKey=${c(4).selKey} label=${c(4).selLabel}`);
  // T5: km/cor reais do CRV.
  check("[T5] km/cor reais do MESMO carro (158.000 / Preto)", has(c(5).outbox, "158.000 km") && has(c(5).outbox, "Preto"), `text="${c(5).outbox}"`);
  // T6: send_media + lastPhotoAction com nome humano.
  check("[T6] envia foto (sem dispatch) + WM.lastPhotoAction = Honda CRV 2010", c(6).hasMedia && c(6).wmPhotoLabel === "Honda CRV 2010", `media=${c(6).hasMedia} wm=${c(6).wmPhotoLabel}`);
  // T7: recall NOMEIA o carro, nunca a chave.
  check("[T7] recall nomeia 'Honda CRV 2010', NUNCA 'revendamais:...'", has(c(7).outbox, "Honda CRV 2010") && !anyKey(c(7).outbox), `text="${c(7).outbox}"`);
  // T8: endereço + horário reais.
  check("[T8] responde endereço + horário reais do prompt", statusOf(c(8), "address") === "ok" && statusOf(c(8), "hours") === "ok" && has(c(8).outbox, "Charles Schnneider") && has(c(8).outbox, "9h às 19h"), `inst=${JSON.stringify(c(8).inst)} text="${c(8).outbox}"`);
  // T9: a chamada EXECUTADA de stock_search do T9 contém excludeKeys com os ofertados.
  const t9Stock = c(9).exec.find((x) => x.tool === "stock_search");
  const t9Excl = (t9Stock?.input as { excludeKeys?: string[] } | undefined)?.excludeKeys ?? [];
  check("[T9] stock_search EXECUTADO exclui os ofertados (Peugeot+CRV) e mantém filtros", t9Excl.includes(PEUGEOT.vehicleKey) && t9Excl.includes(CRV.vehicleKey) && (t9Stock?.input as { cambio?: string })?.cambio === "automatic" && (t9Stock?.input as { precoMax?: number })?.precoMax === 90000 && has(c(9).outbox, "Renegade"), `excl=${JSON.stringify(t9Excl)} text="${c(9).outbox}"`);
  // T10: nome + possuiTroca=false.
  check("[T10] persiste nome=Douglas + possuiTroca=false", /douglas/i.test(c(10).slots.nome ?? "") && /false/.test(c(10).slots.possuiTroca ?? ""), JSON.stringify(c(10).slots));
  // T11: visita + sábado no MESMO turno (sem objetivo pendente).
  check("[T11] persiste interesseVisita=true + diaHorario contendo sábado", /true/.test(c(11).slots.interesseVisita ?? "") && has(c(11).slots.diaHorario ?? "", "sabado"), JSON.stringify(c(11).slots));

  // P0-5 NEGATIVOS: "não quero visitar"/"talvez depois"/"quero fotos"/"quero o terceiro" NÃO viram visita positiva.
  {
    const st0 = createInitialState({ conversationId: CONV, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    const visitTrue = (msg: string): boolean => extractLeadSlots({ leadMessage: msg, state: st0, interpretation: null, claimExtractor: extractor, turnId: "tn" })
      .some((m) => m.op === "set_slot" && m.slot === "interesseVisita" && m.value === true);
    check("[P0-5-neg] negativos NÃO viram interesseVisita=true", !visitTrue("não quero visitar") && !visitTrue("talvez depois") && !visitTrue("quero fotos") && !visitTrue("quero o terceiro"),
      `naoquero=${visitTrue("não quero visitar")} talvez=${visitTrue("talvez depois")} fotos=${visitTrue("quero fotos")} terceiro=${visitTrue("quero o terceiro")}`);
  }

  console.log(`\n== F2.17 REPLAY: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
