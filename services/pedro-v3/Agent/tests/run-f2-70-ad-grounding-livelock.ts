// ============================================================================
// F2.70 — MISSÃO ANÚNCIO/GROUNDING (2026-07-18). Suíte dos incidentes REAIS de produção do dia 18/07.
//
// Cada seção reproduz um turno que chegou ao lead errado, com o texto literal que ele digitou:
//   A (AD-1) "Vcs tem na loja uma HRV ?"        -> livelock institucional -> "Tive uma instabilidade"
//   B (AD-2) anúncio Ford EcoSport 2020         -> vehicleKey inventada -> not_found -> "vou confirmar com o consultor"
//   C (AD-5) "Esse 2022 branco você tem foto?"  -> deny sem conjunto admissível -> "Tive uma instabilidade" (2x)
//
// INVARIANTE COMUM ÀS TRÊS (é a mesma doença): um deny do engine que (a) não entrega o CONJUNTO ADMISSÍVEL
// e (b) não tem trava própria vira pedido impossível — a LLM não tem como obedecer e o turno queima até degradar.
// Aqui provamos o contrário: requisito satisfazível, trava por perna, e degradação honesta quando não há saída.
//
// Zero OpenAI: cérebro SCRIPTADO + tools fake. Roda em ~1s.
//   npx tsx tests/run-f2-70-ad-grounding-livelock.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { isStoreInfoTurn, validateTurnUnderstanding } from "../src/engine/turn-understanding.ts";
import { COMPACT_OPERATIONAL_PROMPT, authoredQuestionsOutsidePortal } from "../src/adapters/llm/openai-agent-brain.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { AdContext } from "../src/domain/conversation-state.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-18T12:00:00.000Z", SHA = "sha-70";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));
// Texto EXATO do fallback técnico. Nenhum cenário desta suíte pode produzi-lo.
const INSTABILIDADE = "instabilidade";

// Estoque da Icom no dia do incidente (sem HRV — por isso "Vcs tem na loja uma HRV?" é busca vazia LEGÍTIMA).
const ECOSPORT20: VehicleFact = { vehicleKey: "rm:eco20", marca: "Ford", modelo: "EcoSport", ano: 2020, preco: 71990, km: 62000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const COMPASS22: VehicleFact = { vehicleKey: "rm:cmp22", marca: "Jeep", modelo: "Compass", ano: 2022, preco: 129990, km: 41000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const COMPASS19: VehicleFact = { vehicleKey: "rm:cmp19", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 103990, km: 78000, cambio: "Automatico", cor: "Preto", tipo: "suv" };
const RENEGADE18: VehicleFact = { vehicleKey: "rm:ren18", marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 71990, km: 122000, cambio: "Automatico", cor: "Preto", tipo: "suv" };
const STOCK = [ECOSPORT20, COMPASS22, COMPASS19, RENEGADE18];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Carvalho", companyName: "Icom Motors", promptText: "Você é o Carvalho da Icom Motors." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Av. Teste 900, Taubaté", hours: "Seg a Sex 8h-18h", unit: "Icom Motors", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; excludeKeys?: string[] };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m)); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= (inp.precoMax as number));
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") {
    const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? "";
    const known = STOCK.some((v) => v.vehicleKey === key);
    return known
      ? { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: [`${key}-p1`, `${key}-p2`] }, source: "fake" } as QueryResult
      : { ok: false, tool: "vehicle_photos_resolve", error: { code: "NOT_FOUND", message: "sem fotos", retryable: false } } as QueryResult;
  }
  if (call.tool === "vehicle_details") {
    const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey);
    return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult
      : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
  }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const offer = (keys: string[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: keys });
const vref = (vehicleKey: string, field: "marca" | "modelo" | "ano" | "km" | "cambio" | "cor"): ResponsePart => ({ type: "vehicle_ref", vehicleKey, field });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "query", call: call as never, understanding: u } as AgentBrainStep;
}
// Evidência LITERAL do bloco atual (o validador exige que a quote exista no texto do lead).
const ev = (block: string, capability: string | null, words = 4): TurnUnderstanding["evidence"] =>
  [{ capability: capability as never, quote: block.trim().split(/\s+/).slice(0, words).join(" ") }];

