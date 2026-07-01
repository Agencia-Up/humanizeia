import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import type { ClaimExtractor, TurnInterpretation } from "../src/domain/decision.ts";
import { requiredReceiptFor } from "../src/domain/effect-policy.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { applyDecision, applyEffectOutcome } from "../src/engine/state-reducer.ts";
import { buildExplicitSearchTurnOutput } from "../src/engine/explicit-search.ts";
import { extractLeadSlots } from "../src/engine/lead-extraction.ts";
import {
  applySdrConduction,
  buildSdrQualificationPolicy,
  deriveSdrQualification,
} from "../src/engine/sdr-conductor.ts";
import { materializeEffectPlans } from "../src/engine/effect-materializer.ts";import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";

const NOW = "2026-06-30T23:59:00.000Z";
let ok = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log(`  RED ${name} ${detail}`); }
}

const noClaims: ClaimExtractor = { extractClaims: () => [] };
const ambiguous: TurnInterpretation = { relation: "ambiguous" };

function state(): ConversationState {
  return createInitialState({ conversationId: "c", tenantId: "tenant", agentId: "agent", now: NOW });
}

function extract(s: ConversationState, text: string, turnId = "t"): ReturnType<typeof extractLeadSlots> {
  return extractLeadSlots({ leadMessage: text, state: s, interpretation: ambiguous, claimExtractor: noClaims, turnId });
}

const ONIX: VehicleFact = {
  vehicleKey: "stock:onix:2019",
  marca: "Chevrolet",
  modelo: "Onix",
  ano: 2019,
  preco: 59990,
  km: 80000,
  tipo: "hatch",
};

