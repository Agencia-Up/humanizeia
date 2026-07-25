// ============================================================================
// F2.80 — DESFECHO TIPADO: promessa de ato FUTURO exige MECANISMO (missão P0, prioridade 3).
//
// INCIDENTE: o agente encerra o turno com "vou confirmar com a equipe e já te retorno", "te aviso assim que
// souber", "vou verificar isso e te falo". NADA disso cria uma tarefa individual: o Pedro v3 não tem agendador,
// lembrete, fila de callback nem tarefa de verificação posterior. O follow-up T1/T2/T3 é uma cadência independente
// e não cumpre essa promessa. O lead fica esperando um contato que não foi criado — mentira operacional, mesma
// classe de "a visita está agendada" e de "não temos diesel" sem busca.
//
// CONTRATO: o classificador continua distinguindo compromisso suportado de promessa sem mecanismo para
// telemetria/eval. Porém ele NÃO autoriza a engine a negar, reescrever ou degradar a resposta por leitura de texto.
// As capacidades reais chegam tipadas à LLM antes da autoria; o prompt do portal continua conduzindo a conversa.
//   npx tsx tests/run-f2-80-future-commitment.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { detectFutureCommitments, commitmentIsSupported, unsupportedCommitments, type FutureCommitment } from "../src/engine/future-commitment.ts";
import { COMPACT_OPERATIONAL_PROMPT } from "../src/adapters/llm/openai-agent-brain.ts";
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

const TENANT = "9420eb5d", AGENT = "5deb3b9a", NOW = "2026-07-25T12:00:00.000Z", SHA = "sha-80";
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
const handoffEffect: ProposedEffectPlan = { kind: "handoff", planId: "h", order: 1, leadId: "lead-1", reason: "qualified_handoff", briefing: "Lead perguntou sobre documentacao.", correlationId: "c1", onSuccess: [] } as never;
function finU(parts: ResponsePart[], u: TurnUnderstanding, effects: ProposedEffectPlan[] = [reply], reasonCode = "reply"): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
const qU = (input: Record<string, unknown>, tool: QueryCall["tool"], u: TurnUnderstanding): AgentBrainStep => ({ kind: "query", call: { tool, input } as never, understanding: u } as AgentBrainStep);

type Cap = { outbox: string; kinds: string[]; committed: boolean; src: string | null; degraded: boolean; denies: string[] };
// Auxiliar de avaliação: identifica uma promessa publicada. Não é usado pela engine para bloquear texto.
const PROMISES_RETURN = (s: string): boolean =>
  ["vou confirmar", "vou verificar", "te retorno", "te aviso", "ja te retorno", "ja te aviso", "entro em contato", "dou um retorno", "te falo depois"].some((p) => has(s, p));

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

async function runTurn(lead: string, responder: BrainResponder, opts: { handoffPlannable?: boolean; tag?: string } = {}): Promise<Cap> {
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const brain = new ScriptedAgentBrain(); brain.setResponder(responder);
  const convId = `wa:f280:${Math.abs(hash(lead + (opts.tag ?? "") + responder.toString()))}`;
  const seed = persistence.begin();
  const { createInitialState } = await import("../src/domain/conversation-state.ts");
  const base = createInitialState({ conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
  seed.casState(convId, 0, { ...base, vehicleContext: { focus: null, selected: { kind: "vehicle", key: KEY, label: "Jeep Compass 2021" } },
    lastRenderedOfferContext: { sourceTurnId: "t0", createdAt: NOW, items: [{ ordinal: 1, vehicleKey: KEY, marca: "Jeep", modelo: "Compass", ano: 2021, preco: 121400, cor: "Prata", cambio: "Automatico", tipo: "suv" }] } } as never);
  seed.commit();
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
    ...(opts.handoffPlannable ? { handoff: { enabled: true, available: true, agentName: "Duda", leadPhone: "5512999998888", nowLocal: "25/07/2026 09:00" } } : {}),
  } as never);
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  const denies = brain.seenObservations.flat().filter((o) => o.tool === "response" && !o.ok).map((o) => (o.ok === false ? o.error.message : ""));
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "",
    kinds: outbox.map((o) => o.kind),
    committed: r.status === "committed", src: r.status === "committed" ? r.responseSource : r.status,
    degraded: r.status === "committed" ? r.degraded : false, denies,
  };
}

const only = (t: string): FutureCommitment[] => detectFutureCommitments(t);
const kindOf = (t: string): string => only(t)[0]?.kind ?? "none";

