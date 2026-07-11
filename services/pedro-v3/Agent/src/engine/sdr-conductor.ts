import type { ConversationState, PendingObjective } from "../domain/conversation-state.ts";
import type { TenantRuntimeConfig } from "../domain/read-ports.ts";
import type { AnswerKind, ObjectiveType, SlotName } from "../domain/types.ts";
import type { TurnDecision, ResponseDraft, ResponsePart, TurnInterpretation } from "../domain/decision.ts";
import type { TurnOutput } from "./decision-engine.ts";
import { normalizeText } from "./catalog-utils.ts";
import { attachQualificationObjective } from "./finalizer.ts";
import { classifyConfiguredQuestion as classifyQuestionSlot, trailingQuestion, slotQuestions } from "./question-classify.ts";
import { buildSdrConductionFrame } from "./sdr-conduction-frame.ts";

export type SdrQualificationSlot = Exclude<SlotName, "cpf" | "birthDate">;

export type SdrQualificationPolicy = {
  readonly orderedSlots: readonly SdrQualificationSlot[];
  readonly questions: Readonly<Partial<Record<SdrQualificationSlot, string>>>;
  readonly agentName: string;
  readonly introductionText: string;
};

export type SdrQualificationView = {
  readonly knownSlots: readonly SdrQualificationSlot[];
  readonly missingSlots: readonly SdrQualificationSlot[];
  readonly nextSlot: SdrQualificationSlot | null;
  readonly readyForHandoff: boolean;
};

const CORE: readonly SdrQualificationSlot[] = [
  "nome", "interesse", "faixaPreco", "formaPagamento", "possuiTroca", "interesseVisita",
];

export const DEFAULT_QUESTIONS: Record<SdrQualificationSlot, string> = {
  nome: "Qual é o seu nome?",
  interesse: "Qual modelo ou tipo de carro você procura?",
  tipoVeiculo: "Você procura SUV, sedan, hatch ou picape?",
  faixaPreco: "Qual faixa de valor você pretende investir?",
  formaPagamento: "Você pensa em pagar à vista, financiar, usar consórcio ou fazer troca?",
  entrada: "Se for financiar, qual valor você pretende dar de entrada?",
  possuiTroca: "Você tem algum veículo para usar na troca?",
  diaHorario: "Qual dia e horário ficam melhores para sua visita?",
  parcelaDesejada: "Qual parcela mensal ficaria confortável para você?",
  veiculoTroca: "Qual é o modelo, ano e quilometragem do veículo da troca?",
  cidade: "De qual cidade você fala?",
  conheceLoja: "Você já conhece nossa loja?",
  interesseVisita: "Faz sentido agendarmos uma visita para você conhecer o veículo?",
};

// Wrapper local: delega ao módulo neutro (question-classify) e restringe a SdrQualificationSlot (sem "cpf").
function classifyConfiguredQuestion(question: string): SdrQualificationSlot | null {
  const s = classifyQuestionSlot(question);
  return s != null && s !== "cpf" && s !== "birthDate" ? (s as SdrQualificationSlot) : null;
}