async function main(): Promise<void> {
  console.log("\n=== F2.7.14 SDR conductor ===\n");

  const policy = buildSdrQualificationPolicy({
    qualificationQuestions: [
      "Você já conhece nossa loja?",
      "De qual cidade você fala?",
      "Qual valor de parcela cabe no seu bolso?",
    ],
    agentName: "Aloan",
    companyName: null,
    promptText: 'Apresente-se: "Sou o Aloan, consultor aqui da Icom Motors 😊"',
  });
  check("portal: mapeia conheceLoja", policy.orderedSlots.includes("conheceLoja"));
  check("portal: mapeia cidade", policy.orderedSlots.includes("cidade"));
  check("portal: preserva texto configurado", policy.questions.parcelaDesejada?.includes("parcela") === true);
  const tradePolicy = buildSdrQualificationPolicy({ qualificationQuestions: ["Você tem algum carro para troca?"] });
  check("portal: pergunta booleana de troca mapeia possuiTroca", tradePolicy.orderedSlots.includes("possuiTroca") && !tradePolicy.orderedSlots.includes("veiculoTroca"));
  check("core: nome e interesse sempre primeiro", policy.orderedSlots[0] === "nome" && policy.orderedSlots[1] === "interesse");
  check("portal: apresentação é extraída do prompt", /Aloan.*Icom Motors/i.test(policy.introductionText), policy.introductionText);
  const rawPromptPolicy = buildSdrQualificationPolicy({
    qualificationQuestions: [],
    agentName: "Aloan",
    companyName: null,
    promptText: `Apresente-se: "Sou o Aloan, consultor aqui da Icom Motors 😊"
1. Qual e seu nome?
2. Tem algum carro para dar de troca?
3. Tem valor para dar de entrada?
4. Você sabe onde fica a nossa loja?`,
  });
  check("portal cru: extrai ordem tipada das perguntas numeradas", rawPromptPolicy.orderedSlots.indexOf("possuiTroca") < rawPromptPolicy.orderedSlots.indexOf("entrada") && rawPromptPolicy.orderedSlots.indexOf("entrada") < rawPromptPolicy.orderedSlots.indexOf("conheceLoja"), JSON.stringify(rawPromptPolicy.orderedSlots));
  check("portal cru: preserva perguntas obrigatórias do prompt", rawPromptPolicy.questions.possuiTroca?.includes("troca") === true && rawPromptPolicy.questions.conheceLoja?.includes("loja") === true, JSON.stringify(rawPromptPolicy.questions));

  {
    const s = state();
    const muts = extract(s, "Meu nome é dOUGLAS");
    check("extrai nome normalizado", muts.some((m) => m.op === "set_slot" && m.slot === "nome" && m.value === "Douglas"), JSON.stringify(muts));
  }
  {
    const s = state();
    s.currentObjective = {
      id: "obj-city", type: "perguntou_dados", slot: "cidade", askedAt: NOW, askedInTurnId: "old",
      deliveredByEffectId: "old:reply", deliveryLevel: "accepted", expectedAnswerKinds: ["afirmacao"], status: "pending", attempts: 0,
    };
    const muts = extract(s, "Taubaté");
    check("resposta curta preenche cidade pendente", muts.some((m) => m.op === "set_slot" && m.slot === "cidade" && m.value === "Taubaté"), JSON.stringify(muts));
    check("slot capturado resolve objetivo", muts.some((m) => m.op === "resolve_objective" && m.objectiveId === "obj-city"));
  }
  {
    const s = state();
    s.currentObjective = {
      id: "obj-city-ambiguous", type: "perguntou_dados", slot: "cidade", askedAt: NOW, askedInTurnId: "old",
      deliveredByEffectId: "old:reply", deliveryLevel: "accepted", expectedAnswerKinds: ["afirmacao"], status: "pending", attempts: 0,
    };
    const muts = extract(s, "não sei");
    check("cidade ambígua permanece pendente", !muts.some((m) => m.op === "set_slot" && m.slot === "cidade"), JSON.stringify(muts));
  }
  {
    const s = state();
    s.currentObjective = {
      id: "obj-schedule", type: "perguntou_dados", slot: "diaHorario", askedAt: NOW, askedInTurnId: "old",
      deliveredByEffectId: "old:reply", deliveryLevel: "accepted", expectedAnswerKinds: ["data"], status: "pending", attempts: 0,
    };
    const uncertain = extract(s, "talvez, vou ver");
    const scheduled = extract(s, "sábado às 10h");
    check("agenda ambígua permanece pendente", !uncertain.some((m) => m.op === "set_slot" && m.slot === "diaHorario"), JSON.stringify(uncertain));
    check("agenda explícita é capturada", scheduled.some((m) => m.op === "set_slot" && m.slot === "diaHorario" && /sábado/i.test(String(m.value))), JSON.stringify(scheduled));
  }  {
    const s = state();
    s.currentObjective = {
      id: "obj-pay", type: "perguntou_pagamento", slot: "formaPagamento", askedAt: NOW, askedInTurnId: "old",
      deliveredByEffectId: "old:reply", deliveryLevel: "accepted", expectedAnswerKinds: ["afirmacao"], status: "pending", attempts: 0,
    };
    const muts = extract(s, "Vou financiar, sem entrada e parcela de 1.500");
    check("captura financiamento", muts.some((m) => m.op === "set_slot" && m.slot === "formaPagamento" && m.value === "financiamento"));
    check("captura entrada zero", muts.some((m) => m.op === "set_slot" && m.slot === "entrada" && m.value === 0));
    check("captura parcela", muts.some((m) => m.op === "set_slot" && m.slot === "parcelaDesejada" && m.value === 1500), JSON.stringify(muts));
  }
  {
    const s = state();
    const muts = extract(s, "Tenho um carro 2018 e procuro outro até 80 mil");
    check("ano não vira orçamento", muts.some((m) => m.op === "set_slot" && m.slot === "faixaPreco" && m.value.max === 80000), JSON.stringify(muts));
  }
  {
    const s = state();
    const muts = extract(s, "Vou financiar com entrada de 10 mil e parcela de 1.500");
    check("valores mistos: entrada correta", muts.some((m) => m.op === "set_slot" && m.slot === "entrada" && m.value === 10000), JSON.stringify(muts));
    check("valores mistos: parcela correta", muts.some((m) => m.op === "set_slot" && m.slot === "parcelaDesejada" && m.value === 1500), JSON.stringify(muts));
  }
  {
    const s = state();
    const muts = extract(s, "Vou financiar com parcela de 1.500 e entrada de 10 mil");
    check("valores em ordem inversa: parcela não captura a entrada", muts.some((m) => m.op === "set_slot" && m.slot === "parcelaDesejada" && m.value === 1500), JSON.stringify(muts));
    check("valores em ordem inversa: entrada correta", muts.some((m) => m.op === "set_slot" && m.slot === "entrada" && m.value === 10000), JSON.stringify(muts));
  }
  {
    const s = state();
    const muts = extract(s, "Quero uma picape até 80 mil e não tenho carro para troca");
    check("captura tipo pickup", muts.some((m) => m.op === "set_slot" && m.slot === "tipoVeiculo" && m.value === "pickup"));
    check("captura teto 80 mil", muts.some((m) => m.op === "set_slot" && m.slot === "faixaPreco" && m.value.max === 80000), JSON.stringify(muts));
    check("captura sem troca", muts.some((m) => m.op === "set_slot" && m.slot === "possuiTroca" && m.value === false));
  }

  {
    const s = state();
    s.currentObjective = {
      id: "obj-trade-details", type: "perguntou_troca", slot: "veiculoTroca", askedAt: NOW, askedInTurnId: "old",
      deliveredByEffectId: "old:reply", deliveryLevel: "accepted", expectedAnswerKinds: ["modelo"], status: "pending", attempts: 0,
    };
    const muts = extract(s, "Nao tenho carro pra troca\nvoce tem SUV ate 100k?", "t-no-trade");
    check("sem troca captura possuiTroca=false", muts.some((m) => m.op === "set_slot" && m.slot === "possuiTroca" && m.value === false), JSON.stringify(muts));
    check("sem troca supersede objetivo velho de veiculoTroca", muts.some((m) => m.op === "supersede_objective" && m.objectiveId === "obj-trade-details"), JSON.stringify(muts));
    const applied = applyDecision(s, muts, "t-no-trade", NOW);
    if (!applied.ok) throw new Error(applied.rejected.map((r) => r.reason).join("; "));
    const q = deriveSdrQualification(applied.next, buildSdrQualificationPolicy({ qualificationQuestions: ["Qual Ã© o modelo, ano e quilometragem do veÃ­culo da troca?"] }));
    check("sem troca nÃ£o pergunta modelo/ano/km da troca de novo", q.nextSlot !== "veiculoTroca", JSON.stringify(q));
  }
  {
    const s = state();
    s.currentObjective = {
      id: "obj-stale-trade-details", type: "perguntou_troca", slot: "veiculoTroca", askedAt: NOW, askedInTurnId: "old",
      deliveredByEffectId: "old:reply", deliveryLevel: "accepted", expectedAnswerKinds: ["modelo"], status: "pending", attempts: 0,
    };
    s.slots.nome = { status: "known", value: "Douglas", confidence: 1, updatedAt: NOW };
    s.slots.interesse = { status: "known", value: "suv", confidence: 1, updatedAt: NOW };
    s.slots.faixaPreco = { status: "known", value: { max: 100000 }, confidence: 1, updatedAt: NOW };
    s.slots.formaPagamento = { status: "known", value: "a_vista", confidence: 1, updatedAt: NOW };
    s.slots.possuiTroca = { status: "known", value: false, confidence: 1, updatedAt: NOW };
    const q = deriveSdrQualification(s, buildSdrQualificationPolicy({ qualificationQuestions: ["Qual Ã© o modelo, ano e quilometragem do veÃ­culo da troca?"] }));
    check("objetivo condicional obsoleto nÃ£o vence estado atual", q.nextSlot !== "veiculoTroca", JSON.stringify(q));
  }
  {
    const initial = state();
    const greetingOutput = {
      ...buildExplicitSearchTurnOutput({ kind: "none", label: "teste" }, "t-portal"),
      composed: {
        draft: { parts: [{ type: "text" as const, content: "Bom dia! Você é aqui de Taubaté mesmo ou já conhece nossa loja?" }] },
        text: "Bom dia! Você é aqui de Taubaté mesmo ou já conhece nossa loja?",
      },
    };
    const conductedGreeting = applySdrConduction({ output: greetingOutput, state: initial, policy, turnId: "t-portal" });
    check("portal: primeira mensagem inclui apresentação configurada", /Sou o Aloan.*Icom Motors/i.test(conductedGreeting.composed.text), conductedGreeting.composed.text);
    check("portal: pergunta válida do prompt não é substituída pelo core", /conhece nossa loja\?$/i.test(conductedGreeting.composed.text) && !/qual é o seu nome/i.test(conductedGreeting.composed.text), conductedGreeting.composed.text);
    check("portal: pergunta preservada ganha objetivo tipado", conductedGreeting.decision.decisionMutations.some((m) => m.op === "set_planned_objective" && m.planned.slot === "conheceLoja"));
  }
  const flowState = state();
  flowState.turnNumber = 2;
  flowState.slots.interesse = { status: "known", value: "onix", confidence: 0.95, sourceTurnId: "lead", updatedAt: NOW };
  const offer = buildExplicitSearchTurnOutput({ kind: "offer", label: "Onix", vehicles: [ONIX], missingLabels: [] }, "t1");
  const conducted = applySdrConduction({ output: offer, state: flowState, policy, turnId: "t1" });
  check("answer-first: mantém oferta", /ONIX/i.test(conducted.composed.text), conducted.composed.text);
  check("uma pergunta: escolhe nome", conducted.composed.text.endsWith("Qual é o seu nome?"), conducted.composed.text);
  check("remove CTA genérica anterior", !/fotos.*agendar.*visita\?$/i.test(conducted.composed.text), conducted.composed.text);
  check("planeja objetivo tipado", conducted.decision.decisionMutations.some((m) => m.op === "set_planned_objective" && m.planned.slot === "nome"));
  check("liga objetivo ao send_message", conducted.decision.effectPlan.some((p) => p.kind === "send_message" && p.onSuccess.some((o) => o.op === "activate_objective")));

  const questionOnly = applySdrConduction({
    output: { ...offer, composed: { draft: { parts: [{ type: "text", content: "Quer ver fotos?" }] }, text: "Quer ver fotos?" } },
    state: flowState,
    policy,
    turnId: "t-question",
  });
  check("reação/continuidade: pergunta genérica cede ao próximo slot", questionOnly.composed.text === "Qual é o seu nome?", questionOnly.composed.text);

  const committed = applyDecision(flowState, conducted.decision.decisionMutations, "t1", NOW);
  if (!committed.ok) throw new Error(committed.rejected.map((r) => r.reason).join("; "));
  const records = materializeEffectPlans(conducted.decision, conducted.composed, { conversationId: "c", createdAt: NOW });
  const messageRecord = records.find((r) => r.kind === "send_message");
  check("objetivo + memória são accepted-safe", !!messageRecord && requiredReceiptFor(messageRecord) === "accepted", JSON.stringify(messageRecord?.onSuccess));
  const messagePlan = conducted.decision.effectPlan.find((p) => p.kind === "send_message");
  if (!messagePlan) throw new Error("send_message ausente");
  const outcome = applyEffectOutcome(committed.next, messagePlan, {
    status: "succeeded",
    effectId: messagePlan.effectId,
    receipt: { effectId: messagePlan.effectId, level: "accepted", at: NOW },
  });
  if (!outcome.ok) throw new Error(outcome.rejected.map((r) => r.reason).join("; "));
  check("accepted ativa pergunta atual", outcome.next.currentObjective?.slot === "nome" && outcome.next.currentObjective.deliveryLevel === "accepted");

  const nameMutations = extract(outcome.next, "Douglas", "t2");
  const named = applyDecision(outcome.next, nameMutations, "t2", NOW);
  if (!named.ok) throw new Error(named.rejected.map((r) => r.reason).join("; "));
  check("resposta salva nome", named.next.slots.nome.value === "Douglas");
  check("resposta satisfaz objetivo", named.next.currentObjective?.status === "satisfied");

  const view = deriveSdrQualification(named.next, policy);
  check("não repergunta nome", view.nextSlot !== "nome", JSON.stringify(view));
  check("próxima lacuna é pergunta configurada antes do core restante", view.nextSlot === "conheceLoja", JSON.stringify(view));

  {
    const s = state();
    for (const slot of ["nome", "interesse", "faixaPreco", "formaPagamento", "possuiTroca", "interesseVisita"] as const) {
      (s.slots[slot] as any) = { status: "known", value: slot === "possuiTroca" || slot === "interesseVisita" ? false : slot, confidence: 1, updatedAt: NOW };
    }
    s.slots.formaPagamento.value = "financiamento";
    const q = deriveSdrQualification(s, buildSdrQualificationPolicy({ qualificationQuestions: null }));
    check("financiamento abre entrada antes de handoff", q.missingSlots.includes("entrada") && q.nextSlot === "entrada" && !q.readyForHandoff, JSON.stringify(q));
    s.slots.entrada = { status: "known", value: 10000, confidence: 1, updatedAt: NOW };
    s.slots.parcelaDesejada = { status: "known", value: 1500, confidence: 1, updatedAt: NOW };
    const ready = deriveSdrQualification(s, buildSdrQualificationPolicy({ qualificationQuestions: null }));
    check("só fica pronto após condicionais", ready.readyForHandoff === true, JSON.stringify(ready));
  }

  {
    const clock = new FakeClock(NOW);
    const persistence = new InMemoryPersistence(clock, new FakeIdGen());
    const tenantCatalog = buildTenantCatalog([ONIX]);
    const claimExtractor = new CatalogClaimExtractor(tenantCatalog);
    const runQuery: QueryRunner = async (call) => call.tool === "stock_search"
      ? { ok: true, tool: "stock_search", data: { items: [ONIX], filtersUsed: call.input }, source: "fake" }
      : { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "not found", retryable: false } } as any;
    await persistence.tryInsert({
      eventId: "e-sdr-offer",
      conversationId: "c-sdr-offer",
      raw: { __redacted: true, text: "tem onix?" },
      receivedAt: NOW,
    });
    const result = await runConversationTurn({
      persistence,
      clock,
      llm: new FakeLlm(),
      runQuery,
      conversationId: "c-sdr-offer",
      tenantId: "tenant",
      agentId: "agent",
      leadId: null,
      workerId: "worker",
      turnId: "t-sdr-offer",
      leaseTtlMs: 60_000,
      interpretation: { relation: "asks_vehicle_detail" },
      tenantCatalog,
      claimExtractor,
      limits: { maxSteps: 4, totalTimeoutMs: 5_000 },
      maxValidationAttempts: 2,
      providerCapability: { send_message: "none" },
      sdrPolicy: buildSdrQualificationPolicy({ qualificationQuestions: null }),
    });
    const snapshot = await persistence.load("c-sdr-offer");
    check("integração: oferta com SDR commita", result.status === "committed", result.status);
    check(
      "integração: SDR preserva contexto ordinal da lista",
      snapshot?.state.lastRenderedOfferContext?.items[0]?.vehicleKey === ONIX.vehicleKey,
      JSON.stringify(snapshot?.state.lastRenderedOfferContext),
    );
    check(
      "integração: pergunta SDR fica planejada sem apagar oferta",
      snapshot?.state.plannedObjectives.some((objective) => objective.slot === "nome") === true,
      JSON.stringify(snapshot?.state.plannedObjectives),
    );
  }
  console.log(`\n=== F2.7.14: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) {
    failures.forEach((item) => console.error("  - " + item));
    process.exit(1);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });