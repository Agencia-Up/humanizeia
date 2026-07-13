// ============================================================================
// F2.55 (parte 1) — testes PUROS de turn-advisories (RD1, auditoria Codex).
//  (1) deriveTurnAdvisoryContext: PRECEDÊNCIA DO BLOCO ATUAL derivada de MENSAGENS REAIS (Codex ajuste #2 — nunca
//      supressão manual). Só calcula SUPRESSÃO/CONTEXTO — nunca autoriza intent/tool/effect/slot.
//  (2) buildTurnAdvisories: as ORIENTAÇÕES injetadas ANTES da 1ª geração respeitam a supressão e a AUTORIDADE DO PORTAL.
// Provam o contrato ANTES de remover qualquer deny. Advisory ORIENTA — nunca decide.
// ============================================================================
import { buildTurnAdvisories, deriveTurnAdvisoryContext, type TurnAdvisoryInput, type TurnAdvisoryContextInput } from "../src/engine/turn-advisories.ts";
import { hasSchedulingTemporalValue, hasActiveVisitContext, validateTurnUnderstanding } from "../src/engine/turn-understanding.ts";
import { composeSchedule } from "../src/engine/lead-extraction.ts";
import type { TurnUnderstanding } from "../src/domain/agent-brain.ts";

let ok = 0; let bad = 0;
function check(name: string, pass: boolean, extra?: string): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { bad++; console.error(`  RED ${name}${extra ? ` — ${extra}` : ""}`); }
}
const N = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Base de contexto: TODOS os sinais de estado OFF -> a supressão vem SÓ do que a função deriva do TEXTO REAL.
function ctx(block: string, over: Partial<TurnAdvisoryContextInput> = {}): TurnAdvisoryContextInput {
  return {
    leadBlock: block, commercialTargetStated: false, financialAnswerTurn: false, tradeInAnswerTurn: false,
    sensitiveAnswerTurn: false, disengagement: false, explicitBuyIntent: false, ...over,
  };
}

console.log("== F2.55 (parte 1a) — deriveTurnAdvisoryContext: MENSAGENS REAIS (Codex ajuste #2) ==");
// Cada caso do Codex: mensagem REAL -> a função DERIVA a supressão (nada é passado manualmente como suppressDiscovery).
{
  const d = deriveTurnAdvisoryContext(ctx("quero falar com um atendente"));
  check("[real-1] 'quero falar com um atendente' -> suppress ambos", d.suppressDiscovery && d.suppressFunnelQuestion && d.leadRequestsHuman);
}
{
  const d = deriveTurnAdvisoryContext(ctx("onde fica a loja?"));
  check("[real-2] 'onde fica a loja?' -> suppress ambos (institucional)", d.suppressDiscovery && d.suppressFunnelQuestion && d.institutionalTurn);
}
{
  const d = deriveTurnAdvisoryContext(ctx("quero agendar segunda"));
  check("[real-3] 'quero agendar segunda' -> suppress ambos (visita)", d.suppressDiscovery && d.suppressFunnelQuestion && d.leadWantsVisit);
}
{
  const d = deriveTurnAdvisoryContext(ctx("me manda fotos do segundo"));
  check("[real-4] 'me manda fotos do segundo' -> discovery suprimido e SEM pergunta de funil não relacionada", d.suppressDiscovery && d.suppressFunnelQuestion && d.photoTurn);
}
{
  const d = deriveTurnAdvisoryContext(ctx("gostei do segundo"));
  check("[real-5] 'gostei do segundo' -> discovery suprimido (seleção)", d.suppressDiscovery && d.selectionTurn);
}
{
  const d = deriveTurnAdvisoryContext(ctx("vocês financiam?"));
  check("[real-6] 'vocês financiam?' -> discovery suprimido (pagamento)", d.suppressDiscovery && d.paymentTurn);
}
{
  // troca em bloco quebrado — posse de veículo (base de troca). Sem pergunta pendente (tradeInAnswerTurn=false): a
  // supressão vem da POSSE detectada no texto ("tenho uma Hilux ...").
  const d = deriveTurnAdvisoryContext(ctx("tenho uma Hilux 2020 com 85km"));
  check("[real-7] 'tenho uma Hilux 2020 com 85km' -> discovery suprimido (posse/troca)", d.suppressDiscovery);
}
{
  const d = deriveTurnAdvisoryContext(ctx("quero SUV"));
  check("[real-8] 'quero SUV' -> alvo comercial atual vence (discovery suprimido, sem reperguntar tipo)", d.suppressDiscovery);
}
{
  const d = deriveTurnAdvisoryContext(ctx("boa tarde"));
  check("[real-9] 'boa tarde' -> abertura/discovery do portal PERMITIDO (sem supressão)", !d.suppressDiscovery && !d.suppressFunnelQuestion);
}
{
  // A função NUNCA autoriza nada — só devolve booleanos de supressão/contexto.
  const d = deriveTurnAdvisoryContext(ctx("quero falar com um atendente"));
  const onlyBooleans = Object.values(d).every((v) => typeof v === "boolean");
  check("[real-10] deriveTurnAdvisoryContext devolve SÓ booleanos (zero autorização)", onlyBooleans);
}

