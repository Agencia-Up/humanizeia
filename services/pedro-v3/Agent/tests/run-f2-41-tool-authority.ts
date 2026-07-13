// ============================================================================
// F2.41 — ⭐REFATORAÇÃO DE AUTORIDADE (audit Codex, "dois cérebros"): a LLM decide a tool pela INTENÇÃO do ato
//   conversacional; o detector de constraint NÃO autoriza/força busca (só enriquece). Reproduz o print real:
//   "Corolla não é um sedan? pq disse que não tinha?" é CONTESTAÇÃO (conversation_repair) — o agente reconhece e
//   corrige; NUNCA re-lista estoque como robô.
//   npx tsx tests/run-f2-41-tool-authority.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent, AgentToolObservation } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import { parseOrdinal } from "../src/engine/ordinal.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-08T12:00:00.000Z", SHA = "sha-41";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Estoque do print: 2 Corollas (sedan) + 1 Creta (SUV).
const COR15: VehicleFact = { vehicleKey: "rm:cor15", marca: "Toyota", modelo: "Corolla", ano: 2015, preco: 87990, km: 128000, cambio: "Automatico", cor: "Preto", tipo: "sedan" };
const COR16: VehicleFact = { vehicleKey: "rm:cor16", marca: "Toyota", modelo: "Corolla", ano: 2016, preco: 89990, km: 135000, cambio: "Automatico", cor: "Prata", tipo: "sedan" };
const CRETA: VehicleFact = { vehicleKey: "rm:creta", marca: "Hyundai", modelo: "Creta", ano: 2021, preco: 98000, km: 40000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const STOCK = [COR15, COR16, CRETA];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100, Taubaté", hours: null, unit: "Icom", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { modelo?: string; tipo?: string; precoMax?: number };
    let items = STOCK.slice();
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => toks.every((t) => norm(`${v.marca} ${v.modelo}`).includes(t))); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1"] }, source: "fake" } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }
const searchU = (quote: string): TurnUnderstanding => ({ ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: [{ capability: "stock_search", quote }] });
// Busca Corolla e lista (a LLM decidiu buscar).
const searchCorolla: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (!so) return qU({ tool: "stock_search", input: { modelo: "Corolla" } }, searchU("corolla"));
  return finU([txt("Encontrei estas opções de Toyota Corolla para você:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart, txt("Quer ver as fotos de algum deles?")], "reply", searchU("corolla"));
};

type Slots = ConversationState["slots"];
type Cap = { outbox: string; committed: boolean; stockCalls: number; stockObs: number; terminalSafe: boolean; primaryIntent: string | null; src: string | null; slots: Slots | null; selectedKey: string | null; pf: string[] };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, responder: BrainResponder): Promise<Cap> {
  executed.length = 0; brain.setResponder(responder);
  await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t${seq}`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 3, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  while (true) {
    const claimed = await persistence.claimOutbox(convId, "w", 60_000, 25);
    if (claimed.length === 0) break;
    for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
      const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
      const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
      await commitEffectOutcome({ persistence, clock, conversationId: convId, effectId: rec.effectId, result });
      if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result });
    }
  }
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  const persistedState = persistence.load(convId)?.state ?? null;
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    stockCalls: executed.filter((e) => e.tool === "stock_search").length,
    stockObs: r.status === "committed" ? r.toolObservations.filter((o) => o.tool === "stock_search").length : 0,
    terminalSafe: r.status === "committed" ? r.terminalSafe : false,
    primaryIntent: r.status === "committed" ? r.understanding.primaryIntent : null,
    src: r.status === "committed" ? (r.responseSource ?? null) : null,
    slots: persistedState?.slots ?? null,
    selectedKey: persistedState?.vehicleContext.selected?.key ?? null,
    pf: r.status === "committed" ? r.policyFeedback.map((x) => x.slice(0, 120)) : [],
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:f41_${seq0++}`; let s = 0;
  const t = (lead: string, responder: BrainResponder): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, responder);
  return { t };
}

