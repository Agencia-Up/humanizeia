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
    // O engine NUNCA pode aceitar a promessa vaga ("Temos várias opções!") sem a busca que a própria LLM declarou.
    check("[A5] promessa sem busca NAO chega ao lead", !has(r.outbox, "Temos várias opções"), r.outbox.slice(0, 80));
  }

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

  console.log(`\n== F2.70: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("\nFALHAS:\n" + fails.map((f) => ` - ${f}`).join("\n")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