console.log("\n== F2.55 (parte 1b) — buildTurnAdvisories: orientações respeitam supressão + portal ==");
function base(over: Partial<TurnAdvisoryInput> = {}): TurnAdvisoryInput {
  return {
    isFirstContact: false, adVehicleLabel: null, needsDiscovery: false, suppressDiscovery: false,
    suppressFunnelQuestion: false, portalNextQuestion: null, knownName: null, contactPhoneKnown: false,
    paymentTurnWithChosenCar: false, justAnsweredFinancialSlot: null, disengagementOnly: false,
    institutionalHookNeeded: false, knownFunnelSlots: [], ...over,
  };
}
// helper: monta o input do builder A PARTIR de uma mensagem real (deriva a supressão, como o engine faz).
function fromMsg(block: string, over: Partial<TurnAdvisoryInput> = {}, cover: Partial<TurnAdvisoryContextInput> = {}): TurnAdvisoryInput {
  const d = deriveTurnAdvisoryContext(ctx(block, cover));
  return base({ suppressDiscovery: d.suppressDiscovery, suppressFunnelQuestion: d.suppressFunnelQuestion, ...over });
}
const DISCOVERY_RX = /apresente-se|descoberta|o que (o cliente|voce) procura|o que ele procura|entenda.*intencao comercial|primeira pergunta de qualificacao/;
const hasDiscovery = (a: string[]) => a.some((s) => DISCOVERY_RX.test(N(s)));
const hasFunnelNext = (a: string[]) => a.some((s) => /proximo passo da qualificacao|continue a qualificacao/.test(N(s)));