type Cap = {
  outbox: string; committed: boolean; hasMedia: boolean; mediaKey: string | null; exec: string[];
  reasonCode: string | null; responseSource: string | null; degradationKind: string | null;
  retryReasons: string[]; policyFeedback: string[]; degraded: boolean;
  brainCalls: number;
  // Chaves REALMENTE passadas ao adapter — a lente que prova que uma chave inventada nunca foi executada.
  execKeys: string[];
};
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, relation: TurnRelation, responder: BrainResponder, ad?: AdContext): Promise<Cap> {
  executed.length = 0; preparer.relation = relation; brain.setResponder(responder);
  const raw = ad ? redact({ text: lead, adContext: ad } as never) : redact({ text: lead });
  await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw, receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t${seq}`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 10, totalTimeoutMs: 9000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string; vehicleKey?: string } }[];
  const media = outbox.find((o) => o.kind === "send_media");
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "",
    committed: r.status === "committed",
    hasMedia: !!media, mediaKey: media?.payload?.vehicleKey ?? null,
    exec: executed.map((e) => e.tool),
    reasonCode: r.status === "committed" ? r.decision.reasonCode : null,
    responseSource: r.status === "committed" ? r.responseSource : null,
    degradationKind: r.status === "committed" ? r.degradationKind : null,
    retryReasons: r.status === "committed" ? [...(r.retryReasons ?? [])] : [],
    policyFeedback: r.status === "committed" ? [...r.policyFeedback] : [],
    degraded: r.status === "committed" ? r.degraded : false,
    brainCalls: brain.seenFrames.length,
    execKeys: executed.map((e) => {
      const i = e.input as { vehicleKey?: unknown; vehicleRef?: { key?: unknown } };
      return typeof i.vehicleKey === "string" ? i.vehicleKey : (typeof i.vehicleRef?.key === "string" ? i.vehicleRef.key : "");
    }).filter(Boolean),
  };
}
let seqN = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  seqN += 1;
  return { brain, preparer, clock, persistence, id: `wa:f270-${seqN}` };
}

async function main(): Promise<void> {
  // ══════════════════════════════════════════════════════════════════════════
  // SEÇÃO A (AD-1) — o livelock da palavra "loja"
  // Incidente: 18/07 15:41, lead 12 98819-0301. "Vcs tem na loja uma HRV ?" ->
  // retryReasonCounts.required_tool_missing=5, degradationKind=retry_exhausted,
  // responseSource=technical_fallback, institutionalResolved=[].
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== A (AD-1): pergunta de ESTOQUE que contém a palavra 'loja' ==");

  // [A0] unidade: mentionsStore casaria, mas o ATO declarado é de estoque -> NÃO é turno institucional.
  {
    const block = "Vcs tem na loja uma HRV ?";
    const uSearch: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: ev(block, "stock_search") };
    const vSearch = validateTurnUnderstanding(uSearch, block, true);
    check("[A0] ato de estoque com 'loja' no texto NAO e turno institucional", isStoreInfoTurn(vSearch) === false);

    const uInst: TurnUnderstanding = { ...U("institutional"), requestedCapabilities: ["institutional_info"], evidence: ev("Onde fica a loja?", "institutional_info") };
    const vInst = validateTurnUnderstanding(uInst, "Onde fica a loja?", true);
    check("[A0b] ato institucional declarado E turno institucional (nao-vacuidade)", isStoreInfoTurn(vInst) === true);
    check("[A0c] understanding sem cerebro nunca autoriza exigencia institucional", isStoreInfoTurn(null) === false);
  }

  // [A1] o turno REAL do incidente, ponta a ponta.
  {
    const c = conv();
    const block = "Vcs tem na loja uma HRV ?";
    // A LLM faz o certo: declara busca, chama stock_search de HRV (não existe no estoque) e responde honesto.
    const responder: BrainResponder = (frame, observations) => {
      const u: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: ev(frame.block ?? block, "stock_search") };
      const searched = observations.some((o) => o.tool === "stock_search" && o.ok);
      if (!searched) return qU({ tool: "stock_search", input: { modelo: "HR-V" } }, u);
      return finU([txt("No momento não tenho HR-V no estoque. Quer que eu veja um SUV parecido na mesma faixa?")], "stock_empty", u);
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "ambiguous", responder);
    check("[A1] turno commitado", r.committed);
    check("[A1] NAO caiu em fallback tecnico", r.responseSource !== "technical_fallback", `responseSource=${r.responseSource}`);
    check("[A1] NAO degradou por retry_exhausted", r.degradationKind !== "retry_exhausted", `degradationKind=${r.degradationKind}`);
    check("[A1] lead NAO recebeu 'instabilidade'", !has(r.outbox, INSTABILIDADE), r.outbox.slice(0, 80));
    check("[A1] rodou stock_search (o ato que o lead pediu)", r.exec.includes("stock_search"), r.exec.join(","));
    check("[A1] NAO exigiu tenant_business_info", !r.exec.includes("tenant_business_info"), r.exec.join(","));
    check("[A1] ZERO loop de required_tool_missing", r.retryReasons.filter((x) => x === "required_tool_missing").length === 0, r.retryReasons.join("|"));
    check("[A1] resposta honesta menciona HR-V", has(r.outbox, "hr-v") || has(r.outbox, "hrv"), r.outbox.slice(0, 80));
  }

  // [A2] pergunta REALMENTE institucional continua exigindo — e a exigência é SATISFAZÍVEL.
  {
    const c = conv();
    const block = "Onde fica a loja?";
    const responder: BrainResponder = (frame, observations) => {
      const u: TurnUnderstanding = { ...U("institutional"), requestedCapabilities: ["institutional_info"], evidence: ev(frame.block ?? block, "institutional_info") };
      const got = observations.some((o) => o.tool === "tenant_business_info" && o.ok);
      if (!got) return qU({ tool: "tenant_business_info", input: { topic: "address" } }, u);
      return finU([txt("Estamos na Av. Teste 900, em Taubaté. Quer aproveitar e agendar uma visita?")], "location_request", u);
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "ambiguous", responder);
    check("[A2] turno commitado", r.committed);
    check("[A2] NAO caiu em fallback tecnico", r.responseSource !== "technical_fallback", `responseSource=${r.responseSource}`);
    check("[A2] lead NAO recebeu 'instabilidade'", !has(r.outbox, INSTABILIDADE));
    // NOTA: tenant_business_info NÃO passa pelo runQuery fake (resolveInstitutional chama a fonte direto), então
    // `exec` não a registra. A prova de que a tool rodou é o FATO chegar à resposta — que é o que importa ao lead.
    check("[A2] respondeu o endereco de verdade (prova de que a tool institucional rodou)", has(r.outbox, "Av. Teste 900"), r.outbox.slice(0, 80));
    check("[A2] ZERO loop de required_tool_missing", r.retryReasons.filter((x) => x === "required_tool_missing").length === 0, r.retryReasons.join("|"));
  }

  // [A3] "Qual o horário da loja?" — segundo tópico institucional, mesma satisfação.
  {
    const c = conv();
    const block = "Qual o horário da loja?";
    const responder: BrainResponder = (frame, observations) => {
      const u: TurnUnderstanding = { ...U("institutional"), requestedCapabilities: ["institutional_info"], evidence: ev(frame.block ?? block, "institutional_info") };
      const got = observations.some((o) => o.tool === "tenant_business_info" && o.ok);
      if (!got) return qU({ tool: "tenant_business_info", input: { topic: "hours" } }, u);
      return finU([txt("Funcionamos de Seg a Sex 8h-18h. Posso te esperar em algum desses horários?")], "hours_request", u);
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "ambiguous", responder);
    check("[A3] respondeu o horario, sem fallback", r.committed && r.responseSource !== "technical_fallback" && has(r.outbox, "8h-18h"), `${r.responseSource} :: ${r.outbox.slice(0, 60)}`);
  }

  // [A4] TRAVA: cérebro TEIMOSO que declara ato institucional e NUNCA chama a tool.
  // Antes: repetia até esgotar o turno (5x required_tool_missing). Agora: bounded e degradação honesta.
  {
    const c = conv();
    const block = "Onde fica a loja?";
    const responder: BrainResponder = (frame) => {
      const u: TurnUnderstanding = { ...U("institutional"), requestedCapabilities: ["institutional_info"], evidence: ev(frame.block ?? block, "institutional_info") };
      return finU([txt("Deixa eu ver isso pra você.")], "reply", u);   // nunca chama a tool
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "ambiguous", responder);
    const loops = r.retryReasons.filter((x) => x === "required_tool_missing").length;
    // Teto real = 2 no loop principal (REQUIRED_TOOL_LOOP_CAP) + 1 único no estágio de autoria final, que agora
    // SAI em vez de insistir contra uma ação proibida. Produção viu 5 e esgotou o turno; o contrato agora é <=3.
    check("[A4] exigencia institucional e BOUNDED (<=3, era 5 em producao)", loops <= 3, `required_tool_missing x${loops} :: ${r.retryReasons.join("|")}`);
    check("[A4] turno termina (nao trava)", r.committed);
    check("[A4] degradacao e OBSERVAVEL quando a LLM nao coopera", r.degraded === true, `degraded=${r.degraded} kind=${r.degradationKind}`);
  }

  // [A5] CONTAMINAÇÃO CRUZADA: turno de BUSCA cujo bloco contém "loja" e cuja LLM nunca busca.
  // Antes: a palavra "loja" fazia stockReq=false e o cap anti-loop de ESTOQUE não incrementava.
  {
    const c = conv();
    const block = "Tem algum SUV aí na loja?";
    const responder: BrainResponder = (frame) => {
      const u: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: ev(frame.block ?? block, "stock_search") };
      return finU([txt("Temos várias opções!")], "reply", u);   // declara busca e nunca busca
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "ambiguous", responder);
    const loops = r.retryReasons.filter((x) => x === "required_tool_missing").length;
    check("[A5] cap de ESTOQUE nao e desligado pela palavra 'loja' (<=3)", loops <= 3, `required_tool_missing x${loops} :: ${r.retryReasons.join("|")}`);
    check("[A5] turno termina (nao trava)", r.committed);
    check("[A5] deny identico nao reabre retry-storm", r.brainCalls <= 3, `brainCalls=${r.brainCalls}`);
    // O engine NUNCA pode aceitar a promessa vaga ("Temos várias opções!") sem a busca que a própria LLM declarou.
    check("[A5] promessa sem busca NAO chega ao lead", !has(r.outbox, "Temos várias opções"), r.outbox.slice(0, 80));
  }

  // [D] Contrato ativo de entrada por anúncio específico: a abertura e o veículo
  // precisam ser produzidos no mesmo resultado da LLM. O teste é estrutural:
  // não força a engine a escolher estoque; impede que o contrato volte a permitir
  // a saudação isolada que empurra o assunto do anúncio para o próximo turno.
  check("[D1] contrato exige anúncio no mesmo resultado final", /NO MESMO RESULTADO FINAL E NO MESMO TURNO/i.test(COMPACT_OPERATIONAL_PROMPT));
  check("[D2] contrato exige message_break entre abertura e veículo", /message_break.*depois outro.*text/i.test(COMPACT_OPERATIONAL_PROMPT.replace(/\s+/g, " ")));
  check("[D3] contrato rejeita abertura isolada semanticamente", /resposta final contendo somente a apresenta[cç][aã]o e incompleta/i.test(COMPACT_OPERATIONAL_PROMPT));

  // [A6] SATISFAZIBILIDADE: ato institucional SEM tópico atendível pela tool (instagram/telefone).
  // Regressão real pega pela F2.22 [G] durante esta missão: trocar o regex pelo ato declarado, sozinho, fazia o engine
  // exigir tenant_business_info para "qual o instagram de vocês?" — e a tool só atende address|hours|unit.
  // Era o MESMO pedido impossível, só que com outra roupa. O requisito precisa de autoridade E satisfazibilidade.
  {
    const c = conv();
    const block = "qual o instagram de vocês?";
    const responder: BrainResponder = (frame) => {
      const u: TurnUnderstanding = { ...U("institutional"), requestedCapabilities: ["institutional_info"], evidence: ev(frame.block ?? block, "institutional_info") };
      return finU([txt("Não tenho o Instagram confirmado nas informações disponíveis agora, mas posso te ajudar por aqui mesmo.")], "contact_request", u);
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "ambiguous", responder);
    check("[A6] ato institucional SEM topico atendivel NAO exige a tool", r.retryReasons.filter((x) => x === "required_tool_missing").length === 0, r.retryReasons.join("|"));
    check("[A6] a ausencia honesta chega ao lead", has(r.outbox, "Instagram") && !has(r.outbox, INSTABILIDADE), r.outbox.slice(0, 90));
    check("[A6] sem fallback tecnico", r.responseSource !== "technical_fallback", `responseSource=${r.responseSource}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEÇÃO B (AD-2) — anúncio identificado tem de ser ATERRADO antes de detalhe/foto
  // Incidente: 18/07 15:38, lead 12 98819-0301. adContext="Ford EcoSport SE 1.5 2020" confiança 1.0.
  // toolsExecuted=["vehicle_details"], retryReasons=[grounding_deny, not_found, dup_tool x3, ...],
  // NENHUM stock_search. Lead recebeu "Vou confirmar os detalhes desse veículo com o consultor."
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== B (AD-2): anuncio com veiculo confiavel -> chave so nasce de tool ==");

  const adEcoSport: AdContext = {
    adId: "120249562061890219", source: "facebook", sourceUrl: null,
    title: "📲 Fale agora com um de nossos consultores!", body: "🚗 Veículos revisados e prontos para você!",
    greeting: "Olá! Quer saber mais sobre o Ford EcoSport SE 1.5 2020?", imageUrls: [], capturedAtTurn: 0,
  };

  // [B1] a LLM INVENTA a chave a partir do texto do anúncio (foi o que gpt-4.1-mini fez em produção).
  {
    const c = conv();
    const block = "Olá! Posso ter mais informações sobre isso?";
    const responder: BrainResponder = (frame, observations) => {
      const u: TurnUnderstanding = { ...U("vehicle_detail"), requestedCapabilities: ["vehicle_details"], evidence: ev(frame.block ?? block, "vehicle_details") };
      const denied = observations.some((o) => !o.ok && o.error.code === "VEHICLE_KEY_NOT_GROUNDED");
      const searched = observations.find((o) => o.tool === "stock_search" && o.ok) as { ok: true; data: { items: VehicleFact[] } } | undefined;
      if (!denied && !searched) return qU({ tool: "vehicle_details", input: { vehicleKey: "ford-ecosport-2020" } }, u);   // chave INVENTADA
      if (denied && !searched) {
        const us: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: ev(frame.block ?? block, "stock_search") };
        return qU({ tool: "stock_search", input: { marca: "Ford", modelo: "EcoSport" } }, us);
      }
      const us: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: ev(frame.block ?? block, "stock_search") };
      return finU([txt("Esse é o Ford EcoSport 2020 do anúncio:"), offer((searched?.data.items ?? []).map((v) => v.vehicleKey)), txt("Quer ver as fotos ou os detalhes dele?")], "offer_stock", us);
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "ambiguous", responder, adEcoSport);
    check("[B1] chave INVENTADA nao chega ao adapter", !r.execKeys.includes("ford-ecosport-2020"), `execKeys=${r.execKeys.join(",")}`);
    check("[B1] a LLM foi levada ao stock_search", r.exec.includes("stock_search"), r.exec.join(","));
    check("[B1] turno commitado sem fallback", r.committed && r.responseSource !== "technical_fallback", `${r.responseSource}`);
    check("[B1] lead NAO recebeu 'instabilidade'", !has(r.outbox, INSTABILIDADE), r.outbox.slice(0, 80));
    check("[B1] lead NAO recebeu deflexao 'consultor'", !has(r.outbox, "consultor"), r.outbox.slice(0, 80));
    check("[B1] resposta NOMEIA o veiculo do anuncio", has(r.outbox, "EcoSport"), r.outbox.slice(0, 90));
    check("[B1] resposta traz o preco REAL do catalogo", has(r.outbox, "71.990") || has(r.outbox, "71990"), r.outbox.slice(0, 140));
    check("[B1] NAO virou lista ampla (so o carro do anuncio)", !has(r.outbox, "Renegade") && !has(r.outbox, "Compass"), r.outbox.slice(0, 140));
  }

  // [B2] chave ATERRADA (vinda de stock_search) passa normalmente — a guarda não pode barrar o caminho legítimo.
  {
    const c = conv();
    const block = "Quero saber a km desse EcoSport";
    const responder: BrainResponder = (frame, observations) => {
      const searched = observations.find((o) => o.tool === "stock_search" && o.ok) as { ok: true; data: { items: VehicleFact[] } } | undefined;
      const detail = observations.find((o) => o.tool === "vehicle_details" && o.ok) as { ok: true; data: { vehicle: VehicleFact } } | undefined;
      const us: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: ev(frame.block ?? block, "stock_search") };
      if (!searched) return qU({ tool: "stock_search", input: { marca: "Ford", modelo: "EcoSport" } }, us);
      const ud: TurnUnderstanding = { ...U("vehicle_detail"), requestedCapabilities: ["vehicle_details"], evidence: ev(frame.block ?? block, "vehicle_details") };
      if (!detail) return qU({ tool: "vehicle_details", input: { vehicleKey: searched.data.items[0].vehicleKey } }, ud);
      // Atributo de estoque SÓ por parte tipada (vehicle_ref) — texto livre com km é barrado pelo grounding, e com razão.
      return finU([txt("Esse EcoSport está com "), vref(searched.data.items[0].vehicleKey, "km"), txt(" km rodados. Quer ver as fotos?")], "vehicle_detail", ud);
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "ambiguous", responder, adEcoSport);
    check("[B2] chave ATERRADA executa vehicle_details normalmente", r.exec.includes("vehicle_details"), r.exec.join(","));
    check("[B2] atributo real chega ao lead", has(r.outbox, "62000") || has(r.outbox, "62.000"), r.outbox.slice(0, 90));
    check("[B2] sem fallback", r.committed && r.responseSource !== "technical_fallback", `${r.responseSource}`);
  }

  // [B3] o lead MUDA de veículo: a nova intenção vence o anúncio (o anúncio é âncora, não prisão).
  {
    const c = conv();
    const block = "Na verdade eu queria ver um Compass";
    const responder: BrainResponder = (frame, observations) => {
      const us: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: ev(frame.block ?? block, "stock_search") };
      const searched = observations.find((o) => o.tool === "stock_search" && o.ok) as { ok: true; data: { items: VehicleFact[] } } | undefined;
      if (!searched) return qU({ tool: "stock_search", input: { marca: "Jeep", modelo: "Compass" } }, us);
      return finU([txt("Claro! Tenho estes Compass:"), offer(searched.data.items.map((v) => v.vehicleKey)), txt("Algum deles te interessa?")], "offer_stock", us);
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "direction_change", responder, adEcoSport);
    check("[B3] nova intencao do lead vence o anuncio", has(r.outbox, "Compass") && !has(r.outbox, "EcoSport"), r.outbox.slice(0, 110));
    check("[B3] sem fallback", r.committed && r.responseSource !== "technical_fallback", `${r.responseSource}`);
  }

  // [B4] RESIDUO P0: a LLM insiste na mesma tool/input depois de ja receber o fato.
  // A primeira repeticao vira feedback de controle; a mesma LLM redige a resposta final com o resultado obtido.
  {
    const c = conv();
    const block = "Quero ver as opcoes de SUV disponiveis";
    const responder: BrainResponder = (frame, observations) => {
      const us: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: ev(frame.block ?? block, "stock_search") };
      const searched = observations.some((o) => o.tool === "stock_search" && o.ok);
      const duplicate = observations.some((o) => !o.ok && (o.error.code === "DUP_STOCK_SEARCH" || o.error.code === "DUP_TOOL"));
      const finalAuthorship = observations.some((o) => !o.ok && o.error.code === "FINAL_AUTHORSHIP_REQUIRED");
      if (!searched) return qU({ tool: "stock_search", input: { tipo: "suv" } }, us);
      // Simula o residuo observado: sem uma passagem final explicita, a LLM propoe a mesma consulta.
      if (!duplicate && !finalAuthorship) return qU({ tool: "stock_search", input: { tipo: "suv" } }, us);
      return finU([txt("Encontrei estas opcoes de SUV no estoque:"), offer(STOCK.filter((v) => v.tipo === "suv").map((v) => v.vehicleKey)), txt("Quer ver fotos ou detalhes de algum deles?")], "offer_stock", us);
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "ambiguous", responder);
    check("[B4] turno commitado apos proposta duplicada", r.committed, `${r.responseSource}`);
    check("[B4] nao caiu em fallback tecnico", r.responseSource !== "technical_fallback", `${r.responseSource}`);
    check("[B4] stock_search executou uma unica vez", r.exec.filter((x) => x === "stock_search").length === 1, r.exec.join(","));
    check("[B4] proposta duplicada consumiu no maximo uma nova autoria", r.brainCalls <= 3, `brainCalls=${r.brainCalls}`);
    check("[B4] resposta final usa o estoque obtido", has(r.outbox, "SUV") || has(r.outbox, "EcoSport"), r.outbox.slice(0, 140));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEÇÃO D (AD-4) — a apresentação do portal precisa vencer
  // Causa provada: a instrução de reproduzir a abertura do portal vivia SÓ no N8N_STYLE_BRAIN_PROTOCOL, que é código
  // morto (o construtor fixa COMPACT_OPERATIONAL_PROMPT). O engine seguia ENVIANDO openingContext.* como booleans
  // órfãos — campos sem contrato no prompt ativo. E o gate de "1 pergunta" cortava a pergunta do próprio lojista.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== D (AD-4): contrato de abertura e precedencia do prompt do portal ==");

  // Prompt REAL da Icom (trecho literal do que o lojista configurou no portal).
  const PORTAL_ICOM = [
    "Você é o Carvalho, consultor de IA da Icom Motors.",
    "Na primeira resposta, use exatamente esta apresentação, alterando somente a saudação conforme o horário atual do Brasil:",
    '"[PERIODO]! Sou o Carvalho, consultor aqui de IA da Icom Motors 😊 Você é aqui de Taubaté mesmo já conhece a nossa loja?"',
  ].join("\n");

  // [D1] INVARIANTE ANTI-REGRESSÃO: todo campo de openingContext que o engine ENVIA tem contrato no prompt ATIVO.
  // Campo enviado sem contrato = boolean órfão: o modelo vê e não sabe o que fazer. Foi exatamente o estado anterior.
  {
    const camposEnviados = ["firstAssistantTurn", "specificAdEntry", "adGenericEntry"];
    for (const campo of camposEnviados) {
      check(`[D1] '${campo}' tem contrato no prompt ATIVO`, COMPACT_OPERATIONAL_PROMPT.includes(campo), "campo enviado sem contrato");
    }
    check("[D1] prompt ativo declara PRECEDENCIA do portal", /PROMPT DO PORTAL VENCE/i.test(COMPACT_OPERATIONAL_PROMPT));
    check("[D1] prompt ativo manda NAO parafrasear a abertura do portal", /nao resuma, nao parafraseie/i.test(norm(COMPACT_OPERATIONAL_PROMPT)));
    check("[D1] prompt ativo ensina message_break entre apresentacao e assunto", COMPACT_OPERATIONAL_PROMPT.includes("message_break"));
    // O engine NÃO pode hardcodar a saudação: ela é propriedade do lojista.
    check("[D1] engine NAO hardcoda a saudacao do lojista", !/Sou o Carvalho|conhece a nossa loja/i.test(COMPACT_OPERATIONAL_PROMPT), "saudacao vazou para o engine");
  }

  // [D2] a pergunta do PORTAL não consome o teto de UMA pergunta autoral.
  // Sem isto, apresentar-se ("...já conhece a nossa loja?") + tratar o anúncio ("quer ver fotos?") era reprovado,
  // e o rewriter cortava justamente a pergunta do lojista.
  {
    const perguntaDoPortal = "Você é aqui de Taubaté mesmo já conhece a nossa loja?";
    const perguntaAutoral = "Quer ver as fotos dele?";
    const soPortal = authoredQuestionsOutsidePortal([perguntaDoPortal], PORTAL_ICOM);
    check("[D2] pergunta DO PORTAL nao conta como autoral", soPortal.length === 0, JSON.stringify(soPortal));

    const ambas = authoredQuestionsOutsidePortal([perguntaDoPortal, perguntaAutoral], PORTAL_ICOM);
    check("[D2] apresentacao do portal + UMA pergunta autoral e ACEITA", ambas.length === 1, JSON.stringify(ambas));

    const duasAutorais = authoredQuestionsOutsidePortal([perguntaAutoral, "Qual seu nome?"], PORTAL_ICOM);
    check("[D2] DUAS perguntas autorais continuam sendo demais (nao-vacuidade)", duasAutorais.length === 2, JSON.stringify(duasAutorais));

    // Fragmento trivial não pode ser "perdoado" só por existir em algum ponto do prompt.
    const trivial = authoredQuestionsOutsidePortal(["Ok?"], PORTAL_ICOM);
    check("[D2] fragmento trivial nao e absolvido por acidente", trivial.length === 1, JSON.stringify(trivial));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEÇÃO E (cenário 3 do Codex) — turno SEM pendência factual tem de poder FECHAR
  // Incidente: 19/07 12:56, lead 24 99827-5607. As fotos foram enviadas com sucesso; o lead respondeu
  // "Ok. Obrigado." e o agente respondeu bem — mas o engine EXIGIU efeito handoff com reason=qualified_handoff,
  // motivo que OUTRA guarda nega quando a qualificação não está completa. 4 denies idênticos -> "Tive uma
  // instabilidade". A correção não foi refinar o motivo: foi REMOVER a exigência. Encerrar sem transferir é
  // decisão conversacional da LLM, não invariante de fato ou segurança.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== E: turno sem pendencia factual FECHA (nenhum efeito obrigatorio) ==");

  for (const [nome, block, texto] of [
    ["E1 obrigado", "Ok.\nObrigado.", "Perfeito, fico à disposição caso queira saber mais ou agendar uma visita."],
    ["E2 vou ver as fotos", "Ok. Obrigado pela atenção. Vou dar uma olhada nas fotos", "Fico à disposição! Qualquer dúvida sobre ele, é só chamar."],
  ] as const) {
    const c = conv();
    const responder: BrainResponder = (frame) => {
      const u: TurnUnderstanding = { ...U("disengagement"), evidence: ev(frame.block ?? block, null, 2) };
      return finU([txt(texto)], "closing", u);   // fecha SEM propor handoff — e isso é legítimo
    };
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, block, "ambiguous", responder);
    check(`[${nome}] turno commitado`, r.committed);
    check(`[${nome}] resposta da LLM foi ACEITA (sem fallback)`, r.responseSource !== "technical_fallback", `responseSource=${r.responseSource}`);
    check(`[${nome}] lead NAO recebeu 'instabilidade'`, !has(r.outbox, INSTABILIDADE), r.outbox.slice(0, 80));
    check(`[${nome}] o texto QUE A LLM ESCREVEU chegou ao lead`, has(r.outbox, texto.slice(0, 28)), r.outbox.slice(0, 90));
    check(`[${nome}] ZERO deny repetido`, r.policyFeedback.length === 0, `policyFeedback=${r.policyFeedback.length}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEÇÃO C (AD-5 / cenários 1 e 2 do Codex) — CADEIA DE MÍDIA
  // A saída da tool É a entrada do envio. Antes, o dispatcher IGNORAVA o resultado e relia o feed AO VIVO
  // (photo-source.resolveUrls -> loader.loadAll). Qualquer deriva entre as duas leituras — carro vendido, uma foto
  // a menos — dava contagem diferente e matava o envio com retryable:false. As fotos sumiam em silêncio.
  // Aqui provamos: (1) envia o snapshot resolvido, sem segunda leitura; (2) o estoque MUDA no meio e ainda envia.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== C (AD-5): cadeia de midia — snapshot resolvido vence releitura de estoque ==");

  {
    const { WhatsAppEffectDispatcher } = await import("../src/adapters/effects/whatsapp-dispatcher.ts");
    type SentImage = { url: string; photoId: string };

    // Fonte de fotos que CONTA releituras — é a lente que prova "sem segunda leitura do estoque".
    let resolveUrlsCalls = 0;
    let feedPhotos = ["p1", "p2"];   // o feed AO VIVO; mudá-lo simula a deriva real entre turno e envio
    const photoSource = {
      async resolvePhotos(_ref: unknown, vehicleKey: string) {
        return { vehicleKey, ambiguous: false, photoIds: [...feedPhotos], media: feedPhotos.map((id) => ({ id, url: `https://cdn/${vehicleKey}/${id}.jpg` })) };
      },
      async resolveUrls(_ref: unknown, vehicleKey: string, ids: readonly string[]) {
        resolveUrlsCalls += 1;
        return ids.filter((id) => feedPhotos.includes(id)).map((id) => `https://cdn/${vehicleKey}/${id}.jpg`);
      },
    };
    const sent: SentImage[] = [];
    const sender = {
      async sendText() { return { ok: true as const, providerMessageId: "t1", level: "delivered" as const }; },
      async sendImage(a: { url: string; photoId: string }) { sent.push({ url: a.url, photoId: a.photoId }); return { ok: true as const, providerMessageId: `i-${a.photoId}`, level: "delivered" as const }; },
    };
    const mkDispatcher = () => new WhatsAppEffectDispatcher({
      ref: { tenantId: TENANT, agentId: AGENT }, to: "5512999999999",
      sender: sender as never, photoSource: photoSource as never, clock: new FakeClock(NOW) as never,
    } as never);

    const rec = (payload: Record<string, unknown>) => ({
      effectId: "e-media-1", idempotencyKey: "idem-1", kind: "send_media", payload,
    }) as never;

    // [C1] cenário 1 do Codex: fotos resolvidas -> envio correto, SEM segunda leitura do estoque.
    {
      resolveUrlsCalls = 0; sent.length = 0;
      const resolved = await photoSource.resolvePhotos(null, "rm:cmp22");
      const r = await mkDispatcher().dispatch(rec({ vehicleKey: "rm:cmp22", photoIds: resolved.photoIds, media: resolved.media }));
      check("[C1] envio bem-sucedido", (r as { status: string }).status === "succeeded", JSON.stringify(r).slice(0, 110));
      check("[C1] ZERO releitura do estoque (resolveUrls nao chamado)", resolveUrlsCalls === 0, `resolveUrls=${resolveUrlsCalls}`);
      check("[C1] enviou as 2 fotos do snapshot", sent.length === 2, `sent=${sent.length}`);
      check("[C1] urls sao as do veiculo CERTO", sent.every((s) => s.url.includes("rm:cmp22")), JSON.stringify(sent).slice(0, 120));
    }

    // [C2] cenário 2 do Codex — O CORAÇÃO DO BUG: o estoque MUDA depois da resolução.
    // Antes: resolveUrls devolvia 1 url para 2 ids -> contagem diverge -> media_reference_not_resolvable,
    // retryable:false -> lead nunca recebe foto nenhuma. Agora o snapshot original prevalece.
    {
      resolveUrlsCalls = 0; sent.length = 0;
      const resolved = await photoSource.resolvePhotos(null, "rm:cmp22");   // resolveu com p1+p2
      feedPhotos = ["p1"];                                                   // ⚠️ deriva: p2 saiu do feed
      const r = await mkDispatcher().dispatch(rec({ vehicleKey: "rm:cmp22", photoIds: resolved.photoIds, media: resolved.media }));
      check("[C2] estoque mudou e o envio NAO morreu", (r as { status: string }).status === "succeeded", JSON.stringify(r).slice(0, 140));
      check("[C2] enviou o SNAPSHOT original (2 fotos), nao o feed novo", sent.length === 2, `sent=${sent.length}`);
      check("[C2] ZERO releitura do estoque", resolveUrlsCalls === 0, `resolveUrls=${resolveUrlsCalls}`);
      feedPhotos = ["p1", "p2"];
    }

    // [C3] NÃO-VACUIDADE: registro ANTIGO (sem snapshot) ainda usa o caminho legado de releitura.
    // Prova que o teste mede o snapshot de verdade, e não um caminho que passaria de qualquer jeito.
    {
      resolveUrlsCalls = 0; sent.length = 0;
      const r = await mkDispatcher().dispatch(rec({ vehicleKey: "rm:cmp22", photoIds: ["p1", "p2"] }));
      check("[C3] payload legado (sem media) cai na releitura", resolveUrlsCalls === 1, `resolveUrls=${resolveUrlsCalls}`);
      check("[C3] e ainda assim envia", (r as { status: string }).status === "succeeded", JSON.stringify(r).slice(0, 110));
    }

    // [C4] deriva no caminho LEGADO deixa de ser fatal: envia o que resolveu em vez de descartar tudo.
    {
      resolveUrlsCalls = 0; sent.length = 0;
      feedPhotos = ["p1"];
      const r = await mkDispatcher().dispatch(rec({ vehicleKey: "rm:cmp22", photoIds: ["p1", "p2"] }));
      check("[C4] legado com deriva NAO falha o envio inteiro", (r as { status: string }).status === "succeeded", JSON.stringify(r).slice(0, 140));
      check("[C4] envia a foto que sobreviveu", sent.length === 1, `sent=${sent.length}`);
      feedPhotos = ["p1", "p2"];
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEÇÃO F — gates 2 e 3 exigidos pelo Codex na auditoria da cadeia de mídia
  //   Gate 2: todo plano NOVO sempre carrega snapshot (o elo não pode parar de propagar em silêncio)
  //   Gate 3: validação de URL/host TAMBÉM no dispatcher (o snapshot é persistido; "veio da tool" não basta)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== F: gates da auditoria (snapshot sempre presente + URL validada no envio) ==");

  // [F1] GATE 2 — a fonte real preenche o snapshot, e o executor de foto o PROPAGA até o efeito.
  // Este teste é o que teria pego o bug que quase passou: o campo `media` é opcional, então o `tsc` fica verde
  // mesmo se algum elo parar de repassá-lo — e a correção viraria inerte sem ninguém perceber.
  {
    const { resolvePhotoIntent } = await import("../src/engine/photo-intent.ts");
    const photoRunQuery = async (call: QueryCall): Promise<QueryResult> => {
      if (call.tool === "vehicle_photos_resolve") {
        const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? "";
        return { ok: true, tool: "vehicle_photos_resolve", data: {
          vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"],
          media: [{ id: "p1", url: `https://cdn.exemplo/${key}/p1.jpg` }, { id: "p2", url: `https://cdn.exemplo/${key}/p2.jpg` }],
        }, source: "fake" } as QueryResult;
      }
      return runQuery(call);
    };
    const st = {
      photoLedger: { sentByVehicle: {} },
      lastRenderedOfferContext: { items: [{ vehicleKey: "rm:cmp22", marca: "Jeep", modelo: "Compass", ano: 2022 }] },
      vehicleContext: { selected: { key: "rm:cmp22", label: "Jeep Compass 2022" } },
    } as never;
    const res = await resolvePhotoIntent({ state: st, runQuery: photoRunQuery, claimExtractor: extractor, leadMessage: "manda as fotos do Compass", interpretation: null } as never);
    const sendRes = res as { kind: string; media?: readonly { id: string; url: string }[] };
    check("[F1] executor de foto resolve envio", sendRes.kind === "send", `kind=${sendRes.kind}`);
    check("[F1] e PROPAGA o snapshot resolvido (nao so os ids)", Array.isArray(sendRes.media) && sendRes.media.length === 2, JSON.stringify(sendRes.media ?? null));
    check("[F1] o snapshot traz url de verdade", (sendRes.media ?? []).every((m) => m.url.startsWith("https://")), JSON.stringify(sendRes.media ?? null));
  }

  // [F2] GATE 3 — validação de URL na borda do envio. Unidade do invariante, sem depender de lista de domínio.
  {
    const { isSafeMediaUrl } = await import("../src/adapters/effects/whatsapp-dispatcher.ts");
    const seguras = ["https://cdn.bndv.com.br/foto.jpg", "https://scontent.fbcdn.net/a/b.png"];
    const inseguras = [
      "http://cdn.bndv.com.br/foto.jpg",              // sem TLS
      "data:image/png;base64,AAAA",                    // payload embutido
      "file:///etc/passwd",                            // leitura local
      "javascript:alert(1)",                           // esquema executável
      "https://user:senha@cdn.exemplo/foto.jpg",       // credencial embutida vazaria segredo
      "https://localhost/foto.jpg",                    // SSRF p/ serviço local
      "https://127.0.0.1/foto.jpg",
      "https://10.0.0.5/foto.jpg",                     // rede interna
      "https://169.254.169.254/latest/meta-data",       // metadata de cloud (o clássico do SSRF)
      "nao-e-url",
    ];
    for (const u of seguras) check(`[F2] aceita url segura (${u.slice(8, 30)})`, isSafeMediaUrl(u) === true, u);
    for (const u of inseguras) check(`[F2] REJEITA (${u.slice(0, 34)})`, isSafeMediaUrl(u) === false, u);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEÇÃO G — o que o SMOKE REAL (gpt-4.1-mini, 19/07) expôs e o offline não pegava
  // No smoke, T2 ("Pode me mandar fotos dele?") produziu:
  //   tools = vehicle_photos_resolve, vehicle_photos_resolve, vehicle_photos_resolve
  //   + response:VEHICLE_KEY_NOT_GROUNDED + response:DUP_PHOTO_RESOLVE
  // A foto SAIU, mas porque a LLM insistiu — não porque o contrato estava certo. Duas causas:
  //   (1) a guarda de proveniência não reconhecia o resultado da PRÓPRIA vehicle_photos_resolve como grounding;
  //   (2) repetir uma consulta IDEMPOTENTE virava deny, em vez de devolver o fato já resolvido.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== G: grounding da propria foto + dedup de decisao (achados do smoke real) ==");

  // [G1] a chave que veio de vehicle_photos_resolve É aterrada — a guarda não pode negá-la depois.
  {
    const c = conv();
    const block = "Pode me mandar fotos dele?";
    const responder: BrainResponder = (frame, observations) => {
      const u: TurnUnderstanding = { ...U("request_photos"), requestedCapabilities: ["send_photos"], evidence: [{ capability: "send_photos", quote: "mandar fotos" }] };
      const resolved = observations.find((o) => o.tool === "vehicle_photos_resolve" && o.ok) as { ok: true; data: { vehicleKey: string; photoIds: string[] } } | undefined;
      if (!resolved) return qU({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: "rm:cmp22" } } }, u);
      return {
        kind: "final", understanding: u,
        decision: {
          reasonCode: "send_photos", reasonSummary: "r", confidence: 0.9,
          responsePlan: { guidance: "g", draft: { parts: [txt("Aqui estão as fotos do Jeep Compass 2022.")] } },
          proposedEffects: [reply, { kind: "send_media", planId: "photos", order: 1, onSuccess: [], vehicleKey: resolved.data.vehicleKey, photoIds: resolved.data.photoIds } as ProposedEffectPlan],
          memoryMutations: [], stateMutations: [],
        } as AgentBrainDecision,
      } as AgentBrainStep;
    };
    // T1 = busca (é ela que ATERRA a chave), T2 = foto. Mesma ordem do smoke real e da conversa de produção:
    // sem a oferta anterior nada aterra rm:cmp22 e a guarda de proveniência bloquearia — corretamente.
    const buscaResponder: BrainResponder = (frame, observations) => {
      const us: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: ev(frame.block ?? "quero um Compass 2022", "stock_search") };
      const s = observations.find((o) => o.tool === "stock_search" && o.ok) as { ok: true; data: { items: VehicleFact[] } } | undefined;
      if (!s) return qU({ tool: "stock_search", input: { marca: "Jeep", modelo: "Compass" } }, us);
      return finU([txt("Encontrei estas opções:"), offer(s.data.items.map((v) => v.vehicleKey)), txt("Alguma te interessou?")], "offer_stock", us);
    };
    await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, "quero um Compass 2022", "ambiguous", buscaResponder);
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 2, block, "continues_offer", responder);
    const naoAterrada = r.policyFeedback.filter((f) => has(f, "nao veio de nenhuma consulta") || has(f, "não veio de nenhuma consulta")).length;
    check("[G1] resultado da propria foto NAO vira VEHICLE_KEY_NOT_GROUNDED", naoAterrada === 0, r.policyFeedback.join(" | ").slice(0, 160));
    check("[G1] a foto foi RESOLVIDA uma vez so", r.exec.filter((t) => t === "vehicle_photos_resolve").length === 1, r.exec.join(","));
    check("[G1] send_media saiu", r.hasMedia, `media=${r.hasMedia}`);
    check("[G1] mídia é do veiculo CERTO", r.mediaKey === "rm:cmp22", `mediaKey=${r.mediaKey}`);
    check("[G1] sem fallback tecnico", r.responseSource !== "technical_fallback", `${r.responseSource}`);
  }

  // [G2] DEDUP DE DECISÃO: a LLM repete a MESMA chamada -> recebe o FATO de volta, não um deny.
  // Reproduz literalmente o que o gpt-4.1-mini fez no smoke.
  {
    const c = conv();
    const block = "Pode me mandar fotos dele?";
    let tentativas = 0;
    const responder: BrainResponder = (frame, observations) => {
      const u: TurnUnderstanding = { ...U("request_photos"), requestedCapabilities: ["send_photos"], evidence: [{ capability: "send_photos", quote: "mandar fotos" }] };
      tentativas += 1;
      const resolved = observations.filter((o) => o.tool === "vehicle_photos_resolve" && o.ok) as { ok: true; data: { vehicleKey: string; photoIds: string[] } }[];
      // insiste na MESMA chamada nas duas primeiras vezes (como o modelo real fez)
      if (tentativas <= 2) return qU({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: "rm:cmp22" } } }, u);
      const last = resolved[resolved.length - 1];
      if (!last) return finU([txt("Não consegui localizar as fotos agora.")], "photo_unavailable", u);
      return {
        kind: "final", understanding: u,
        decision: {
          reasonCode: "send_photos", reasonSummary: "r", confidence: 0.9,
          responsePlan: { guidance: "g", draft: { parts: [txt("Aqui estão as fotos do Jeep Compass 2022.")] } },
          proposedEffects: [reply, { kind: "send_media", planId: "photos", order: 1, onSuccess: [], vehicleKey: last.data.vehicleKey, photoIds: last.data.photoIds } as ProposedEffectPlan],
          memoryMutations: [], stateMutations: [],
        } as AgentBrainDecision,
      } as AgentBrainStep;
    };
    const buscaResponder2: BrainResponder = (frame, observations) => {
      const us: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: ev(frame.block ?? "quero um Compass 2022", "stock_search") };
      const s = observations.find((o) => o.tool === "stock_search" && o.ok) as { ok: true; data: { items: VehicleFact[] } } | undefined;
      if (!s) return qU({ tool: "stock_search", input: { marca: "Jeep", modelo: "Compass" } }, us);
      return finU([txt("Encontrei estas opções:"), offer(s.data.items.map((v) => v.vehicleKey)), txt("Alguma te interessou?")], "offer_stock", us);
    };
    await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 1, "quero um Compass 2022", "ambiguous", buscaResponder2);
    const r = await turn(c.persistence, c.clock, c.brain, c.preparer, c.id, 2, block, "continues_offer", responder);
    check("[G2] repeticao NAO reexecuta a tool (idempotente, 1 execucao real)", r.exec.filter((t) => t === "vehicle_photos_resolve").length === 1, r.exec.join(","));
    check("[G2] repeticao NAO gera deny (dup_tool ausente)", r.retryReasons.filter((x) => x === "dup_tool").length === 0, r.retryReasons.join("|"));
    check("[G2] turno termina sem fallback", r.committed && r.responseSource !== "technical_fallback", `${r.responseSource}`);
    check("[G2] lead NAO recebeu 'instabilidade'", !has(r.outbox, INSTABILIDADE), r.outbox.slice(0, 80));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEÇÃO H — TESTE DE CONTRATO (exigido pelo Codex): AUTORIDADE FACTUAL ÚNICA.
  // O v3 tinha TRÊS validações decidindo se um veículo está aterrado, e elas DIVERGIAM. Foi essa divergência que
  // produziu o absurdo do smoke real: um deny afirmando "NENHUM veículo foi aterrado nesta conversa ainda"
  // logo DEPOIS de a própria vehicle_photos_resolve ter aterrado o veículo com sucesso, no mesmo turno.
  // Aqui elas ficam amarradas à MESMA chave. Se alguém fizer uma delas divergir de novo, quebra AQUI —
  // e não num lead que fica sem foto.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== H: contrato de autoridade factual unica (as 3 validacoes concordam) ==");
  {
    const { knownVehicleKeysForTest } = await import("../src/engine/central-engine.ts");
    const { targetAcceptsKey } = await import("../src/engine/turn-understanding.ts");
    const KEY = "rm:cmp22";
    // Fato ÚNICO da premissa: a vehicle_photos_resolve rodou COM SUCESSO neste turno e aterrou KEY.
    const fatoFoto = { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: KEY, ambiguous: false, photoIds: [`${KEY}-p1`] }, source: "fake" } as QueryResult;
    const estadoVazio = { vehicleContext: { selected: null }, lastRenderedOfferContext: null, photoLedger: { sentByVehicle: {} } } as never;

    // (1) PROVENIÊNCIA — governa a EXECUÇÃO de vehicle_details / vehicle_photos_resolve
    const grounded = knownVehicleKeysForTest([fatoFoto], [], estadoVazio);
    check("[H] (1) proveniencia aceita a chave da PROPRIA tool", grounded.has(KEY), [...grounded].join(","));

    // (2) ALVO DO TURNO — governa o ENVIO da mídia
    const alvo = { kind: "resolved", vehicleKey: KEY, source: "single_offer", candidateVehicleKeys: [KEY], subjectModel: "Compass" } as never;
    check("[H] (2) alvo do turno aceita a MESMA chave", targetAcceptsKey(alvo, KEY) === true);

    // (3) CAPABILITY — governa a AUTORIZAÇÃO do ato pela evidência do bloco
    const uFoto: TurnUnderstanding = { ...U("request_photos"), requestedCapabilities: ["send_photos"], evidence: [{ capability: "send_photos", quote: "manda as fotos" }] };
    const vFoto = validateTurnUnderstanding(uFoto, "manda as fotos", true);
    check("[H] (3) capability autoriza o ato de foto", vFoto.trusted === true && vFoto.understanding.requestedCapabilities.includes("send_photos"));

    // NÃO-VACUIDADE: sem isto o teste passaria mesmo se as validações aceitassem qualquer coisa.
    const inventada = "ford-ecosport-2020";
    check("[H] chave inventada NAO e aterrada", !grounded.has(inventada));
    check("[H] alvo resolvido REJEITA chave de outro carro", targetAcceptsKey(alvo, inventada) === false);

    check("[H] INVARIANTE: execucao e envio concordam na chave aterrada por tool",
      grounded.has(KEY) && targetAcceptsKey(alvo, KEY) === true && !grounded.has(inventada));
  }

  console.log(`\n== F2.70: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("\nFALHAS:\n" + fails.map((f) => ` - ${f}`).join("\n")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