async function main(): Promise<void> {
  console.log("== F2.41: AUTORIDADE da tool = LLM (ato conversacional), detector só enriquece ==");

  // ── A) O PRINT: "tem corolla?" (busca) -> lista; "Corolla não é um sedan? pq disse que não tinha?" (CONTESTAÇÃO) ->
  //    a LLM reconhece/corrige/conduz. ZERO stock_search no turno de contestação; NUNCA re-lista. ──
  {
    const c = conv();
    const t1 = await c.t("tem corolla?", searchCorolla);
    check("[A-1] 'tem corolla?' (a LLM classificou busca) -> stock_search roda e LISTA", t1.stockCalls === 1 && has(t1.outbox, "Corolla"), `calls=${t1.stockCalls} outbox="${t1.outbox}"`);
    const repair: BrainResponder = () => finU([txt("Você tem razão, me confundi — o Corolla é um sedan sim, me desculpe pela confusão! Os dois Corolla que te mostrei são ótimas opções de sedan. Quer ver as condições de algum deles?")], "conversation_repair", U("conversation_repair"));
    const t2 = await c.t("Corolla não é um sedan? pq disse que não tinha?", repair);
    check("[A-2] contestação -> ZERO stock_search (o detector via Corolla/sedan mas NÃO autoriza mais)", t2.stockCalls === 0 && t2.stockObs === 0, `calls=${t2.stockCalls} obs=${t2.stockObs}`);
    check("[A-3] a LLM reconhece e corrige (autoria despachada, brain_final)", (t2.src === "brain_final" || t2.src === "brain_retry") && has(t2.outbox, "razão"), `src=${t2.src} outbox="${t2.outbox}"`);
    check("[A-4] NÃO re-lista o estoque (sem 'Encontrei estas opções', sem R$)", !has(t2.outbox, "Encontrei estas opções") && !/R\$/.test(t2.outbox), `outbox="${t2.outbox}"`);
    check("[A-5] primaryIntent do turno = conversation_repair (não search_stock)", t2.primaryIntent === "conversation_repair", `intent=${t2.primaryIntent}`);
    check("[A-6] não caiu em terminalSafe", !t2.terminalSafe, `ts=${t2.terminalSafe}`);
  }

  // ── B) INTENT CONTRADITÓRIO: a LLM classifica conversation_repair mas TENTA stock_search -> engine NEGA (feedback
  //    semântico) -> a LLM re-decide e responde a conversa. ──
  {
    const c = conv();
    await c.t("tem corolla?", searchCorolla);
    const confused: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
      const denied = obs.some((o) => o.tool === "response" && !o.ok);
      if (denied) return finU([txt("Verdade, você tem razão — o Corolla é sedan sim! Esses dois que te mostrei são sedans. Quer ver as condições?")], "conversation_repair", U("conversation_repair"));
      return qU({ tool: "stock_search", input: { modelo: "Corolla" } }, { ...U("conversation_repair"), requestedCapabilities: ["stock_search"], evidence: [{ capability: "stock_search", quote: "Corolla" }] });
    };
    const t2 = await c.t("Corolla não é um sedan? pq disse que não tinha?", confused);
    check("[B-1] tool com intent contraditório é NEGADA (0 stock_search executado)", t2.stockCalls === 0, `calls=${t2.stockCalls}`);
    check("[B-2] a LLM re-decide após o feedback e responde a CONVERSA (brain_retry)", (t2.src === "brain_final" || t2.src === "brain_retry") && has(t2.outbox, "razão"), `src=${t2.src} outbox="${t2.outbox}"`);
  }

  // ── C) CONSTRAINT SEM ATO: a frase tem modelo/tipo mas a LLM classifica smalltalk -> NÃO força busca. ──
  {
    const c = conv();
    // (A extração captura tipoVeiculo=sedan da frase; a resposta NÃO repergunta o slot — guarda antiga de repetição.)
    const small: BrainResponder = () => finU([txt("Haha, entendo! Carro de vizinho sempre rende história, né? Se quiser, te mostro umas opções pra você chegar na frente dele. 😄")], "reply", U("smalltalk"));
    const t1 = await c.t("meu vizinho tem um corolla sedan e vive se gabando kkk", small);
    check("[C-1] constraint presente (corolla/sedan) mas ato=smalltalk -> 0 stock_search", t1.stockCalls === 0, `calls=${t1.stockCalls}`);
    check("[C-2] a resposta da LLM é despachada (conversa, não robô)", (t1.src === "brain_final" || t1.src === "brain_retry") && has(t1.outbox, "vizinho"), `src=${t1.src} outbox="${t1.outbox}" pf=${JSON.stringify(t1.pf)}`);
  }

  // ── D) AUTORIDADE POSITIVA: a LLM DECLARA search_stock (capability+evidence) e NÃO chama a tool -> o engine GARANTE
  //    a execução (nunca promessa falsa) — a força continua, agora sob a autoridade da LLM. ──
  {
    const c = conv();
    const lazy: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
      const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
      if (so) return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart], "reply", searchU("tem corolla"));
      return finU([txt("Certo!")], "reply", searchU("tem corolla"));   // declara busca mas não chama a tool
    };
    const t1 = await c.t("tem corolla?", lazy);
    check("[D-1] LLM declarou busca sem executar -> engine garante a execução (stock_search rodou)", t1.stockCalls >= 1, `calls=${t1.stockCalls}`);
  }

  // ── E) ADVERSARIAL (hardening do audit): "outras opções" DENTRO de uma CONTESTAÇÃO — o regex de 'mais opções' casa,
  //    mas o ATO declarado é conversation_repair -> NENHUM caminho determinístico (mentionsMoreOptions) força busca. ──
  {
    const c = conv();
    await c.t("tem corolla?", searchCorolla);   // lista os 2 Corollas (filtro ativo modelo=corolla persiste)
    const repair2: BrainResponder = () => finU([txt("Você tem razão, me desculpe pela confusão — o Corolla é um sedan sim! Os dois que te mostrei são sedans. Quer ver as condições de algum deles?")], "conversation_repair", U("conversation_repair"));
    const t2 = await c.t("Você disse que não tinha outras opções, mas Corolla é sedan?", repair2);
    check("[E-1] 'outras opções' numa CONTESTAÇÃO não força busca (0 stock_search exec+obs)", t2.stockCalls === 0 && t2.stockObs === 0, `calls=${t2.stockCalls} obs=${t2.stockObs}`);
    check("[E-2] a LLM conversa (brain_*), sem pergunta de escopo determinística nem re-lista", (t2.src === "brain_final" || t2.src === "brain_retry") && !has(t2.outbox, "Qual modelo ou tipo") && !has(t2.outbox, "Encontrei estas opções"), `src=${t2.src} outbox="${t2.outbox}"`);
    check("[E-3] primaryIntent = conversation_repair", t2.primaryIntent === "conversation_repair", `intent=${t2.primaryIntent}`);
  }

  // F) INCIDENTE REAL: "pra segunda" e dia de visita, nunca ordinal da lista.
  // A primeira tentativa do brain replica a falha de producao (select/Duster
  // usando "quero agendar visita" como evidence). O contrato de autoridade
  // deve rejeitar essa leitura antes de texto/mutacao, e a mesma LLM reautora.
  {
    check("[F-0] parser ordinal nao transforma 'pra segunda' em item 2", parseOrdinal("pra segunda") == null);
    const c = conv();
    await c.t("tem corolla?", searchCorolla);
    const selectedU: TurnUnderstanding = {
      ...U("select_vehicle"), requestedCapabilities: ["select"], subject: "ordinal_from_last_offer",
      subjectValue: "1", subjectSource: "current_turn", evidence: [{ capability: "select", quote: "primeiro" }],
    };
    await c.t("gostei do primeiro", () => finU([txt("Otima escolha! Quer que eu te passe as condicoes?")], "selected", selectedU));

    const visitResponder: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
      const conflict = obs.some((o) => o.tool === "response" && !o.ok && o.error.code === "UNDERSTANDING_CONFLICT");
      if (!conflict) {
        const wrong: TurnUnderstanding = {
          ...U("other"), requestedCapabilities: ["select"], subject: "selected_vehicle", subjectValue: null,
          subjectSource: "current_turn", evidence: [{ capability: "select", quote: "quero agendar visita" }],
        };
        return finU([txt("Otima escolha! O segundo carro e uma boa opcao. Quer ver as fotos?")], "wrong_stale_selection", wrong);
      }
      const visit: TurnUnderstanding = {
        ...U("visit"), evidence: [{ quote: "quero agendar visita" }], subjectSource: "none",
      };
      const outputDenied = obs.some((o) => o.tool === "response" && !o.ok && o.error.code === "RESPONSE_REJECTED");
      if (outputDenied) return finU([txt("Perfeito, deixei sua preferencia de visita para segunda registrada.")], "visit_monday_confirmed", visit);
      return finU([txt("Perfeito, vamos agendar sua visita para segunda. Qual horario fica melhor para voce?")], "visit_monday", visit);
    };
    const t3 = await c.t("sei sim\nquero agendar visita\npra segunda", visitResponder);
    check("[F-1] entendimento incoerente e rejeitado antes da resposta", t3.pf.some((p) => has(p, "CONFLITO DE AUTORIDADE")), JSON.stringify(t3.pf));
    check("[F-2] LLM reautora como visita e pede o horario faltante, sem recovery", t3.primaryIntent === "visit" && (t3.src === "brain_retry" || t3.src === "brain_final") && has(t3.outbox, "visita") && has(t3.outbox, "segunda") && has(t3.outbox, "horario"), `intent=${t3.primaryIntent} src=${t3.src} out=${t3.outbox}`);
    check("[F-3] visita e segunda persistem", t3.slots?.interesseVisita.value === true && has(String(t3.slots?.diaHorario.value ?? ""), "segunda"), JSON.stringify({ visita: t3.slots?.interesseVisita, dia: t3.slots?.diaHorario }));
    check("[F-4] foco antigo nao e trocado pelo item 2", t3.selectedKey === COR15.vehicleKey, `selected=${t3.selectedKey}`);
    check("[F-5] turno de visita nao chama estoque", t3.stockCalls === 0 && t3.stockObs === 0, `calls=${t3.stockCalls} obs=${t3.stockObs}`);
  }

  // G) INCIDENTE REAL 12/07: abertura sem identidade + burst "Quero suv / Tem?".
  // O engine nao escreve a apresentacao nem executa busca por keyword. Ele devolve
  // feedback semantico e a mesma LLM reautora, declara o ato e usa a tool.
  {
    const c = conv();
    // ⭐RD1-2: a APRESENTAÇÃO na abertura é ADVISORY (isFirstContact). A LLM advertida se apresenta de 1ª; o engine ENTREGA (brain_final).
    const opening: BrainResponder = () => finU([txt("Boa tarde! Eu sou o Aloan, consultor da Icom. Você procura algum modelo, tipo de carro ou faixa de preço?")], "opening_with_identity", U("smalltalk"));
    const t1 = await c.t("Boa tarde", opening);
    check("[G-1] abertura com identidade é ENTREGUE (brain_final), sem fallback", t1.src === "brain_final" && has(t1.outbox, "sou o Aloan") && has(t1.outbox, "Icom"), `src=${t1.src} out=${t1.outbox}`);
    check("[G-2] abertura nao usa recovery deterministico", !String(t1.src).startsWith("deterministic"), `src=${t1.src}`);

    const suvSearch: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
      const stock = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
      if (stock) {
        return finU([
          txt("Separei estas opções de SUV para você:"),
          { type: "vehicle_offer_list", vehicleKeys: stock.data.items.map((item) => item.vehicleKey) } as ResponsePart,
          txt("Qual delas chamou mais sua atenção?"),
        ], "list_suv", searchU("Quero suv"));
      }
      const corrected = obs.some((o) => o.tool === "response" && !o.ok && o.error.code === "SEARCH_ACT_EXPECTED");
      if (corrected) return qU({ tool: "stock_search", input: { tipo: "suv" } }, searchU("Quero suv"));
      return finU([txt("Qual modelo ou tipo de carro você procura? Já busco no estoque para você.")], "wrong_clarify", U("other"));
    };
    const t2 = await c.t("Quero suv\nTem?", suvSearch);
    check("[G-3] pedido SUV malclassificado recebe feedback de ato e a LLM redecide", t2.pf.some((p) => has(p, "ATO ATUAL INCOMPLETO")), JSON.stringify(t2.pf));
    check("[G-4] a LLM chama stock_search uma vez e lista o SUV", t2.stockCalls === 1 && has(t2.outbox, "Creta"), `calls=${t2.stockCalls} out=${t2.outbox}`);
    check("[G-5] nao repete modelo/tipo ja informado nem usa recovery", !has(t2.outbox, "Qual modelo ou tipo") && (t2.src === "brain_retry" || t2.src === "brain_final"), `src=${t2.src} out=${t2.outbox}`);
    check("[G-6] ato final e search_stock", t2.primaryIntent === "search_stock", `intent=${t2.primaryIntent}`);
  }

  console.log(`\n== F2.41: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