// A. Saudação sem contexto -> apresentação/discovery presentes (mensagem real "boa tarde" NÃO suprime).
{
  const a = buildTurnAdvisories(fromMsg("boa tarde", { isFirstContact: true, needsDiscovery: true }));
  check("[A] saudação crua -> apresentação + discovery", hasDiscovery(a), a.join(" | ").slice(0, 120));
}
// B. request_human sem nome -> zero discovery (supressão DERIVADA da mensagem real).
{
  const a = buildTurnAdvisories(fromMsg("quero falar com um atendente", { isFirstContact: true, needsDiscovery: true }));
  check("[B] request_human -> ZERO discovery/apresentação", !hasDiscovery(a) && !a.some((s) => /nome/.test(N(s))), a.join(" | ").slice(0, 120));
}
// C. institucional sem contexto -> zero discovery e zero funil (supressão DERIVADA).
{
  const a = buildTurnAdvisories(fromMsg("onde fica a loja?", { isFirstContact: true, needsDiscovery: true }));
  check("[C] institucional -> ZERO discovery e ZERO funil", !hasDiscovery(a) && !hasFunnelNext(a));
}
// D. visita após financiamento -> zero retorno a estoque/funil antigo (supressão DERIVADA de "quero agendar").
{
  const a = buildTurnAdvisories(fromMsg("quero agendar segunda", { knownFunnelSlots: ["entrada", "parcelaDesejada"], portalNextQuestion: "Tem carro na troca?" }));
  check("[D] visita pós-financiamento -> ZERO discovery e ZERO funil antigo", !hasDiscovery(a) && !hasFunnelNext(a), a.join(" | ").slice(0, 120));
}
// E. despedida -> somente orientação de encerramento (sem discovery, sem funil, sem 'uma pergunta').
{
  const a = buildTurnAdvisories(base({ disengagementOnly: true, suppressDiscovery: true, suppressFunnelQuestion: true }));
  check("[E] despedida -> só encerramento", a.some((s) => /despedida curta/.test(N(s))) && !hasDiscovery(a) && !hasFunnelNext(a) && !a.some((s) => /no maximo uma pergunta/.test(N(s))), a.join(" | ").slice(0, 120));
}
// F. SUV explícito -> não perguntar de novo modelo/tipo (supressão DERIVADA de "quero SUV").
{
  const a = buildTurnAdvisories(fromMsg("quero SUV", { needsDiscovery: false, knownFunnelSlots: ["tipoVeiculo"] }));
  check("[F] SUV explícito -> não reperguntar tipo", !hasDiscovery(a) && a.some((s) => /ja sabe.*tipo de carro/.test(N(s))), a.join(" | ").slice(0, 120));
}
// G. nome conhecido -> advisory de não repetir o nome.
{
  const a = buildTurnAdvisories(base({ knownName: "Douglas" }));
  check("[G] nome conhecido -> não repergunte", a.some((s) => /ja sabe o nome do cliente \(douglas\)/.test(N(s))), a.join(" | ").slice(0, 120));
}
// H. ordem financeira configurada no portal -> respeitada (a pergunta do portal aparece).
{
  const q = "Você tem valor de entrada?";
  const a = buildTurnAdvisories(base({ portalNextQuestion: q }));
  check("[H] próxima pergunta do portal aparece", a.some((s) => s.includes(q)), a.join(" | ").slice(0, 120));
}
// I. portal com ordem diferente -> engine NÃO força a ordem padrão troca->entrada->parcela.
{
  const q = "Qual a cor de sua preferência?";
  const a = buildTurnAdvisories(base({ portalNextQuestion: q }));
  const forcesHardcodedOrder = a.some((s) => /troca.*entrada.*parcela|nesta ordem/.test(N(s)));
  check("[I] portal diferente -> sem ordem hardcoded", a.some((s) => s.includes(q)) && !forcesHardcodedOrder, a.join(" | ").slice(0, 120));
}
// J. nenhum advisory autoriza tool/effect/mutação (só strings de orientação).
{
  const a = buildTurnAdvisories(base({ isFirstContact: true, needsDiscovery: true, knownName: "Ana", portalNextQuestion: "Tem troca?", paymentTurnWithChosenCar: true, justAnsweredFinancialSlot: "entrada", institutionalHookNeeded: true }));
  const onlyStrings = Array.isArray(a) && a.every((s) => typeof s === "string" && s.length > 0);
  const noDirectives = a.every((s) => !/"kind"|"op"|"tool"|send_media|stock_search|set_slot|effect/i.test(s));
  check("[J] advisory é só orientação (zero tool/effect/mutação)", onlyStrings && noDirectives);
}
// K. fallback do funil quando o portal não configurou próxima pergunta (SEM DEFAULT_QUESTIONS interno — Codex ajuste #1).
{
  const a = buildTurnAdvisories(base({ portalNextQuestion: null }));
  check("[K] sem próxima pergunta configurada -> 'conforme o prompt do portal'", a.some((s) => /continue a qualificacao conforme o prompt do portal/.test(N(s))));
}
// L. alternativa curta relacionada NÃO é proibida (a regra geral permite 'fotos ou condições dele').
{
  const a = buildTurnAdvisories(base());
  check("[L] regra geral permite alternativa curta do mesmo veículo", a.some((s) => /alternativas curtas.*mesmo veiculo/.test(N(s))));
}

