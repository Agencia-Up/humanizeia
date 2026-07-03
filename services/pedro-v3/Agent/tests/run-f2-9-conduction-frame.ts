// ============================================================================
// F2.9 — Testes ESTRUTURAIS do SDR Conduction Frame (R11). Puros, determinísticos, $0.
// Validam as SAÍDAS ESTRUTURADAS do frame (stage/buySignal/forbidden/nextAllowed/
// mustAnswerFirst/answeredObjective) — não o wording do LLM (isso é do eval real).
// ============================================================================
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState, PendingObjective } from "../src/domain/conversation-state.ts";
import type { TurnInterpretation } from "../src/domain/decision.ts";
import { buildSdrConductionFrame } from "../src/engine/sdr-conduction-frame.ts";
import { buildSdrQualificationPolicy, deriveSdrQualification, DEFAULT_QUESTIONS } from "../src/engine/sdr-conductor.ts";

const NOW = "2026-07-02T12:00:00.000Z";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const policy = buildSdrQualificationPolicy({ qualificationQuestions: null, agentName: "Aloan", companyName: "Icom" });
const kn = (value: unknown) => ({ status: "known" as const, value, confidence: 1, updatedAt: NOW });
const base = (over: Partial<ConversationState> = {}): ConversationState => ({
  ...createInitialState({ conversationId: "c", tenantId: "icom", agentId: "aloan", now: NOW }), turnNumber: 2, ...over,
});
function withSlots(slots: Record<string, unknown>, over: Partial<ConversationState> = {}): ConversationState {
  const b = base(over);
  return { ...b, slots: { ...b.slots, ...(slots as ConversationState["slots"]) } };
}
function frameOf(state: ConversationState, leadMessage: string, interpretation?: TurnInterpretation | null, reasonCode = "reply") {
  const view = deriveSdrQualification(state, policy);
  const nextQuestion = view.nextSlot ? (policy.questions[view.nextSlot] ?? DEFAULT_QUESTIONS[view.nextSlot]) : null;
  const firstContact = state.turnNumber === 0 && !state.recentTurns.some((t) => t.role === "agent");
  return buildSdrConductionFrame({ state, leadMessage, interpretation, view, nextQuestion, reasonCode, isFirstContact: firstContact });
}
function pendingObj(slot: PendingObjective["slot"]): PendingObjective {
  return { id: `o-${slot}`, type: "perguntou_dados", slot, askedAt: NOW, askedInTurnId: "t0", deliveredByEffectId: "e0", deliveryLevel: "accepted", expectedAnswerKinds: ["afirmacao"], status: "pending", attempts: 0 };
}