function configuredIntroduction(config: Partial<Pick<TenantRuntimeConfig, "agentName" | "companyName" | "promptText">>): string {
  const agentName = config.agentName?.trim() || "Consultor";
  const candidates = (config.promptText ?? "").match(/Sou\s+(?:o|a)\s+[^"\r\n]{2,180}/giu) ?? [];
  const configured = candidates
    .map((candidate) => candidate.replace(/\*\*/g, "").replace(/[\\“”]+/g, "").trim())
    .find((candidate) => normalizeText(candidate).includes(normalizeText(agentName)) && /\bconsultor/i.test(candidate));
  if (configured) return configured.replace(/[.;:,\s]+$/, "") + ".";
  const company = config.companyName?.trim();
  return `Sou o ${agentName}, consultor ${company ? `da ${company}` : "da nossa loja"}.`;
}

function hasAgentIntroduction(text: string, agentName: string): boolean {
  const normalizedName = normalizeText(agentName);
  return normalizedName.length > 0 && normalizeText(text).includes(normalizedName);
}

export function ensureInitialIntroduction(text: string, state: ConversationState, policy: SdrQualificationPolicy): string {
  if (state.turnNumber > 0 || state.recentTurns.some((turn) => turn.role === "agent")) return text;
  if (hasAgentIntroduction(text, policy.agentName)) return text;
  const greeting = /^(bom dia|boa tarde|boa noite|oi|ola)(?:[!,.])?/i.exec(text.trim());
  if (!greeting) return `${policy.introductionText}\n\n${text.trim()}`;
  const rest = text.trim().slice(greeting[0].length).trim();
  const firstLine = `${greeting[0]} ${policy.introductionText}`.trim();
  return rest ? `${firstLine}\n\n${rest}` : firstLine;
}

// trailingQuestion vem de question-classify.ts (módulo neutro; evita circular policy-engine↔sdr-conductor).
function ensureQuestion(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ").slice(0, 240);
  return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
}

function qualificationQuestionsFromPrompt(promptText: string | null | undefined): string[] {
  const questions: string[] = [];
  for (const line of (promptText ?? "").split(/\r?\n/)) {
    const match = /^\s*\d+[.)]\s*(.+?\?)\s*$/.exec(line.replace(/\*\*/g, "").trim());
    if (match?.[1]) questions.push(match[1].trim());
  }
  return questions;
}
export function buildSdrQualificationPolicy(
  config: Pick<TenantRuntimeConfig, "qualificationQuestions"> & Partial<Pick<TenantRuntimeConfig, "agentName" | "companyName" | "promptText">>,
): SdrQualificationPolicy {
  const configuredSlots: SdrQualificationSlot[] = [];
  const questions: Partial<Record<SdrQualificationSlot, string>> = {};
  const configuredQuestions = [...(config.qualificationQuestions ?? []), ...qualificationQuestionsFromPrompt(config.promptText)];
  for (const question of configuredQuestions) {
    const slot = classifyConfiguredQuestion(question);
    if (!slot || questions[slot]) continue;
    configuredSlots.push(slot);
    questions[slot] = ensureQuestion(question);
  }
  const orderedSlots = [...new Set<SdrQualificationSlot>([
    "nome", "interesse", ...configuredSlots, ...CORE,
  ])];
  return Object.freeze({
    orderedSlots: Object.freeze(orderedSlots),
    questions: Object.freeze(questions),
    agentName: config.agentName?.trim() || "Consultor",
    introductionText: configuredIntroduction(config),
  });
}


function slotResolved(state: ConversationState, slot: SdrQualificationSlot): boolean {
  return state.slots[slot].status !== "unknown";
}

function slotApplicable(state: ConversationState, slot: SdrQualificationSlot): boolean {
  if (slot === "veiculoTroca") return state.slots.possuiTroca.value === true;
  if (slot === "entrada" || slot === "parcelaDesejada") return state.slots.formaPagamento.value === "financiamento";
  if (slot === "diaHorario") return state.slots.interesseVisita.value === true;
  return true;
}

export function deriveSdrQualification(
  state: ConversationState,
  policy: SdrQualificationPolicy,
): SdrQualificationView {
  const expanded: SdrQualificationSlot[] = [];
  for (const slot of policy.orderedSlots) {
    if (slotApplicable(state, slot)) expanded.push(slot);
    if (slot === "formaPagamento" && state.slots.formaPagamento.value === "financiamento") {
      expanded.push("entrada", "parcelaDesejada");
    }
    if (slot === "possuiTroca" && state.slots.possuiTroca.value === true) expanded.push("veiculoTroca");
    if (slot === "interesseVisita" && state.slots.interesseVisita.value === true) expanded.push("diaHorario");
  }
  const required = [...new Set<SdrQualificationSlot>(expanded)];
  const knownSlots = required.filter((slot) => slotResolved(state, slot));
  const missingSlots = required.filter((slot) => !slotResolved(state, slot));
  const pendingSlot = state.currentObjective?.status === "pending" && state.currentObjective.slot !== "cpf"
    ? state.currentObjective.slot as SdrQualificationSlot | null
    : null;
  const pendingStillValid = !!pendingSlot
    && required.includes(pendingSlot)
    && slotApplicable(state, pendingSlot)
    && !slotResolved(state, pendingSlot);
  const nextSlot = pendingStillValid ? pendingSlot : (missingSlots[0] ?? null);
  return { knownSlots, missingSlots, nextSlot, readyForHandoff: missingSlots.length === 0 };
}

// ── R12-B: DEFERIMENTO DE SLOT (fonte única de "qual a próxima pergunta do funil, deferindo/avançando") ──────
// Problema: o lead ignora uma pergunta do funil (ex.: nome) e traz intenção comercial; o funil quer REPERGUNTAR
// o mesmo slot -> fixação. Regra: adiar o slot pendente e, no encontro seguinte, AVANÇAR para outro slot.
// DEFER_LIMIT=1 é deliberado: mantém `deferrals` < 2 (sem OBJECTIVE_STARVED) e o mesmo slot < 3x seguidas
// (sem SLOT_FIXATION), dando ao lead 1 turno extra para responder naturalmente antes de o funil seguir.
// Função PURA e determinística consumida por conductDecision (guidance), reconcile (mutações), applySdrConduction
// (legado) e adjustDraftSafeguards (backstop) — TODOS os caminhos usam a MESMA decisão (sem `if` por frase).
const DEFER_LIMIT = 1;

export type FunnelNextDecision = {
  readonly kind: "normal" | "defer" | "advance";
  readonly nextSlot: SdrQualificationSlot | null;      // slot a perguntar (null = não empurrar pergunta de funil)
  readonly deferredSlot: SdrQualificationSlot | null;  // slot que NÃO deve ser reperguntado agora
  readonly deferObjectiveId: string | null;            // emitir defer_objective (conta o deferimento)
  readonly supersedeObjectiveId: string | null;        // emitir supersede_objective (avançou p/ outro slot)
};

export function decideFunnelNext(state: ConversationState, policy: SdrQualificationPolicy): FunnelNextDecision {
  const view = deriveSdrQualification(state, policy);
  const obj = state.currentObjective;
  const pending: (PendingObjective & { slot: SdrQualificationSlot }) | null =
    obj?.status === "pending" && obj.slot != null && obj.slot !== "cpf"
      ? (obj as PendingObjective & { slot: SdrQualificationSlot })
      : null;
  // Sem pendente, ou o pendente já foi respondido, ou o funil já seguiu naturalmente -> fluxo normal.
  if (!pending || slotResolved(state, pending.slot) || view.nextSlot !== pending.slot) {
    return { kind: "normal", nextSlot: view.nextSlot, deferredSlot: null, deferObjectiveId: null, supersedeObjectiveId: null };
  }
  // O funil quer REPERGUNTAR o slot pendente (não respondido) -> deferir ou avançar.
  const deferrals = pending.deferrals ?? 0;
  const nextDifferent = view.missingSlots.find((s) => s !== pending.slot && slotApplicable(state, s)) ?? null;
  if (deferrals >= DEFER_LIMIT && nextDifferent) {
    return { kind: "advance", nextSlot: nextDifferent, deferredSlot: pending.slot, deferObjectiveId: null, supersedeObjectiveId: pending.id };
  }
  return { kind: "defer", nextSlot: null, deferredSlot: pending.slot, deferObjectiveId: pending.id, supersedeObjectiveId: null };
}

function objectiveType(slot: SdrQualificationSlot): ObjectiveType {
  if (["formaPagamento", "entrada", "parcelaDesejada"].includes(slot)) return "perguntou_pagamento";
  if (["possuiTroca", "veiculoTroca"].includes(slot)) return "perguntou_troca";
  if (["interesse", "tipoVeiculo", "faixaPreco"].includes(slot)) return "ofereceu_opcoes";
  return "perguntou_dados";
}

function expectedAnswerKinds(slot: SdrQualificationSlot): AnswerKind[] {
  if (["entrada", "parcelaDesejada", "faixaPreco"].includes(slot)) return ["valor"];
  if (["possuiTroca", "conheceLoja", "interesseVisita"].includes(slot)) return ["boolean", "afirmacao", "negacao"];
  if (slot === "nome") return ["nome"];
  if (slot === "diaHorario") return ["data"];
  if (["interesse", "tipoVeiculo", "veiculoTroca"].includes(slot)) return ["modelo"];
  return ["afirmacao"];
}

function stripTrailingQuestion(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.endsWith("?")) return trimmed;
  const paragraph = trimmed.lastIndexOf("\n\n");
  if (paragraph >= 0 && trimmed.length - paragraph <= 320) return trimmed.slice(0, paragraph).trimEnd();
  const sentence = Math.max(trimmed.lastIndexOf(". "), trimmed.lastIndexOf("! "));
  if (sentence >= 0 && trimmed.length - sentence <= 320) return trimmed.slice(0, sentence + 1).trimEnd();
  return "";
}