console.log("\n== F2.55 (parte 1c) — P0-A: continuação semântica de agendamento (helpers PUROS) ==");
// hasSchedulingTemporalValue: reconhecimento GERAL de valor temporal (NÃO frase-específico).
for (const [msg, expected] of [
  ["Pra segunda", true], ["Segunda à tarde", true], ["Às 15h", true], ["as 15:00", true], ["Pode ser amanhã", true],
  ["Depois do almoço", true], ["quinta de manhã", true], ["meio-dia", true], ["hoje", true], ["fim de semana", true],
  ["quero um SUV", false], ["gostei do segundo", false], ["quero falar com um vendedor", false], ["até 1500", false], ["78km rodados", false],
] as const) {
  check(`[sched-temporal] '${msg}' -> ${expected}`, hasSchedulingTemporalValue(msg) === expected, `got=${hasSchedulingTemporalValue(msg)}`);
}
// hasActiveVisitContext: contexto legítimo de visita em andamento.
check("[visit-ctx] interesseVisita=true -> ativo", hasActiveVisitContext({ interesseVisita: true, pendingSchedulingSlot: null, recentTurns: [] }) === true);
check("[visit-ctx] pergunta pendente diaHorario -> ativo", hasActiveVisitContext({ interesseVisita: false, pendingSchedulingSlot: "diaHorario", recentTurns: [] }) === true);
check("[visit-ctx] última pergunta do agente pediu dia da visita -> ativo", hasActiveVisitContext({ interesseVisita: false, pendingSchedulingSlot: null, recentTurns: [{ role: "agent", text: "Podemos agendar sua visita. Qual o melhor dia?" }] }) === true);
check("[visit-ctx] sem contexto de visita -> inativo", hasActiveVisitContext({ interesseVisita: false, pendingSchedulingSlot: "entrada", recentTurns: [{ role: "agent", text: "Qual seu nome?" }] }) === false);
// validateTurnUnderstanding: visit contextual — "Pra segunda" só valida COM contexto de visita.
const visitU = (quote: string): TurnUnderstanding => ({ primaryIntent: "visit", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [{ capability: undefined, quote }], isTopicChange: false, answeredLeadQuestions: [] });
{
  const withCtx = validateTurnUnderstanding(visitU("segunda"), "Pra segunda", true, { visitActive: true });
  check("[visit-auth] 'Pra segunda' + visitActive -> trusted (SEM issue de visit)", withCtx.trusted === true && !(withCtx.semanticIssues ?? []).some((i) => /visit/.test(i)), (withCtx.semanticIssues ?? []).join("|"));
  const noCtx = validateTurnUnderstanding(visitU("segunda"), "Pra segunda", true, { visitActive: false });
  check("[visit-auth] 'Pra segunda' SEM contexto -> NÃO inicia agendamento (issue)", noCtx.trusted === false && (noCtx.semanticIssues ?? []).some((i) => /visit/.test(i)), (noCtx.semanticIssues ?? []).join("|"));
  const explicit = validateTurnUnderstanding(visitU("quero agendar uma visita"), "quero agendar uma visita", true);
  check("[visit-auth] visita EXPLÍCITA sem contexto -> trusted", explicit.trusted === true);
  // mudança de assunto: "na verdade quero Onix" durante agendamento -> search_stock (NÃO visit) valida normalmente.
  const searchDuringSched: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "explicit_model", subjectValue: "onix", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "onix" }], isTopicChange: true, answeredLeadQuestions: [] };
  const topicChange = validateTurnUnderstanding(searchDuringSched, "na verdade quero onix", true, { visitActive: true });
  check("[visit-auth] mudança de assunto (onix) durante agendamento -> search_stock trusted (visit não interfere)", topicChange.trusted === true);
}
// composeSchedule: dia + horário compostos; nenhuma dimensão apaga a outra.
check("[compose] 'segunda' + '15h' -> 'segunda 15h'", composeSchedule("segunda", "15h") === "segunda 15h");
check("[compose] '15h' primeiro + 'segunda' depois -> mantém ambos", /segunda/.test(composeSchedule("15h", "segunda")) && /15h/.test(composeSchedule("15h", "segunda")));
check("[compose] corrige DIA mantém HORÁRIO ('segunda 15h' + 'terca')", composeSchedule("segunda 15h", "terca") === "terca 15h");
check("[compose] corrige HORÁRIO mantém DIA ('segunda 15h' + '16h')", composeSchedule("segunda 15h", "16h") === "segunda 16h");
check("[compose] existente vazio -> usa o novo", composeSchedule(null, "amanhã 14h") === "amanhã 14h");
check("[compose] 'segunda' + 'tarde' -> período preservado como horário", composeSchedule("segunda", "tarde") === "segunda tarde");