async function main(): Promise<void> {
  console.log("\n=== F2.9 SDR Conduction Frame ===\n");

  // 1) nome respondido -> forbidden inclui nome; nextAllowed != nome; answeredObjective=nome.
  {
    const st = withSlots({ nome: kn("Douglas") }, { currentObjective: pendingObj("nome") });
    const f = frameOf(st, "Douglas");
    check("1 nome known -> forbiddenQuestions inclui 'nome'", f.forbiddenQuestions.includes("nome"));
    check("1 nextAllowedQuestion NÃO é 'nome'", f.nextAllowedQuestion?.slot !== "nome");
    check("1 answeredObjective = nome (objetivo pendente resolvido)", f.answeredObjective === "nome");
    check("1 guidance nunca sugere reperguntar nome", !/pergunta sugerida[^:]*:\s*[^?]*nome/i.test(f.composeGuidance) || f.nextAllowedQuestion?.slot !== "nome");
  }

  // 2) "não tenho troca" (possuiTroca=false) -> forbidden inclui possuiTroca; veiculoTroca NÃO é próxima (inaplicável).
  {
    const st = withSlots({ nome: kn("Douglas"), interesse: kn("suv"), possuiTroca: kn(false) });
    const f = frameOf(st, "não tenho troca");
    check("2 possuiTroca known -> forbidden inclui possuiTroca", f.forbiddenQuestions.includes("possuiTroca"));
    check("2 próxima pergunta NÃO é veiculoTroca (troca=false -> inaplicável)", f.nextAllowedQuestion?.slot !== "veiculoTroca");
  }

  // 3) "sem entrada" (entrada=0) com financiamento -> próxima é parcela/forma, nunca entrada de novo.
  {
    const st = withSlots({ nome: kn("Douglas"), interesse: kn("suv"), formaPagamento: kn("financiamento"), entrada: kn(0) });
    const f = frameOf(st, "não tenho entrada");
    check("3 entrada known(0) -> forbidden inclui entrada", f.forbiddenQuestions.includes("entrada"));
    check("3 próxima pergunta NÃO repete entrada", f.nextAllowedQuestion?.slot !== "entrada");
  }

  // 4) "quero comprar agora" -> buy STRONG; funil incompleto -> handoff_blocked; guidance manda acelerar.
  {
    const st = withSlots({ nome: kn("Douglas") });
    const f = frameOf(st, "Quero comprar agora");
    check("4 buySignalLevel = strong", f.buySignalLevel === "strong", f.buySignalLevel);
    check("4 leadIntent = buy_now", f.leadIntent === "buy_now");
    check("4 funil incompleto -> stage handoff_blocked", f.stage === "handoff_blocked", f.stage);
    check("4 guidance contém [COMPRA FORTE] (acelerar)", /COMPRA FORTE/.test(f.composeGuidance));
    check("4 handoffEligibility = blocked (falta funil)", f.handoffEligibility === "blocked");
  }

  // 4b) buy strong + funil completo -> handoff_ready + fechamento.
  {
    const st = withSlots({ nome: kn("Douglas"), interesse: kn("suv"), faixaPreco: kn({ max: 80000 }), formaPagamento: kn("a_vista"), possuiTroca: kn(false), interesseVisita: kn(true), diaHorario: kn("sábado") });
    const f = frameOf(st, "quero fechar");
    check("4b buy strong + funil ok -> stage handoff_ready", f.stage === "handoff_ready", f.stage);
    check("4b handoffEligibility = ready", f.handoffEligibility === "ready");
    check("4b sem nextAllowedQuestion (nada a perguntar)", f.nextAllowedQuestion === null);
  }

  // 5) "gostei do segundo" -> buy SOFT; leadIntent selecting_vehicle; guidance avança 1 passo.
  {
    const st = withSlots({ nome: kn("Douglas"), interesse: kn("suv") });
    const f = frameOf(st, "Gostei do segundo");
    check("5 buySignalLevel = soft", f.buySignalLevel === "soft", f.buySignalLevel);
    check("5 leadIntent = selecting_vehicle", f.leadIntent === "selecting_vehicle");
    check("5 guidance contém [INTERESSE] (avança 1 passo)", /INTERESSE/.test(f.composeGuidance));
  }

  // 6) mudança de direção "na verdade quero hatch automático" -> leadIntent direction_change.
  {
    const st = withSlots({ nome: kn("Douglas"), interesse: kn("sedan") });
    const f = frameOf(st, "Na verdade quero hatch automático");
    check("6 leadIntent = direction_change", f.leadIntent === "direction_change", f.leadIntent);
  }

  // 7) "quanto custa o CRV?" -> mustAnswerLeadQuestionFirst; leadIntent asking_price; ainda pode UMA pergunta de follow-up.
  {
    const st = withSlots({ nome: kn("Douglas"), interesse: kn("suv") });
    const f = frameOf(st, "Quanto custa o CRV?", { relation: "asks_vehicle_detail" });
    check("7 mustAnswerLeadQuestionFirst = true", f.mustAnswerLeadQuestionFirst);
    check("7 leadIntent = asking_price", f.leadIntent === "asking_price", f.leadIntent);
    check("7 guidance manda RESPONDA PRIMEIRO", /RESPONDA PRIMEIRO/.test(f.composeGuidance));
    check("7 responder-primeiro NÃO suprime o follow-up (nextAllowedQuestion presente)", f.nextAllowedQuestion != null);
  }

  // 8) funil completo, sem pergunta do lead -> handoff_ready; sem nextAllowedQuestion; guidance de fechamento.
  {
    const st = withSlots({ nome: kn("Douglas"), interesse: kn("suv"), faixaPreco: kn({ max: 80000 }), formaPagamento: kn("a_vista"), possuiTroca: kn(false), interesseVisita: kn(false) });
    const f = frameOf(st, "ok");
    check("8 funil completo -> stage handoff_ready", f.stage === "handoff_ready", `${f.stage} / next=${f.nextAllowedQuestion?.slot}`);
    check("8 sem nextAllowedQuestion", f.nextAllowedQuestion === null);
    check("8 guidance de FECHAMENTO (funil completo)", /FECHAMENTO/.test(f.composeGuidance));
  }

  // 9) invariantes gerais: shouldAskOneQuestionOnly sempre true; forbidden nunca inclui slot unknown.
  {
    const st = withSlots({ nome: kn("Douglas") });
    const f = frameOf(st, "oi");
    check("9 shouldAskOneQuestionOnly sempre true", f.shouldAskOneQuestionOnly === true);
    check("9 forbidden NÃO inclui slot desconhecido (interesse unknown)", !f.forbiddenQuestions.includes("interesse"));
    check("9 guidance sempre pede UMA PERGUNTA e NATURALIDADE", /UMA PERGUNTA/.test(f.composeGuidance) && /NATURALIDADE/.test(f.composeGuidance));
  }

  // 10) rajada agregada: "não tenho troca | quero SUV até 100 mil" -> a fala inteira chega ao frame (não só a 1ª linha).
  {
    const st = withSlots({ nome: kn("Douglas") });
    const f = frameOf(st, "não tenho troca\nquero SUV até 100 mil");
    // o frame classifica intent do bloco inteiro; aqui o importante é NÃO travar e produzir guidance coerente.
    check("10 rajada -> guidance produzido (bloco inteiro considerado)", f.composeGuidance.length > 0 && /JA SABEMOS/.test(f.composeGuidance));
    check("10 rajada não-comprada -> buySignal none (sem cue de compra forte)", f.buySignalLevel === "none");
  }

  // 11) "consigo visitar sábado" -> buy STRONG (intenção de visita), stage visit ou handoff (acelera).
  {
    const st = withSlots({ nome: kn("Douglas"), interesse: kn("suv"), faixaPreco: kn({ max: 70000 }) });
    const f = frameOf(st, "Consigo visitar sábado de manhã");
    check("11 intenção de visita -> buySignal strong", f.buySignalLevel === "strong", f.buySignalLevel);
    check("11 leadIntent = buy_now (visita conta como compra forte)", f.leadIntent === "buy_now");
  }

  console.log(`\n=== F2.9 CONDUCTION FRAME: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { console.error(fails.join("\n")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", String((e as Error)?.message ?? e)); process.exit(1); });