function shouldPreserveClarification(output: TurnOutput): boolean {
  if (output.decision.action === "clarify") return true;
  return /clarif|ask_which|ambig|which_vehicle/.test(output.decision.reasonCode);
}

export function applySdrConduction(args: {
  readonly output: TurnOutput;
  readonly state: ConversationState;
  readonly policy: SdrQualificationPolicy;
  readonly turnId: string;
}): TurnOutput {
  const { output, state, policy, turnId } = args;
  if (output.decision.action === "no_op") return output;

  const introducedText = ensureInitialIntroduction(output.composed.text, state, policy);
  const contextualOutput: TurnOutput = introducedText === output.composed.text
    ? output
    : {
        ...output,
        composed: { draft: { parts: [{ type: "text", content: introducedText }] }, text: introducedText },
      };

  if (shouldPreserveClarification(contextualOutput)) return contextualOutput;
  const view = deriveSdrQualification(state, policy);
  if (!view.nextSlot) return contextualOutput;

  const pendingSlot = state.currentObjective?.status === "pending" && state.currentObjective.slot !== "cpf"
    ? state.currentObjective.slot as SdrQualificationSlot | null
    : null;
  const modelQuestion = trailingQuestion(introducedText);
  const modelQuestionSlot = modelQuestion ? classifyConfiguredQuestion(modelQuestion) : null;
  const firstConnectionQuestion = state.turnNumber === 0
    && (modelQuestionSlot === "cidade" || modelQuestionSlot === "conheceLoja");
  const preservePortalQuestion = modelQuestionSlot != null
    && !slotResolved(state, modelQuestionSlot)
    && (pendingSlot ? pendingSlot === modelQuestionSlot : modelQuestionSlot === view.nextSlot || firstConnectionQuestion);
  let selectedSlot = preservePortalQuestion ? modelQuestionSlot : view.nextSlot;

  // 1B.6 + item 5: ANTI-FIXAÇÃO com DEFERIMENTO TIPADO. Se o slot selecionado JÁ é o objetivo pendente
  // (perguntado antes e ainda não respondido porque o lead falou de outra coisa) e o LLM não repergunta
  // naturalmente, NÃO reescrever com a pergunta hardcoded. Até o limite: DEFERE (responde o assunto atual,
  // mantém o objetivo pendente, conta o deferimento — sem nagging). No limite: AVANÇA para o próximo slot
  // faltante DIFERENTE (não fica preso). Se o LLM repergunta (preservePortalQuestion), é decisão do prompt.
  // R12-B: usa o MESMO DEFER_LIMIT do caminho moderno (defere 1x, depois avança) — mantém `deferrals` < 2
  // (sem OBJECTIVE_STARVED) e não reativa a pergunta antiga além do limite, unificando legado e moderno.
  let supersedeOldId: string | null = null;
  if (!preservePortalQuestion && pendingSlot != null && pendingSlot === selectedSlot) {
    const deferrals = state.currentObjective?.deferrals ?? 0;
    if (deferrals < DEFER_LIMIT) {
      const objId = state.currentObjective?.id;
      return objId
        ? { ...contextualOutput, decision: { ...contextualOutput.decision, decisionMutations: [...contextualOutput.decision.decisionMutations, { op: "defer_objective", objectiveId: objId }] } }
        : contextualOutput;
    }
    const nextDifferent = view.missingSlots.find((s) => s !== pendingSlot && slotApplicable(state, s));
    if (!nextDifferent) return contextualOutput;
    supersedeOldId = state.currentObjective?.id ?? null; // F-5: supersede o antigo ANTES de planejar o novo
    selectedSlot = nextDifferent; // limite atingido -> avança o funil para outro slot
  }

  const question = preservePortalQuestion
    ? modelQuestion!
    : policy.questions[selectedSlot] ?? DEFAULT_QUESTIONS[selectedSlot];
  const base = preservePortalQuestion ? introducedText : stripTrailingQuestion(introducedText);
  const text = preservePortalQuestion ? introducedText : (base ? `${base}\n\n${question}`.trim() : question);

  const decision = attachQualificationObjective(contextualOutput.decision, {
    id: `${turnId}:sdr:${selectedSlot}`,
    type: objectiveType(selectedSlot),
    slot: selectedSlot,
    plannedInTurnId: turnId,
    expectedAnswerKinds: expectedAnswerKinds(selectedSlot),
  });
  if (!decision) return contextualOutput;
  // F-5: no avanço pós-limite, SUPERSEDE o objetivo antigo ANTES do novo planejado (o slot antigo continua
  // missing e pode ser perguntado de novo mais tarde — supersede != satisfied).
  const decisionMutations = supersedeOldId
    ? [{ op: "supersede_objective" as const, objectiveId: supersedeOldId }, ...decision.decisionMutations]
    : decision.decisionMutations;

  return {
    ...contextualOutput,
    decision: {
      ...decision,
      decisionMutations,
      responsePlan: {
        guidance: preservePortalQuestion
          ? decision.responsePlan.guidance
          : `${decision.responsePlan.guidance} Depois, faça somente esta pergunta de qualificação: ${question}`,
      },
    },
    composed: { draft: { parts: [{ type: "text", content: text }] }, text },
  };
}

