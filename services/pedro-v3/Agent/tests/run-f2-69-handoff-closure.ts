// ============================================================================
// F2.69 — DEGRAU 1 (2026-07-18): FECHAMENTO + TRANSFERÊNCIA. Offline/$0, ZERO OpenAI.
//
// INCIDENTE REAL (lead 12 99143-5454, Icom): o lead viu o EcoSport do anúncio, ofereceu o Fox 2020 na troca, disse
// "Vou até ai sou de sjc." e o agente respondeu "estaremos te aguardando" SEM propor transferência. Como o handoff
// nunca aconteceu, o estado não virou `handoff`, o follow-up não foi suspenso e o lead levou 5 nags em 18 minutos.
// Medição de produção: 207 turnos / 55 conversas com transferência SEMPRE disponível (plannable=true) e ZERO
// propostas de qualified_handoff pela LLM.
//
// CAUSA (Degrau 1): o HANDOFF_PROTOCOL — o texto que ensina QUANDO transferir — era código morto, nunca concatenado
// a prompt nenhum. Ao compactar o protocolo, a seção de transferência ficou só com o caso explícito ("cliente pediu
// humano") e a metade do qualified_handoff (a LLM DECIDE) se perdeu. A semântica foi incorporada ao protocolo ÚNICO.
//
// ESTE TESTE NÃO PROVA QUE A LLM DECIDE (isso é comportamento de modelo). Ele prova o CONTRATO em volta da decisão:
//   A) o gate de qualificação, medido como unidade pura — responde se `qualified_handoff` passaria para este lead;
//   B) o protocolo enviado ao modelo realmente ensina a transferência (anti-regressão do código morto);
//   C) quando a LLM decide, o efeito chega ao outbox (explicit_human_request, que não depende de qualificação);
//   D) handoff materializado suspende o follow-up.
//   npx tsx tests/run-f2-69-handoff-closure.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy, isSdrHandoffReadyForIntent } from "../src/engine/sdr-conductor.ts";
import { resolveHandoffReason } from "../src/engine/handoff-plan.ts";
import { HANDOFF_REASON_LABEL } from "../src/engine/transfer-templates.ts";
import { classifySdrCategory } from "../src/engine/briefing-builder.ts";
import { isVisitAct, declaresVisitInterestWithoutSchedule } from "../src/engine/visit-semantics.ts";
import { evaluateFollowupDue, isFollowupSuspended } from "../src/engine/followup-policy.ts";
import { resolveAutomationRules } from "../src/engine/automation-rules.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer, TurnContextPreparation } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-18T16:10:00.000Z";
const SHA = "sha-f269";

const ECOSPORT: VehicleFact = { vehicleKey: "rm:ecosport", marca: "Ford", modelo: "EcoSport", ano: 2020, preco: 71990, km: 108600, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const catalog = buildTenantCatalog([ECOSPORT]);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);

const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  if (call.tool === "vehicle_details") return { ok: true, tool: "vehicle_details", data: { vehicle: ECOSPORT }, source: "fake" } as QueryResult;
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer {
  constructor(public relation: TurnRelation = "ambiguous") {}
  async prepare(): Promise<TurnContextPreparation> { return { interpretation: { relation: this.relation } as never, tenantCatalog: catalog, claimExtractor: extractor }; }
}
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } });

const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const handoffEffect = (reason: string): ProposedEffectPlan =>
  ({ kind: "handoff", planId: "handoff", order: 1, dependsOn: [], onSuccess: [], leadId: "", reason, briefing: "" } as unknown as ProposedEffectPlan);

function U(primaryIntent: PrimaryIntent, quote: string, capability = "handoff"): TurnUnderstanding {
  return { primaryIntent, requestedCapabilities: [capability as never], subject: "selected_vehicle", subjectValue: null, subjectSource: "memory", evidence: [{ capability: capability as never, quote }], isTopicChange: false, answeredLeadQuestions: [] };
}
function finalWith(parts: ResponsePart[], u: TurnUnderstanding, effects: ProposedEffectPlan[]): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode: "reply", reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}

// Estado do incidente: EcoSport já apresentado/selecionado (o lead veio do anúncio e conversou sobre ele).
function seedIncident(convId: string, opts: { visitaKnown?: boolean; diaHorario?: string | null } = {}): ConversationState {
  const s = createInitialState({ conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: LEAD, now: NOW });
  s.vehicleContext.selected = { kind: "vehicle", key: ECOSPORT.vehicleKey, label: "Ford EcoSport 2020" };
  if (opts.visitaKnown) s.slots.interesseVisita = { ...s.slots.interesseVisita, status: "known", value: true } as never;
  if (opts.diaHorario) s.slots.diaHorario = { ...s.slots.diaHorario, status: "known", value: opts.diaHorario } as never;
  return s;
}

let seq = 0;
async function runTurn(args: { state: ConversationState; leadText: string; step: AgentBrainStep; handoffAvailable?: boolean }): Promise<{ r: CentralTurnResult; outboxKinds: string[]; text: string }> {
  seq += 1;
  const convId = `wa:f269_${seq}`;
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const seeded = { ...args.state, conversationId: convId };
  { const uow = persistence.begin(); uow.casState(convId, 0, seeded); await uow.commit(); }
  await persistence.tryInsert({ eventId: `${convId}-e1`, conversationId: convId, raw: redact({ text: args.leadText }), receivedAt: clock.now() });
  clock.advance(1000);
  const brain = new ScriptedAgentBrain();
  brain.setTurnScript([args.step]);
  const r = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: new RelPreparer("ambiguous"),
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: LEAD, crmWriteEnabled: true,
    handoff: { enabled: true, available: args.handoffAvailable ?? true, agentName: "Aloan", leadPhone: "5512991435454", leadDisplayName: "Cliente", nowLocal: "18/07/2026 13:10" } as never,
    workerId: "w", turnId: `${convId}-t1`, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 6, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 4, sdrPolicy,
    allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  const outbox = await persistence.listOutbox(convId);
  const msg = outbox.find((o) => o.kind === "send_message");
  return { r, outboxKinds: outbox.map((o) => o.kind), text: ((msg?.payload as { text?: string } | undefined)?.text ?? "") };
}

