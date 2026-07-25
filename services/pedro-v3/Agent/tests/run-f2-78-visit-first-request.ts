// ============================================================================
// F2.78 — P0-A/P0-B: o PRIMEIRO pedido de visita nao pode morrer em technical_fallback.
//
// INCIDENTE (smoke real Wa, 24/07, turno T9): lead com veiculo ja aterrado pergunta
// "Consigo ver amanha de manha?" -> degradationKind=response_rejected,
// responseSource=technical_fallback, primaryIntent=other ("Tive uma instabilidade").
//
// CAUSA (P0-A): turn-understanding aceitava `visit` por TEMPORALIDADE apenas quando
// `visitActive` ja era true — e visitActive so liga DEPOIS de uma visita declarada.
// Logo o PRIMEIRO pedido era rejeitado, a LLM (que classificou CERTO) levava
// deny -> retry -> lockedU=null -> fallback. FIX: a temporalidade tambem vale quando ha
// ASSUNTO COMERCIAL ativo ESTRUTURADO (veiculo selecionado / oferta renderizada /
// veiculo do anuncio). Nada de regex nova: a mensagem da a TEMPORALIDADE, a memoria da a
// RELACAO com o veiculo, e a INTENCAO continua sendo declarada pela LLM.
//
// CAUSA (P0-B): a guarda de confirmacao de visita exigia effect `schedule_visit`, que o
// cerebro NAO consegue emitir (schema strict = send_message|send_media|handoff) e que nao
// tem execucao ponta a ponta -> deny SEM SAIDA.
// FIX (rodada 2 do Codex): NENHUM efeito torna verdadeira a frase "visita agendada" — nao existe
// agendamento executavel no v3, e `handoff` prova apenas que um consultor ASSUME, nunca que um
// horario foi RESERVADO. Por isso a guarda nega SEMPRE que o texto afirma agendamento/marcacao/
// confirmacao, INCLUSIVE com handoff valido (regressao [E6a]). A unica saida admissivel — sempre
// executavel pelo proprio autor — e reescrever com ACOLHIMENTO FACTUAL. Com transferencia
// disponivel, o maximo honesto e dizer que vai ENCAMINHAR para um consultor confirmar o horario.
// O feedback nunca cita efeito impossivel NEM ensina promessa de retorno ("vou confirmar"/"te
// aviso"), que seria recriar o defeito de promessa-sem-mecanismo (P2) dentro da propria correcao.
//   npx tsx tests/run-f2-78-visit-first-request.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { hasActiveCommercialSubject, validateTurnUnderstanding, hasActiveVisitContext } from "../src/engine/turn-understanding.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const has = (s: string, n: string): boolean => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());

const TENANT = "9420eb5d", AGENT = "5deb3b9a", NOW = "2026-07-24T12:00:00.000Z", SHA = "sha-78";
const KEY = "revendamais:8251676";
const CAR: VehicleFact = { vehicleKey: KEY, marca: "Jeep", modelo: "Compass", ano: 2021, preco: 121400, km: 74652, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const catalog = buildTenantCatalog([CAR]);
const extractor = new CatalogClaimExtractor(catalog);

const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  if (call.tool === "stock_search") return { ok: true, tool: "stock_search", source: "f", data: { items: [CAR], filtersUsed: {}, matchKind: "exact" } } as QueryResult;
  if (call.tool === "vehicle_details") return { ok: true, tool: "vehicle_details", source: "f", data: { vehicle: CAR } } as QueryResult;
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: "ambiguous" }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent, o: Partial<TurnUnderstanding> = {}): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [], ...o });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const handoffEffect: ProposedEffectPlan = { kind: "handoff", planId: "h", order: 1, leadId: "lead-1", reason: "qualified_handoff", briefing: "Lead quer visita amanha de manha.", correlationId: "c1", onSuccess: [] } as never;
function finU(parts: ResponsePart[], u: TurnUnderstanding, effects: ProposedEffectPlan[] = [reply], reasonCode = "reply"): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}

type Cap = { outbox: string; kinds: string[]; committed: boolean; src: string | null; reason: string | null; degraded: boolean; ts: boolean; denies: string[]; intent: string | null };
// Frases que o sistema NAO pode publicar: afirmacao de agendamento (nao existe mecanismo) e promessa de retorno futuro.
const CLAIMS_SCHEDULED = (s: string): boolean => ["visita esta agendada", "visita agendada", "esta agendada", "visita marcada", "esta marcada", "visita confirmada", "agendada para", "marcada para"].some((p) => has(s, p));
const PROMISES_RETURN = (s: string): boolean => ["vou confirmar", "te retorno", "te aviso", "ja te retorno", "verificar com a equipe", "confirmar com a equipe"].some((p) => has(s, p));