// ── 1B.7 (Seção 3): CONDUÇÃO POR GUIDANCE (o conductor NÃO redige nem reescreve texto) ────────────────────
// Enriquece a DECISÃO com guidance (dados conhecidos, próximo do funil, o que NÃO repergunta, uma pergunta
// útil, ordem do portal) + as MUTAÇÕES de objetivo/deferimento/supersede. O compose (LLM) redige seguindo o
// prompt do portal + esse guidance; a policy é a autoridade final. Reusa a MESMA lógica de estado do
// applySdrConduction (deriveSdrQualification, anti-fixação MAX_DEFERRALS=2, supersede-antes-de-avançar).
function needsInitialIntroduction(state: ConversationState): boolean {
  return state.turnNumber === 0 && !state.recentTurns.some((t) => t.role === "agent");
}
function withConductionGuidance(decision: TurnDecision, addendum: string): TurnDecision {
  return { ...decision, responsePlan: { guidance: `${decision.responsePlan.guidance}${addendum}`.slice(0, 1600) } };
}
// P0-2 (Codex): o CONDUTOR é a ÚNICA autoridade sobre o objetivo de qualificação. Remove qualquer objetivo
// emitido pelo MODELO/handler (set_planned_objective + activate_objective) antes de o conductor impor o seu —
// senão `attachQualificationObjective` retornaria null (já há objetivo) e o objetivo do LLM ficaria escondido.
export function stripModelObjectives(decision: TurnDecision): TurnDecision {
  const hasObj = decision.decisionMutations.some((m) => m.op === "set_planned_objective")
    || decision.effectPlan.some((p) => p.onSuccess.some((o) => o.op === "activate_objective"));
  if (!hasObj) return decision;
  return {
    ...decision,
    decisionMutations: decision.decisionMutations.filter((m) => m.op !== "set_planned_objective"),
    effectPlan: decision.effectPlan.map((p) => ({ ...p, onSuccess: p.onSuccess.filter((o) => o.op !== "activate_objective") })),
  };
}
// R10-1 (Codex): o conductor SÓ SUGERE guidance — NÃO grava mais objetivo. A persistência do objetivo é feita
// pós-compose por `reconcileObjectiveWithQuestion` (objetivo = pergunta REALMENTE enviada).
// R11 (Condução SDR): a guidance passa a vir do FRAME estruturado (`buildSdrConductionFrame`) — funil ancorado,
// buy-signal, responder-lead-primeiro, uma pergunta, naturalidade. O conductor só resolve os INPUTS do funil
// (view + próxima pergunta do portal) e delega a montagem da guidance ao frame. Continua sem redigir texto final.
export function conductDecision(args: {
  readonly decision: TurnDecision;
  readonly state: ConversationState;
  readonly policy: SdrQualificationPolicy;
  readonly turnId: string;
  readonly leadMessage?: string;
  readonly interpretation?: TurnInterpretation | null;
}): TurnDecision {
  const { state, policy, leadMessage = "", interpretation } = args;
  const decision = stripModelObjectives(args.decision); // remove objetivo emitido pelo modelo; conductor só guia
  if (decision.action === "no_op") return decision;
  if (decision.action === "clarify" || /clarif|ask_which|ambig|which_vehicle/.test(decision.reasonCode)) return decision;

  const view = deriveSdrQualification(state, policy);
  // R12-B: a PRÓXIMA pergunta vem de decideFunnelNext (defere o slot que o lead ignorou / avança após o limite),
  // não mais de view.nextSlot cru — assim o frame nunca guia o LLM a reperguntar o slot deferido.
  const funnel = decideFunnelNext(state, policy);
  const nextQuestion = funnel.nextSlot ? (policy.questions[funnel.nextSlot] ?? DEFAULT_QUESTIONS[funnel.nextSlot]) : null;
  const frame = buildSdrConductionFrame({
    state, leadMessage, interpretation, view,
    nextSlot: funnel.nextSlot, nextQuestion, deferredSlot: funnel.deferredSlot,
    reasonCode: decision.reasonCode, isFirstContact: needsInitialIntroduction(state),
  });
  return withConductionGuidance(decision, frame.composeGuidance);
}