console.log("\n== F2.55 (parte 1d) — P1: advisory de CONTINUAÇÃO DE AGENDAMENTO (acolhe + pergunta só o que falta) ==");
const advN = (a: string[]) => a.map((s) => N(s)).join(" || ");
{
  // pediu visita, sem dia/horário -> orienta perguntar SÓ o dia.
  const a = buildTurnAdvisories(base({ scheduling: { active: true, dayJustGiven: false, timeJustGiven: false, dayKnown: false, timeKnown: false } }));
  check("[sched-1] sem dia -> pergunte SÓ o dia", /falta o dia.*somente o dia/.test(advN(a)) && !/somente o horario/.test(advN(a)), advN(a).slice(0, 120));
  check("[sched-1b] agendamento ativo SUPRIME a pergunta genérica de funil", !hasFunnelNext(a));
}
{
  // acabou de dar o DIA ("Pra segunda"), falta horário -> acolhe o dia + pergunta SÓ o horário, NUNCA repergunta o dia.
  const a = buildTurnAdvisories(base({ scheduling: { active: true, dayJustGiven: true, timeJustGiven: false, dayKnown: true, timeKnown: false } }));
  check("[sched-2] deu o dia -> acolhe + pergunta SÓ horário, não repergunta o dia", /acabou de informar o dia/.test(advN(a)) && /falta o horario.*nao o repergunte|dia ja esta definido/.test(advN(a)) && /somente o horario/.test(advN(a)), advN(a).slice(0, 160));
}
{
  // acabou de dar o HORÁRIO ("Às 15h"), dia já conhecido -> AMBOS conhecidos -> confirma e avança, sem reperguntar.
  const a = buildTurnAdvisories(base({ scheduling: { active: true, dayJustGiven: false, timeJustGiven: true, dayKnown: true, timeKnown: true } }));
  check("[sched-3] ⭐dia+horário conhecidos -> confirma e avança, NÃO repergunta dia/horário", /ja tem o dia e o horario.*confirme/.test(advN(a)) && /nao pergunte o dia nem o horario novamente/.test(advN(a)) && !/somente o dia|somente o horario/.test(advN(a)), advN(a).slice(0, 180));
}
{
  // sem agendamento ativo -> nenhuma orientação de agenda (e o funil normal segue).
  const a = buildTurnAdvisories(base({ portalNextQuestion: "Tem carro na troca?" }));
  check("[sched-4] sem agendamento -> zero orientação de dia/horário", !/falta o dia|falta o horario|ja tem o dia e o horario/.test(advN(a)));
}

console.log(`\n== F2.55 (parte 1): ${ok} OK | ${bad} FALHA ==`);
if (bad) process.exit(1);