async function runTurn(lead: string, responder: BrainResponder, opts: { seedOffer?: boolean; handoffPlannable?: boolean } = {}): Promise<Cap> {
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const brain = new ScriptedAgentBrain(); brain.setResponder(responder);
  const convId = `wa:f278:${Math.abs(hash(lead + responder.toString()))}`;
  // Assunto comercial ESTRUTURADO: o veiculo do anuncio ja foi apresentado (oferta renderizada).
  if (opts.seedOffer !== false) {
    const seed = persistence.begin();
    const { createInitialState } = await import("../src/domain/conversation-state.ts");
    const base = createInitialState({ conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    seed.casState(convId, 0, { ...base, lastRenderedOfferContext: { sourceTurnId: "t0", createdAt: NOW, items: [{ ordinal: 1, vehicleKey: KEY, marca: "Jeep", modelo: "Compass", ano: 2021, preco: 121400, cor: "Prata", cambio: "Automatico", tipo: "suv" }] } } as never);
    seed.commit();
  }
  await persistence.tryInsert({ eventId: `${convId}-e1`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t1`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery,
    businessInfo: { async get() { return { ok: false as const, error: { code: "NOT_CONFIGURED" as const, message: "n/a" } }; } } as never,
    contextPreparer: new RelPreparer(), conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: "lead-1",
    workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 6, totalTimeoutMs: 9000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 3, brainMaxSteps: 6, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    crmWriteEnabled: true,
    ...(opts.handoffPlannable ? { handoff: { enabled: true, available: true, agentName: "Duda", leadPhone: "5512999998888", nowLocal: "24/07/2026 09:00" } } : {}),
  } as never);
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  const denies = brain.seenObservations.flat().filter((o) => o.tool === "response" && !o.ok).map((o) => (o.ok === false ? o.error.message : ""));
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "",
    kinds: outbox.map((o) => o.kind),
    committed: r.status === "committed", src: r.status === "committed" ? r.responseSource : r.status,
    reason: r.status === "committed" ? r.decision.reasonCode : null, degraded: r.status === "committed" ? r.degraded : false,
    ts: r.status === "committed" ? r.terminalSafe : false, denies,
    intent: r.status === "committed" ? (r.decision as { primaryIntent?: string }).primaryIntent ?? null : null,
  };
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

const visitU = (quote: string): TurnUnderstanding => U("visit", { subject: "selected_vehicle", subjectValue: "Compass", subjectSource: "memory", evidence: [{ quote }] });

async function main(): Promise<void> {
  console.log("== F2.78: primeiro pedido de visita (P0-A/P0-B) ==");

  // ── UNIT: o sinal estruturado de assunto comercial ────────────────────────────────────────────
  check("[U1] veiculo selecionado -> assunto comercial ativo", hasActiveCommercialSubject({ selectedVehicleKey: KEY, renderedOfferCount: 0 }));
  check("[U2] oferta renderizada -> assunto comercial ativo", hasActiveCommercialSubject({ selectedVehicleKey: null, renderedOfferCount: 2 }));
  check("[U3] veiculo do anuncio -> assunto comercial ativo", hasActiveCommercialSubject({ selectedVehicleKey: null, renderedOfferCount: 0, adVehicleKey: KEY }));
  check("[U4] nada estruturado -> SEM assunto comercial", !hasActiveCommercialSubject({ selectedVehicleKey: null, renderedOfferCount: 0, adVehicleKey: null }));
  check("[U5] visitActive segue independente (nao foi afrouxado)", !hasActiveVisitContext({ interesseVisita: false, pendingSchedulingSlot: null, recentTurns: [] }));

  // ── UNIT: validacao do understanding `visit` ──────────────────────────────────────────────────
  const bloco = "Consigo ver amanhã de manhã?";
  const semCtx = validateTurnUnderstanding(visitU(bloco), bloco, true, { visitActive: false, commercialSubjectActive: false });
  check("[U6] temporalidade SEM contexto comercial -> NAO autoriza visita (preservado)", semCtx.trusted === false, JSON.stringify(semCtx.semanticIssues ?? []));
  const comCtx = validateTurnUnderstanding(visitU(bloco), bloco, true, { visitActive: false, commercialSubjectActive: true });
  check("[U7] ⭐temporalidade COM veiculo ativo -> visita confiavel SEM visitActive previo", comCtx.trusted === true, JSON.stringify(comCtx.semanticIssues ?? []));
  const contBloco = "Às 9h";
  const cont = validateTurnUnderstanding(visitU(contBloco), contBloco, true, { visitActive: true, commercialSubjectActive: false });
  check("[U8] continuacao 'As 9h' com visita em andamento continua passando", cont.trusted === true, JSON.stringify(cont.semanticIssues ?? []));
  const explicit = "Quero agendar uma visita";
  const expl = validateTurnUnderstanding(visitU(explicit), explicit, true, { visitActive: false, commercialSubjectActive: false });
  check("[U9] ato explicito de visita passa sem contexto nenhum", expl.trusted === true, JSON.stringify(expl.semanticIssues ?? []));

  // ── E2E 1+2+7: o turno T9 REAL, sem visitActive previo ────────────────────────────────────────
  // ACOLHIMENTO FACTUAL: reconhece a preferencia e pergunta o horario. NAO afirma disponibilidade da
  // loja ("funciona pra gente") nem promete retorno — nenhuma das duas coisas o agente pode garantir.
  const natural: BrainResponder = () => finU([txt("Entendi, você prefere amanhã de manhã. Qual horário seria melhor pra você?")], visitU("Consigo ver amanhã de manhã?"));
  const t1 = await runTurn("Consigo ver amanhã de manhã?", natural);
  check("[E1] ⭐T9 reproduzido: commit pela LLM, ZERO technical_fallback", t1.committed && (t1.src === "brain_final" || t1.src === "brain_retry"), `src=${t1.src} reason=${t1.reason}`);
  check("[E1] sem terminal-safe e sem degradacao", !t1.ts && !t1.degraded, `ts=${t1.ts} deg=${t1.degraded}`);
  check("[E1] acolhimento factual publicado, sem 'instabilidade'", has(t1.outbox, "amanha") && !has(t1.outbox, "instabilidade"), `outbox="${t1.outbox}"`);
  check("[E1] a resposta NAO afirma agendamento nem promete retorno", !CLAIMS_SCHEDULED(t1.outbox) && !PROMISES_RETURN(t1.outbox), `outbox="${t1.outbox}"`);
  check("[E2] nenhuma rejeicao de understanding no caminho", t1.denies.every((d) => !has(d, "visit sem evidencia")), JSON.stringify(t1.denies));

  // ── E2E 3: continuacao "As 9h" — acolhe o horario, sem prometer confirmacao ────────────────────
  const cont9: BrainResponder = () => finU([txt("Perfeito, 9h da manhã. Enquanto isso, quer que eu te passe mais detalhes do Compass?")], visitU("Às 9h"));
  const t3 = await runTurn("Às 9h", cont9);
  check("[E3] 'As 9h' continua funcionando (sem fallback)", t3.committed && t3.src !== "technical_fallback" && !t3.ts, `src=${t3.src}`);
  check("[E3] a resposta NAO afirma agendamento nem promete retorno", !CLAIMS_SCHEDULED(t3.outbox) && !PROMISES_RETURN(t3.outbox), `outbox="${t3.outbox}"`);

  // ── E2E 4: "Vou ver amanha com minha esposa" ──────────────────────────────────────────────────
  // 4a) RESISTENCIA A CLASSIFICACAO ERRADA: o cerebro declara `visit` para um bloco que e deliberacao
  //     do proprio lead. SEM assunto comercial estruturado, a temporalidade NAO autoriza visita.
  const bloco4 = "Vou ver amanhã com minha esposa";
  const semCtx4 = validateTurnUnderstanding(visitU(bloco4), bloco4, true, { visitActive: false, commercialSubjectActive: false });
  check("[E4a] ⭐cerebro declara visit por engano + sem contexto comercial -> REJEITADO", semCtx4.trusted === false, JSON.stringify(semCtx4.semanticIssues ?? []));
  // 4b) O ENGINE nunca INFERE visita: com a LLM declarando smalltalk, nada vira visita.
  const esposa: BrainResponder = () => finU([txt("Claro, sem pressa! Fico à disposição pra quando vocês decidirem.")], U("smalltalk", { evidence: [{ quote: bloco4 }] }));
  const t4 = await runTurn(bloco4, esposa);
  check("[E4b] o engine nao transforma o bloco em visita", t4.committed && t4.intent !== "visit" && !t4.ts, `intent=${t4.intent} src=${t4.src}`);

  // ── E2E 5: draft afirma visita AGENDADA sem efeito -> nao publica, retry com acolhimento factual ─
  let tentativa = 0;
  const confirmaSemEfeito: BrainResponder = () => {
    tentativa += 1;
    if (tentativa === 1) return finU([txt("Pronto! Sua visita está agendada para amanhã de manhã.")], visitU("Consigo ver amanhã de manhã?"));
    return finU([txt("Entendi, você prefere amanhã de manhã. Qual horário seria melhor?")], visitU("Consigo ver amanhã de manhã?"));
  };
  const t5 = await runTurn("Consigo ver amanhã de manhã?", confirmaSemEfeito);
  check("[E5] afirmacao de agendamento NAO e publicada", !CLAIMS_SCHEDULED(t5.outbox), `outbox="${t5.outbox}"`);
  check("[E5] o retry responde com acolhimento factual, sem fallback", t5.committed && t5.src !== "technical_fallback" && !t5.ts, `src=${t5.src}`);
  check("[E5] a resposta final NAO promete retorno futuro", !PROMISES_RETURN(t5.outbox), `outbox="${t5.outbox}"`);
  check("[E5] ⭐o feedback NUNCA cita efeito impossivel (schedule_visit)", t5.denies.every((d) => !has(d, "schedule_visit")), JSON.stringify(t5.denies));
  check("[E5] ⭐o feedback NAO ensina promessa sem mecanismo", t5.denies.every((d) => !has(d, "diga que vai confirmar")), JSON.stringify(t5.denies));
  check("[E5] o feedback oferece saida admissivel (reescrever/acolher)", t5.denies.some((d) => has(d, "reescreva") && has(d, "acolha")), JSON.stringify(t5.denies));

  // ── E2E 6a (REGRESSAO): "visita esta agendada" continua NEGADA mesmo COM handoff ───────────────
  // handoff prova que um consultor assume — NUNCA que um horario foi reservado.
  let tent6 = 0;
  const agendadaComHandoff: BrainResponder = () => {
    tent6 += 1;
    if (tent6 === 1) return finU([txt("Perfeito! Sua visita está agendada para amanhã de manhã.")], visitU("Consigo ver amanhã de manhã?"), [reply, handoffEffect], "qualified_handoff");
    return finU([txt("Entendi, você prefere amanhã de manhã. Vou te encaminhar para um consultor confirmar o horário.")], visitU("Consigo ver amanhã de manhã?"), [reply, handoffEffect], "qualified_handoff");
  };
  const t6a = await runTurn("Consigo ver amanhã de manhã?", agendadaComHandoff, { handoffPlannable: true });
  check("[E6a] ⭐'visita esta agendada' NEGADA mesmo com handoff", tent6 >= 2 && !CLAIMS_SCHEDULED(t6a.outbox), `tentativas=${tent6} outbox="${t6a.outbox}"`);
  check("[E6a] o retry com 'encaminhar para consultor' e aceito", t6a.committed && t6a.src !== "technical_fallback" && !t6a.ts, `src=${t6a.src}`);
  check("[E6a] ⭐a transferencia foi MATERIALIZADA no outbox", t6a.kinds.includes("handoff"), `kinds=${JSON.stringify(t6a.kinds)}`);

  // ── E2E 6b: fraseado correto de handoff passa de primeira e materializa o efeito ───────────────
  const encaminha: BrainResponder = () => finU([txt("Entendi, você prefere amanhã de manhã. Vou te encaminhar para um consultor confirmar o horário.")], visitU("Consigo ver amanhã de manhã?"), [reply, handoffEffect], "qualified_handoff");
  const t6b = await runTurn("Consigo ver amanhã de manhã?", encaminha, { handoffPlannable: true });
  check("[E6b] 'encaminhar para consultor confirmar o horario' passa", t6b.committed && t6b.src !== "technical_fallback" && !t6b.ts, `src=${t6b.src}`);
  check("[E6b] ⭐handoff materializado no outbox (nao basta committed)", t6b.kinds.includes("handoff"), `kinds=${JSON.stringify(t6b.kinds)}`);
  check("[E6b] a resposta NAO afirma agendamento", !CLAIMS_SCHEDULED(t6b.outbox), `outbox="${t6b.outbox}"`);

  console.log(`\n== F2.78: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