// R10-1: strip de TODAS as mutações de objetivo (o texto real manda) — set/supersede/defer + activate no efeito.
// Exportado: o modo LLM-first do central_active usa isto NO LUGAR de reconcileObjectiveWithQuestion — nenhum objetivo
// de funil é criado/gerenciado pelo engine; o funil vira contexto read-only e a LLM decide a próxima pergunta.
export function stripAllObjectiveMutations(decision: TurnDecision): TurnDecision {
  return {
    ...decision,
    decisionMutations: decision.decisionMutations.filter((m) => m.op !== "set_planned_objective" && m.op !== "supersede_objective" && m.op !== "defer_objective"),
    effectPlan: decision.effectPlan.map((p) => ({ ...p, onSuccess: p.onSuccess.filter((o) => o.op !== "activate_objective") })),
  };
}
// R10-1 (Codex): RECONCILIA o objetivo persistido com a pergunta EFETIVAMENTE renderizada (pós-compose, pré-commit).
//  - 0 perguntas -> não cria objetivo novo (mantém o pendente); 1 pergunta de slot FALTANTE -> objetivo = esse slot
//    com expectedAnswerKinds correspondentes; slot já CONHECIDO -> não cria (policy já negou; defesa); objetivo
//    anterior DIFERENTE -> supersede antes do novo. A policy garante ≤1 pergunta e slot faltante; aqui persistimos.
export function reconcileObjectiveWithQuestion(args: {
  readonly decision: TurnDecision;
  readonly composedText: string;
  readonly state: ConversationState;
  readonly turnId: string;
  readonly policy: SdrQualificationPolicy;
}): TurnDecision {
  const { composedText, state, turnId, policy } = args;
  const stripped = stripAllObjectiveMutations(args.decision);
  if (stripped.action === "no_op") return stripped;
  if (stripped.action === "clarify" || /clarif|ask_which|ambig|which_vehicle/.test(stripped.reasonCode)) return stripped;
  const asked = slotQuestions(composedText).filter((s) => s !== "cpf");
  if (asked.length === 0) {
    // R12-B: nenhuma pergunta -> NÃO cria objetivo artificial (invariante 6). Mas, se o funil queria o slot
    // pendente e o lead o IGNOROU (trouxe outra coisa), CONTA o deferimento; passado o limite, SUPERSEDE (avança)
    // para não travar. Sem isso, o pendente ficava vivo e o LLM voltava a repergunta-lo -> fixação.
    const funnel = decideFunnelNext(state, policy);
    if (funnel.deferObjectiveId) return { ...stripped, decisionMutations: [...stripped.decisionMutations, { op: "defer_objective", objectiveId: funnel.deferObjectiveId }] };
    if (funnel.supersedeObjectiveId) return { ...stripped, decisionMutations: [...stripped.decisionMutations, { op: "supersede_objective", objectiveId: funnel.supersedeObjectiveId }] };
    return stripped;
  }
  const slot = asked[0] as SdrQualificationSlot;
  if (slotResolved(state, slot)) return stripped; // slot já conhecido -> não cria (a policy deveria ter negado)
  const pending = state.currentObjective?.status === "pending" && state.currentObjective.slot !== "cpf" ? state.currentObjective : null;
  const withObj = attachQualificationObjective(stripped, {
    id: `${turnId}:sdr:${slot}`, type: objectiveType(slot), slot, plannedInTurnId: turnId, expectedAnswerKinds: expectedAnswerKinds(slot),
  });
  if (!withObj) return stripped;
  // R12-B: só SUPERSEDE o pendente anterior se ele for DIFERENTE **e ainda não respondido**. Se o lead acabou de
  // respondê-lo (o lead-extraction emite resolve_objective=satisfied), NÃO supersede — senão sobrescreveria
  // "satisfied" por "superseded" no mesmo turno em que o agente já avança para a próxima pergunta.
  const pendingSlotName = pending?.slot as SdrQualificationSlot | undefined;
  const decisionMutations = (pending && pendingSlotName != null && pendingSlotName !== slot && !slotResolved(state, pendingSlotName))
    ? [{ op: "supersede_objective" as const, objectiveId: pending.id }, ...withObj.decisionMutations]
    : withObj.decisionMutations;
  return { ...withObj, decisionMutations };
}

