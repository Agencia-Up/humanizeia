import { runCentralAssertions, type CentralTurnCapture } from "../eval/central-assertions.ts";
import { slotQuestions } from "../src/engine/question-classify.ts";

const base = (over: Partial<CentralTurnCapture>): CentralTurnCapture => ({
  turnIndex: 1,
  turnId: "t1",
  leadBlock: "oi",
  response: "Tudo bem, como posso ajudar?",
  status: "committed",
  terminalSafe: false,
  brainSteps: 1,
  llmCallsInTurn: 1,
  promptExactInTurn: true,
  toolsRequested: [],
  observations: [],
  effects: [],
  slotsDelta: [],
  wmBeforeLastPhotoLabel: null,
  wmAfterLastPhotoLabel: null,
  possuiTrocaBefore: "unknown",
  possuiTrocaAfter: "unknown",
  ...over,
});

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`OK ${label}`);
}

const earlyCpf = runCentralAssertions([base({
  turnIndex: 7,
  leadBlock: "E se eu quiser financiar, qual parcela eu consigo?",
  response: "Para simular, preciso do seu CPF e data de nascimento.",
})]);
assert(earlyCpf.violations.some((v) => v.code === "SENSITIVE_DATA_TOO_EARLY"), "CPF cedo reprova globalmente");

const fakeSchedule = runCentralAssertions([base({
  turnIndex: 9,
  leadBlock: "Às 15h",
  response: "Perfeito, agendei sua visita para segunda às 15h.",
})]);
assert(fakeSchedule.violations.some((v) => v.code === "SCHEDULE_PROMISE_WITHOUT_EFFECT"), "promessa de agendamento sem efeito reprova");

const fakeScheduleWithoutVisitNoun = runCentralAssertions([base({
  turnIndex: 9,
  leadBlock: "Às 15h",
  response: "Agendado para segunda às 15h.",
})]);
assert(fakeScheduleWithoutVisitNoun.violations.some((v) => v.code === "SCHEDULE_PROMISE_WITHOUT_EFFECT"), "promessa de agendamento sem substantivo visita reprova");

const fakeHandoff = runCentralAssertions([base({
  turnIndex: 10,
  leadBlock: "Vou falar com um vendedor",
  response: "Certo, vou te transferir para um vendedor agora.",
})]);
assert(fakeHandoff.violations.some((v) => v.code === "HANDOFF_PROMISE_WITHOUT_EFFECT"), "promessa de vendedor sem efeito reprova");

const validEffects = runCentralAssertions([
  base({ turnIndex: 9, leadBlock: "Às 15h", response: "Perfeito, sua visita foi agendada.", effects: [{ kind: "schedule_visit", status: "accepted" }] }),
  base({ turnIndex: 10, leadBlock: "Vou falar com um vendedor", response: "Certo, vou te transferir agora.", effects: [{ kind: "handoff", status: "accepted" }] }),
]);
assert(validEffects.criticalCount === 0, "efeitos materializados não geram falso positivo");

assert(slotQuestions("Para calcular a parcela, preciso do seu CPF e data de nascimento. Pode me informar?").includes("cpf"), "CPF em frase preparatÃ³ria Ã© classificado mesmo com pergunta genÃ©rica");
assert(slotQuestions("Posso agendar sua visita. Qual horario prefere?").includes("diaHorario"), "pergunta de horario continua classificada");

const ignoredCurrentRequest = runCentralAssertions([base({
  turnIndex: 2,
  leadBlock: "Quero ver um SUV ate 90 mil",
  response: "Voce ja conhece a nossa loja?",
})]);
assert(ignoredCurrentRequest.violations.some((v) => v.code === "CURRENT_LEAD_REQUEST_IGNORED"), "pedido atual nao pode ser substituido por pergunta antiga");

const promisedStock = runCentralAssertions([base({
  turnIndex: 2,
  leadBlock: "Quero ver um SUV ate 90 mil",
  response: "Vou te mostrar as opcoes de SUV que temos.",
})]);
assert(promisedStock.violations.some((v) => v.code === "CURRENT_REQUEST_WITHOUT_FACTUAL_RESULT"), "pedido de estoque nao pode terminar em promessa sem resultado");

const misclassifiedVisit = runCentralAssertions([base({
  turnIndex: 8,
  leadBlock: "Quero visitar na segunda",
  response: "Qual parcela voce gostaria?",
  primaryIntent: "financing",
})]);
assert(misclassifiedVisit.violations.some((v) => v.code === "CURRENT_VISIT_MISCLASSIFIED"), "visita explicita deve ser interpretada como visita");

const validVisitContinuation = runCentralAssertions([base({
  turnIndex: 8,
  leadBlock: "Quero visitar na segunda",
  response: "Na segunda conseguimos te receber sim. Qual horário você prefere passar aqui na loja?",
  primaryIntent: "visit",
})]);
assert(!validVisitContinuation.violations.some((v) => v.code === "CURRENT_LEAD_REQUEST_IGNORED"), "pergunta de horario ligada a visita nao e pergunta institucional antiga");

console.log("F2.62 conversation quality invariants: 11 OK | 0 FALHA");