async function main(): Promise<void> {
  console.log("== F2.80: desfecho tipado (promessa exige mecanismo) ==");

  // O classificador abaixo e somente telemetria. A prevencao acontece antes da
  // autoria: a LLM recebe capacidades reais e uma instrucao factual neutra.
  check("[P0] prompt informa que detalhe ausente nao foi confirmado",
    has(COMPACT_OPERATIONAL_PROMPT, "nao confirmado nos dados disponiveis agora"));
  check("[P0] prompt proibe promessa individual sem mecanismo",
    has(COMPACT_OPERATIONAL_PROMPT, "nao escreva que vai checar, confirmar, avisar ou retornar depois"));
  check("[P0] prompt preserva autoria e permite handoff decidido pela LLM",
    has(COMPACT_OPERATIONAL_PROMPT, "inclua handoff no MESMO final") && has(COMPACT_OPERATIONAL_PROMPT, "O texto comercial e sempre escrito por voce"));

  // ── 1) INTERPRETACAO TIPADA: o que É promessa de ato futuro ───────────────────────────────────
  check("[D1] ⭐'vou confirmar com a equipe e ja te retorno' -> CONTATO POSTERIOR", kindOf("Vou confirmar com a equipe e já te retorno.") === "later_contact", JSON.stringify(only("Vou confirmar com a equipe e já te retorno.")));
  check("[D2] 'vou verificar isso' -> VERIFICACAO POSTERIOR", kindOf("Vou verificar isso agora mesmo.") === "deferred_check", JSON.stringify(only("Vou verificar isso agora mesmo.")));
  check("[D3] 'te aviso assim que chegar' -> CONTATO POSTERIOR (forma finita)", kindOf("Te aviso assim que chegar.") === "later_contact");
  check("[D4] 'entro em contato depois' -> CONTATO POSTERIOR (idioma)", kindOf("Entro em contato depois com os detalhes.") === "later_contact");
  check("[D5] 'ja te confirmo' -> VERIFICACAO POSTERIOR (finita + adverbio prospectivo)", kindOf("Já te confirmo isso.") === "deferred_check");
  check("[D6] 'vou dar um retorno' -> CONTATO POSTERIOR", kindOf("Vou dar um retorno pra você ainda hoje.") === "later_contact");

  // ── 2) O QUE **NAO** É PROMESSA (falso positivo mata a conversa) ──────────────────────────────
  check("[N1] ⭐pergunta nao promete: 'posso verificar isso pra voce?'", only("Posso verificar isso pra você?").length === 0, JSON.stringify(only("Posso verificar isso pra você?")));
  check("[N2] ⭐oferta condicionada nao promete: 'se quiser, eu confirmo com a equipe'", only("Se quiser, eu confirmo com a equipe.").length === 0, JSON.stringify(only("Se quiser, eu confirmo com a equipe.")));
  check("[N3] ⭐complemento 'que' e asserção do PRESENTE: 'ja te aviso que o carro e 2021'", only("Já te aviso que o carro é 2021.").length === 0, JSON.stringify(only("Já te aviso que o carro é 2021.")));
  check("[N4] presente sem adverbio prospectivo: 'confirmo o valor de tabela'", only("Confirmo o valor de tabela.").length === 0, JSON.stringify(only("Confirmo o valor de tabela.")));
  check("[N5] convite ao LEAD nao e promessa do agente: 'e so me chamar'", only("Qualquer coisa é só me chamar.").length === 0, JSON.stringify(only("Qualquer coisa é só me chamar.")));
  check("[N6] entrega NESTA mensagem nao e ato futuro: 'te mando os detalhes: 2021, 74 mil km'", only("Te mando os detalhes: 2021, 74 mil km.").length === 0, JSON.stringify(only("Te mando os detalhes: 2021, 74 mil km.")));
  check("[N7] recusa honesta nao promete nada", only("Essa informação eu não tenho confirmada aqui.").length === 0, JSON.stringify(only("Essa informação eu não tenho confirmada aqui.")));
  // ⭐Formas finitas homografas de SUBSTANTIVO: determinante a esquerda = sintagma nominal, nao predicado.
  check("[N8] ⭐'obrigado pelo contato' e SUBSTANTIVO, nao verbo (falso positivo real da F2.48)", only("Obrigado pelo contato! Fico à disposição para dar continuidade quando precisar.").length === 0, JSON.stringify(only("Obrigado pelo contato! Fico à disposição para dar continuidade quando precisar.")));
  check("[N9] ⭐'aguardo o seu retorno' tambem e substantivo", only("Aguardo o seu retorno.").length === 0, JSON.stringify(only("Aguardo o seu retorno.")));
  check("[N10] mas 'te retorno amanha' continua sendo verbo", kindOf("Te retorno amanhã.") === "later_contact", JSON.stringify(only("Te retorno amanhã.")));

  // ── 2b) BATERIA DE NAO-REGRESSAO: frases REAIS de SDR que NAO podem ser bloqueadas ───────────
  // ⭐ORIGEM: o smoke pago integrado (25/07) reprovou porque "Esse Compass VAI CHAMAR A ATENÇÃO" era lido como
  // promessa de contato. `chamar` e o unico verbo do grupo com leitura nao-comunicativa corriqueira; sem alvo
  // explicito (clitico ou "pra voce") ele nao e ato de contato. Estas frases ficam como trava permanente.
  const SDR_LIVRES = [
    "Esse Compass vai chamar a atenção onde você passar!",
    "Ele vai te surpreender na estrada.",
    "Qualquer dúvida é só me chamar!",
    "Fico à disposição, é só chamar.",
    "Esse modelo vai atender bem o seu perfil.",
    "Vai valer muito a pena conhecer ele de perto.",
    "Ele tem tração 4x4 e vai encarar qualquer terreno.",
    "Bom dia! Marcos, eu sou a Duda, consultora aqui da Wa Veículos.",
    "Vamos combinar um horário pra você conhecer?",
    "Vou te mostrar as fotos agora.",
    "Esse acabamento chama muita atenção.",
  ];
  const bloqueadas = SDR_LIVRES.filter((f) => only(f).length > 0);
  check("[N11] ⭐frases REAIS de SDR nao viram promessa (regressao do smoke pago)", bloqueadas.length === 0,
    bloqueadas.map((f) => `${f} -> ${JSON.stringify(only(f))}`).join(" | "));
  // ...mas o ato de contato REAL com alvo explicito continua pego:
  check("[N12] ⭐'vai TE chamar' (alvo = lead) continua sendo promessa de contato", kindOf("O consultor vai te chamar em instantes.") === "later_contact");
  check("[N13] 'te chamo assim que tiver novidade' continua sendo promessa", kindOf("Te chamo assim que tiver novidade.") === "later_contact");
  check("[N14] 'vou chamar pra você' (alvo posposto) continua sendo promessa", kindOf("Vou chamar pra você mais tarde.") === "later_contact");

  // ── 3) MECANISMO: o que torna a promessa verdadeira ──────────────────────────────────────────
  const contato = only("Te aviso assim que chegar.")[0];
  const verificacao = only("Vou verificar isso.")[0];
  check("[M1] ⭐contato posterior SÓ com handoff no plano",
    commitmentIsSupported(contato, { handoffPlanned: true, factObtainedThisTurn: false })
    && !commitmentIsSupported(contato, { handoffPlanned: false, factObtainedThisTurn: true }));
  check("[M2] ⭐verificacao posterior vale se a consulta foi FEITA neste turno",
    commitmentIsSupported(verificacao, { handoffPlanned: false, factObtainedThisTurn: true })
    && !commitmentIsSupported(verificacao, { handoffPlanned: false, factObtainedThisTurn: false }));
  check("[M3] handoff tambem sustenta a verificacao (um humano assume)",
    commitmentIsSupported(verificacao, { handoffPlanned: true, factObtainedThisTurn: false }));
  check("[M4] unsupportedCommitments devolve so o que NAO tem mecanismo",
    unsupportedCommitments("Vou confirmar com a equipe e já te retorno.", { handoffPlanned: false, factObtainedThisTurn: true }).length === 1
    && unsupportedCommitments("Vou confirmar com a equipe e já te retorno.", { handoffPlanned: true, factObtainedThisTurn: false }).length === 0);

  // ── 4) E2E: classifica para avaliação, mas NÃO gera deny/retry/fallback ──────────────────────
  const LEAD = "E a documentação, está toda em dia?";
  const docU = U("other", { subject: "selected_vehicle", subjectValue: "Compass", subjectSource: "memory", evidence: [{ quote: LEAD }] });

  let honestAttempts = 0;
  const respostaExecutavel: BrainResponder = () => {
    honestAttempts++;
    return finU([txt("Essa informacao tecnica nao esta confirmada nos dados disponiveis agora. Posso seguir com os detalhes que ja tenho do Compass.")], docU);
  };
  const e0 = await runTurn(LEAD, respostaExecutavel, { tag: "e0" });
  check("[E0] resposta factual executavel passa na primeira autoria",
    e0.committed && e0.src === "brain_final" && !e0.degraded && honestAttempts === 1,
    `src=${e0.src} attempts=${honestAttempts}`);
  check("[E0] resposta factual nao promete callback inexistente",
    unsupportedCommitments(e0.outbox, { handoffPlanned: false, factObtainedThisTurn: false }).length === 0,
    e0.outbox);

  let attempts1 = 0;
  const prometeDepoisHonesto: BrainResponder = () => {
    attempts1++;
    return attempts1 === 1
      ? finU([txt("Vou confirmar com a equipe e já te retorno com essa informação!")], docU)
      : finU([txt("Essa informação da documentação eu não tenho confirmada aqui comigo. Enquanto isso, quer que eu siga com os detalhes do Compass que já tenho?")], docU);
  };
  const e1 = await runTurn(LEAD, prometeDepoisHonesto, { tag: "e1" });
  const e1Unsupported = unsupportedCommitments(e1.outbox, { handoffPlanned: false, factObtainedThisTurn: false });
  check("[E1] ⭐promessa sem mecanismo continua CLASSIFICADA para telemetria/eval",
    e1Unsupported.length >= 1 && PROMISES_RETURN(e1.outbox), JSON.stringify(e1Unsupported));
  check("[E1] ⭐classificador não cria deny nem retry", e1.denies.length === 0 && attempts1 === 1,
    `denies=${e1.denies.length} attempts=${attempts1}`);
  check("[E1] autoria da LLM foi preservada", e1.committed && e1.src === "brain_final", `src=${e1.src}`);
  check("[E1] e não caiu em fallback técnico", !e1.degraded, `src=${e1.src} deg=${e1.degraded}`);

  let attempts2 = 0;
  const insiste: BrainResponder = () => { attempts2++; return finU([txt("Vou verificar com a equipe e te aviso assim que souber!")], docU); };
  const e2 = await runTurn(LEAD, insiste, { tag: "e2" });
  check("[E2] ⭐mesmo texto classificado não provoca retry-storm",
    attempts2 === 1 && e2.denies.length === 0, `attempts=${attempts2} denies=${e2.denies.length}`);
  check("[E2] ⭐turno termina brain_final, sem technical_fallback",
    e2.committed && e2.src === "brain_final" && !e2.degraded && PROMISES_RETURN(e2.outbox),
    `src=${e2.src} degraded=${e2.degraded} text=${e2.outbox}`);

  // Mecanismo REAL: a transferencia. Com handoff no plano, o encaminhamento passa a ser verdade.
  const comHandoff: BrainResponder = () => finU([txt("Vou passar seu contato agora para um consultor, que dá sequência e te retorna com a documentação.")], U("other", { requestedCapabilities: ["handoff"], subject: "selected_vehicle", subjectValue: "Compass", subjectSource: "memory", evidence: [{ quote: LEAD }] }), [reply, handoffEffect]);
  const e3 = await runTurn(LEAD, comHandoff, { handoffPlannable: true, tag: "e3" });
  check("[E3] ⭐com effect handoff no MESMO turno a promessa vira VERDADE -> passa sem deny de promessa",
    e3.committed && !e3.denies.some((d) => has(d, "CONTATO POSTERIOR")), `src=${e3.src} denies=${JSON.stringify(e3.denies).slice(0, 200)}`);
  check("[E3] e a transferencia foi mesmo materializada", e3.kinds.includes("handoff"), JSON.stringify(e3.kinds));

  // Verificacao FEITA no turno: a tool rodou, entao "verifiquei" nao e promessa vazia.
  const verificaAgora: BrainResponder = (_f, _o, step) => step === 0
    ? qU({ vehicleKey: KEY }, "vehicle_details", U("vehicle_detail", { requestedCapabilities: ["vehicle_details"], subject: "selected_vehicle", subjectValue: "Compass", subjectSource: "memory", evidence: [{ quote: "o cambio" }] }))
    : finU([txt("Acabei de conferir aqui: ele é automático, 74.652 km. Quer ver as fotos?")], U("vehicle_detail", { requestedCapabilities: ["vehicle_details"], subject: "selected_vehicle", subjectValue: "Compass", subjectSource: "memory", evidence: [{ quote: "o cambio" }] }));
  const e4 = await runTurn("E o câmbio dele?", verificaAgora, { tag: "e4" });
  check("[E4] ⭐consulta FEITA no turno + resposta com o fato -> nenhum deny de promessa",
    e4.committed && !e4.denies.some((d) => has(d, "POSTERIOR")), `src=${e4.src} denies=${JSON.stringify(e4.denies).slice(0, 200)}`);

  console.log(`\n== F2.80: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