// ── 1B.7: TRAVA DETERMINÍSTICA anti-SLOT_FIXATION (pós-compose) ────────────────────────────────────────────
// O guidance pede "não repergunte X", mas o LLM às vezes ignora e repete a MESMA pergunta de slot. Esta trava
// (como a rede de apresentação) roda DEPOIS do compose: se o texto vai perguntar um slot que o agente JÁ
// perguntou nas 2 falas anteriores (3ª vez consecutiva = SLOT_FIXATION), troca a pergunta pelo PRÓXIMO slot
// faltante DIFERENTE. NÃO reescreve a resposta ao lead — só corrige a pergunta de condução repetida.
export function enforceNoSlotFixation(args: {
  readonly composedText: string;
  readonly state: ConversationState;
  readonly policy: SdrQualificationPolicy;
}): string {
  const { composedText, state, policy } = args;
  const q = trailingQuestion(composedText);
  if (!q) return composedText;
  const askedSlot = classifyConfiguredQuestion(q);
  if (!askedSlot) return composedText;
  const recentAgent = (state.recentTurns ?? []).filter((t) => t.role === "agent").slice(-2);
  const priorRepeats = recentAgent.filter((t) => {
    const rq = trailingQuestion(t.text ?? "");
    return rq != null && classifyConfiguredQuestion(rq) === askedSlot;
  }).length;
  if (priorRepeats < 2) return composedText; // 1ª/2ª vez: permitido (o LLM pode insistir uma vez)
  const view = deriveSdrQualification(state, policy);
  const nextDifferent = view.missingSlots.find((s) => s !== askedSlot && slotApplicable(state, s));
  if (!nextDifferent) return composedText; // nada diferente p/ perguntar -> não piora
  const base = stripTrailingQuestion(composedText);
  const newQ = policy.questions[nextDifferent] ?? DEFAULT_QUESTIONS[nextDifferent];
  return base ? `${base}\n\n${newQ}` : newQ;
}