async function main(): Promise<void> {
  console.log("== F2.69 fechamento + transferência (Degrau 1) ==");

  // ── A) GATE DE QUALIFICAÇÃO como UNIDADE PURA. Responde: qualified_handoff passaria para o lead do incidente? ──
  {
    const semNada = seedIncident("c-a1");
    const soVisita = seedIncident("c-a2", { visitaKnown: true });
    const completo = seedIncident("c-a3", { visitaKnown: true, diaHorario: "sábado às 10h" });

    check("[A1] intent 'other' (o que produção emitiu) NUNCA passa no gate",
      isSdrHandoffReadyForIntent(soVisita, sdrPolicy, "other") === false);
    check("[A2] intent 'visit' SEM dia/horário NÃO passa — é o lead do incidente ('Vou até ai sou de sjc')",
      isSdrHandoffReadyForIntent(soVisita, sdrPolicy, "visit") === false);
    check("[A3] intent 'visit' COM dia/horário passa",
      isSdrHandoffReadyForIntent(completo, sdrPolicy, "visit") === true,
      `ready=${isSdrHandoffReadyForIntent(completo, sdrPolicy, "visit")}`);
    check("[A4] declarar visita sem marcar horário não vira atalho (sem visita conhecida também nega)",
      isSdrHandoffReadyForIntent(semNada, sdrPolicy, "visit") === false);
  }

  // ── B) ANTI-REGRESSÃO DO CÓDIGO MORTO: o protocolo REALMENTE enviado ensina transferência por decisão da LLM. ──
  {
    const src = readFileSync(new URL("../src/adapters/llm/openai-agent-brain.ts", import.meta.url), "utf8");
    const compactStart = src.indexOf("const COMPACT_OPERATIONAL_PROMPT = `");
    const compactEnd = src.indexOf("`;", compactStart);
    const enviado = compactStart >= 0 && compactEnd > compactStart ? src.slice(compactStart, compactEnd) : "";
    check("[B1] protocolo operacional único foi localizado", enviado.length > 0);
    check("[B2] ele ENSINA que qualified_handoff é decisão da LLM e NÃO depende de o cliente pedir",
      /qualified_handoff/.test(enviado) && /N[ÃA]O depende de o cliente pedir/i.test(enviado),
      "a metade da decisão autônoma sumiu de novo na compactação");
    check("[B3] ele mantém o pedido explícito sem exigir CPF/qualificação",
      /explicit_human_request/.test(enviado) && /CPF/.test(enviado));
    check("[B4] ele exige o efeito no MESMO final quando prometer encaminhar",
      /MESMO final/.test(enviado));
    check("[B5] o antigo bloco morto NÃO voltou (segunda autoridade textual)",
      !src.includes("=== CAPABILITY DE TRANSFERENCIA (ATIVA) ==="));
  }

  // ── C) DECISÃO DA LLM -> EFEITO MATERIALIZADO. explicit_human_request não depende de qualificação. ──
  {
    const pedido = await runTurn({
      state: seedIncident("c-c1"),
      leadText: "Quero falar com um vendedor, por favor",
      step: finalWith([txt("Claro! Já estou te encaminhando para um consultor.")], U("request_human", "falar com um vendedor"), [reply, handoffEffect("explicit_human_request")]),
    });
    check("[C1] pedido explícito: turno commita", pedido.r.status === "committed", pedido.r.status);
    check("[C2] pedido explícito: efeito handoff CHEGA ao outbox (decisão da LLM executada)",
      pedido.outboxKinds.includes("handoff"), `outbox=[${pedido.outboxKinds.join(",")}]`);
    check("[C3] pedido explícito NÃO exige nome/CPF na resposta",
      !/cpf|documento/i.test(pedido.text), pedido.text);

    // Mesmo ato, transferência indisponível: a LLM NÃO pode prometer consultor (honestidade), e nada quebra.
    const indisponivel = await runTurn({
      state: seedIncident("c-c2"),
      leadText: "Quero falar com um vendedor, por favor",
      step: finalWith([txt("Claro! Já estou te encaminhando para um consultor.")], U("request_human", "falar com um vendedor"), [reply, handoffEffect("explicit_human_request")]),
      handoffAvailable: false,
    });
    check("[C4] transferência indisponível: turno ainda responde o lead (sem silêncio)",
      indisponivel.r.status === "committed" && indisponivel.text.length > 0, indisponivel.r.status);
    check("[C5] transferência indisponível: NÃO materializa handoff",
      !indisponivel.outboxKinds.includes("handoff"), `outbox=[${indisponivel.outboxKinds.join(",")}]`);
  }

  // ── D) HANDOFF MATERIALIZADO SUSPENDE O FOLLOW-UP (o sintoma dos 5 nags em 18 min). ──
  {
    const rules = resolveAutomationRules({ followup: { enabled: true, t1_min: 5, t2_min: 8, t3_min: 12, t3_transfers: true }, transfer: { enabled: true, seller_response_min: 10 } });
    const anchorAt = "2026-07-18T16:00:00.000Z";
    const later = "2026-07-18T16:30:00.000Z";
    const anchor: OutboxRecord = { effectId: "t1:message", conversationId: "wa:f269d", turnId: "t1", planId: "message", kind: "send_message", idempotencyKey: "t1:message", order: 1, dependsOn: [], payload: { text: "Perfeito, estaremos te aguardando aqui na loja.", __redacted: true }, onSuccess: [], status: "succeeded", providerCapability: "none", receiptLevel: "delivered", attempts: 1, nextRetryAt: null, providerReceipt: null, outcomeAppliedAt: anchorAt, lastError: null, createdAt: anchorAt, dispatchedAt: anchorAt };

    const aberto = createInitialState({ conversationId: "wa:f269d", tenantId: TENANT, agentId: AGENT, leadId: LEAD, now: anchorAt });
    check("[D1] SEM handoff o follow-up dispara (era o comportamento do incidente)",
      evaluateFollowupDue({ state: aberto, outbox: [anchor], rules: rules.followup, now: later }) != null);

    const transferido = createInitialState({ conversationId: "wa:f269d", tenantId: TENANT, agentId: AGENT, leadId: LEAD, now: anchorAt });
    transferido.stage = "handoff";
    transferido.followupSuspendedAt = anchorAt;
    check("[D2] handoff materializado marca a conversa como suspensa", isFollowupSuspended(transferido) === true);
    check("[D3] COM handoff o follow-up NÃO dispara (mata os 5 nags)",
      evaluateFollowupDue({ state: transferido, outbox: [anchor], rules: rules.followup, now: later }) == null);
  }

  // ── E) DEGRAU 2 — handoff_after_closure: o lead do incidente, que o gate de qualificação REJEITARIA. ──
  {
    // E1 é o caso REAL: EcoSport do anúncio + troca informada + "vou até ai sou de sjc", SEM dia/horário marcado.
    // Antes do Degrau 2 a LLM só tinha qualified_handoff, que [A2] prova ser negado aqui. Agora ela declara
    // encerramento-com-transferência e o efeito precisa SOBREVIVER até o outbox.
    // ⭐DEGRAU 3: agora com primaryIntent="visit" — o FLUXO REAL. Antes do fix da semântica de visita este mesmo
    // caso era rejeitado (VISIT_ACT_RX não casava "vou até aí") e degradava para "instabilidade".
    const encerrou = await runTurn({
      state: seedIncident("c-e1"),
      leadText: "Vou até ai sou de sjc.",
      step: finalWith(
        [txt("Perfeito! Vou te passar para um consultor que te recebe na loja.")],
        U("visit", "Vou até ai"),
        [reply, handoffEffect("handoff_after_closure")],
      ),
    });
    check("[E1] lead interessado + pouco qualificado: turno commita", encerrou.r.status === "committed", encerrou.r.status);
    check("[E1] handoff_after_closure NÃO é barrado pelo gate de qualificação (o caso do incidente)",
      encerrou.outboxKinds.includes("handoff"), `outbox=[${encerrou.outboxKinds.join(",")}]`);
    check("[E1] a resposta ao lead continua sendo a da LLM (engine não reescreveu)",
      /consultor/i.test(encerrou.text), encerrou.text);

    // E2: mesmo ato, mas SEM transferência executável -> não materializa e não promete (honestidade).
    const semVendedor = await runTurn({
      state: seedIncident("c-e2"),
      leadText: "Vou até ai sou de sjc.",
      step: finalWith([txt("Perfeito! Vou te passar para um consultor.")], U("other", "Vou até ai"), [reply, handoffEffect("handoff_after_closure")]),
      handoffAvailable: false,
    });
    check("[E2] sem vendedor disponível NÃO materializa handoff (executabilidade continua valendo)",
      !semVendedor.outboxKinds.includes("handoff"), `outbox=[${semVendedor.outboxKinds.join(",")}]`);
    check("[E2] e o lead ainda recebe resposta (sem silêncio)", semVendedor.text.length > 0);

    // E3 — a MESMA frase por outra forma verbal. Prova que o fix é por CLASSE (deslocamento + destino), não por frase:
    // "passo aí" (1ª pessoa, verbo diferente) tem que valer tanto quanto "vou até aí".
    const outraForma = await runTurn({
      state: seedIncident("c-e3"),
      leadText: "Beleza, passo aí amanhã então.",
      step: finalWith([txt("Combinado! Te encaminho para um consultor.")], U("visit", "passo aí amanhã"), [reply, handoffEffect("handoff_after_closure")]),
    });
    check("[E3] outra conjugação ('passo aí') também vale — fix por classe, não por frase",
      outraForma.outboxKinds.includes("handoff"), `outbox=[${outraForma.outboxKinds.join(",")}]`);
  }

  // ── H) DEGRAU 3 — SEMÂNTICA DE VISITA em unidade pura. O risco aqui é FALSO POSITIVO. ──
  {
    for (const [frase, esperado] of [
      ["Vou até ai sou de sjc.", true],
      ["passo aí amanhã", true],
      ["vou na loja hoje", true],
      ["chego aí umas 15h", true],
      ["quero agendar uma visita", true],
      ["posso conhecer o carro de perto?", true],
      // FALSOS POSITIVOS que o Codex exigiu barrar — deslocamento SEM destino não é visita:
      ["ok", false],
      ["vou pensar", false],
      ["vou ver com minha esposa", false],
      ["vou fazer uma proposta", false],
      ["vou querer financiar", false],
      // Recusa vence o deslocamento:
      ["não vou aí não", false],
      ["não quero visitar agora", false],
    ] as const) {
      check(`[H] isVisitAct("${frase}") === ${esperado}`, isVisitAct(frase) === esperado, `deu ${isVisitAct(frase)}`);
    }
    check("[H] interesse em visitar É SEPARADO de agendamento (sem dia/hora continua sendo interesse)",
      declaresVisitInterestWithoutSchedule("Vou até ai sou de sjc.", false) === true);
    check("[H] com dia/hora informado, não é mais 'interesse sem agendamento'",
      declaresVisitInterestWithoutSchedule("vou aí sábado às 10h", true) === false);
  }

  // ── F) PRECEDÊNCIA: forcedReason NÃO pode renomear encerramento-com-lead-interessado como desinteresse. ──
  {
    const decisionWith = (reason: string) => ({ effectPlan: [{ kind: "handoff", reason }] } as never);
    check("[F1] handoff_after_closure VENCE forcedReason=silent_disengagement (vendedor não recebe 'sem interesse')",
      resolveHandoffReason(decisionWith("handoff_after_closure"), "silent_disengagement_handoff") === "handoff_after_closure");
    check("[F2] sem autoria de encerramento, o forçado continua valendo (opt-out explícito preservado)",
      resolveHandoffReason(decisionWith("qualified_handoff"), "silent_disengagement_handoff") === "silent_disengagement_handoff");
    check("[F3] sem forçado, a autoria da LLM vale",
      resolveHandoffReason(decisionWith("handoff_after_closure"), null) === "handoff_after_closure");
    check("[F4] followup_timeout (timer, não conversa) continua forçando",
      resolveHandoffReason(decisionWith("handoff_after_closure"), "followup_timeout_handoff") === "followup_timeout_handoff");
    check("[F5] motivo não-originável pela decisão continua rejeitado",
      resolveHandoffReason(decisionWith("returning_lead_renotify"), null) === null);
  }

  // ── G) BRIEFING: o vendedor precisa saber que é lead interessado e POUCO qualificado (não desinteresse). ──
  {
    const st = seedIncident("c-g1");
    // Invariante que importa: handoff_after_closure NÃO pode forjar "lead qualificado" no painel do vendedor.
    // (a categoria exata depende da atividade do lead; o que não pode acontecer é virar "qualificado".)
    const cat = classifySdrCategory(st, { readyToTransfer: false });
    const catQualificado = classifySdrCategory(st, { readyToTransfer: true });
    check("[G1] handoff_after_closure NÃO classifica o lead como 'qualificado'", cat !== "qualificado", `cat=${cat}`);
    check("[G1b] e o flag readyToTransfer é o que muda isso (prova de não-vacuidade)",
      catQualificado === "qualificado", `catQualificado=${catQualificado}`);
    const label = HANDOFF_REASON_LABEL.handoff_after_closure;
    check("[G2] rótulo do briefing diz interesse + continuidade, NÃO desinteresse",
      /interessado/i.test(label) && !/sem interesse/i.test(label), label);
  }

  console.log(`\n== F2.69: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.stack ?? e); process.exit(1); });