// P1 (Codex): as travas determinísticas (apresentação no 1º contato + anti-SLOT_FIXATION) operam no DRAFT
// (parts) ANTES de renderizar+validar — NÃO reescrevem o texto DEPOIS da policy. Assim preservam as parts
// estruturadas (vehicle_offer_list) e o texto validado JÁ É o final. Chamado de dentro do composeAndVerify.
export function adjustDraftSafeguards(draft: ResponseDraft, state: ConversationState, policy: SdrQualificationPolicy): ResponseDraft {
  let parts: ResponsePart[] = draft.parts.slice();
  // (1) apresentação no 1º contato: se nenhuma TextPart menciona o nome do agente, prefixa a introdução.
  if (needsInitialIntroduction(state)) {
    const name = normalizeText(policy.agentName);
    const hasName = name.length > 0 && parts.some((p) => p.type === "text" && normalizeText(p.content).includes(name));
    if (!hasName) parts = [{ type: "text", content: policy.introductionText }, ...parts];
  }
  // (1.5) R12-B backstop determinístico do DEFERIMENTO: se o LLM insistir em perguntar o slot que decideFunnelNext
  // mandou DEFERIR (o lead ignorou e trouxe outra coisa), corrige o DRAFT antes de renderizar — DEFERE (remove a
  // pergunta, mantendo a resposta à intenção) ou AVANÇA (troca pela próxima pergunta). MESMA decisão do frame/
  // reconcile (fonte única = decideFunnelNext). Garante SLOT_FIXATION=0 mesmo se o LLM ignorar a guidance.
  {
    const funnel = decideFunnelNext(state, policy);
    if (funnel.deferredSlot) {
      let qi = -1;
      for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; if (p.type === "text" && trailingQuestion(p.content) != null) { qi = i; break; } }
      if (qi >= 0) {
        const content = (parts[qi] as Extract<ResponsePart, { type: "text" }>).content;
        const q = trailingQuestion(content);
        const askedSlot = q ? classifyConfiguredQuestion(q) : null;
        if (q && askedSlot === funnel.deferredSlot) {
          const prefix = content.slice(0, content.lastIndexOf(q)).trimEnd();
          const replacement = funnel.nextSlot ? (policy.questions[funnel.nextSlot] ?? DEFAULT_QUESTIONS[funnel.nextSlot]) : "";
          const newContent = replacement ? (prefix ? `${prefix} ${replacement}` : replacement) : prefix;
          const hasOtherContent = parts.some((pp, i) => i !== qi && (pp.type !== "text" || pp.content.trim().length > 0));
          // Só corrige se sobrar conteúdo (nunca produz mensagem vazia): senão deixa passar (caso degenerado raro).
          if (newContent.trim().length > 0) parts = parts.map((pp, i) => (i === qi ? { type: "text" as const, content: newContent } : pp));
          else if (hasOtherContent) parts = parts.filter((_, i) => i !== qi);
        }
      }
    }
  }
  // (2) anti-SLOT_FIXATION: a ÚLTIMA TextPart que é pergunta de slot repetida 3x -> troca pelo próximo faltante.
  let idx = -1;
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; if (p.type === "text" && trailingQuestion(p.content) != null) { idx = i; break; } }
  if (idx >= 0) {
    const content = (parts[idx] as Extract<ResponsePart, { type: "text" }>).content;
    const q = trailingQuestion(content);
    const askedSlot = q ? classifyConfiguredQuestion(q) : null;
    if (q && askedSlot) {
      const recent = (state.recentTurns ?? []).filter((t) => t.role === "agent").slice(-2);
      const repeats = recent.filter((t) => { const rq = trailingQuestion(t.text ?? ""); return rq != null && classifyConfiguredQuestion(rq) === askedSlot; }).length;
      if (repeats >= 2) {
        const view = deriveSdrQualification(state, policy);
        const next = view.missingSlots.find((s) => s !== askedSlot && slotApplicable(state, s));
        if (next) {
          const newQ = policy.questions[next] ?? DEFAULT_QUESTIONS[next];
          const prefix = content.slice(0, content.lastIndexOf(q)).trimEnd();
          parts = parts.map((pp, i) => (i === idx ? { type: "text" as const, content: prefix ? `${prefix} ${newQ}` : newQ } : pp));
        }
      }
    }
  }
  return { parts };
}