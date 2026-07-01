import type { ConversationState } from "../domain/conversation-state.ts";
import type { TenantRuntimeConfig } from "../domain/read-ports.ts";
import type { AnswerKind, ObjectiveType, SlotName } from "../domain/types.ts";
import type { TurnOutput } from "./decision-engine.ts";
import { normalizeText } from "./catalog-utils.ts";
import { attachQualificationObjective } from "./finalizer.ts";

export type SdrQualificationSlot = Exclude<SlotName, "cpf">;

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

const DEFAULT_QUESTIONS: Record<SdrQualificationSlot, string> = {
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

function classifyConfiguredQuestion(question: string): SdrQualificationSlot | null {
  const q = normalizeText(question);
  if (/\bnome\b|\bcomo.*cham/.test(q)) return "nome";
  if (/\bcidade\b|\bonde mora\b|\bde onde/.test(q)) return "cidade";
  if (/\bconhece.*loja\b|\bja veio.*loja|\bsabe.*onde.*loja\b|\bonde fica.*loja/.test(q)) return "conheceLoja";
  if (/\bparcela\b|\bmensal/.test(q)) return "parcelaDesejada";
  if (/\bentrada\b/.test(q)) return "entrada";
  if (/\bmodelo.*ano\b|\bano.*quilometr|\bdados.*veiculo.*troca/.test(q)) return "veiculoTroca";
  if (/\btroca\b/.test(q)) return "possuiTroca";
  if (/\bdia\b|\bhorario\b|\bquando.*visita/.test(q)) return "diaHorario";
  if (/\bvisita\b|\bagendar\b/.test(q)) return "interesseVisita";
  if (/\bpagamento\b|\bfinanc|\ba vista\b|\bconsorcio\b/.test(q)) return "formaPagamento";
  if (/\bfaixa.*valor\b|\borcamento\b|\bquanto.*invest/.test(q)) return "faixaPreco";
  if (/\bsuv\b|\bsedan\b|\bhatch\b|\bpicape\b|\btipo.*carro/.test(q)) return "tipoVeiculo";
  if (/\bmodelo\b|\bcarro.*procura\b|\bveiculo.*procura/.test(q)) return "interesse";
  return null;
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

function ensureInitialIntroduction(text: string, state: ConversationState, policy: SdrQualificationPolicy): string {
  if (state.turnNumber > 0 || state.recentTurns.some((turn) => turn.role === "agent")) return text;
  if (hasAgentIntroduction(text, policy.agentName)) return text;
  const greeting = /^(bom dia|boa tarde|boa noite|oi|ola)(?:[!,.])?/i.exec(text.trim());
  if (!greeting) return `${policy.introductionText}\n\n${text.trim()}`;
  const rest = text.trim().slice(greeting[0].length).trim();
  const firstLine = `${greeting[0]} ${policy.introductionText}`.trim();
  return rest ? `${firstLine}\n\n${rest}` : firstLine;
}

function trailingQuestion(text: string): string | null {
  const match = /(?:^|[\n.!]\s*)([^?\n]{2,240}\?)\s*$/u.exec(text.trim());
  return match?.[1]?.trim() ?? null;
}
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
  const selectedSlot = preservePortalQuestion ? modelQuestionSlot : view.nextSlot;
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

  return {
    ...contextualOutput,
    decision: {
      ...decision,
      responsePlan: {
        guidance: preservePortalQuestion
          ? decision.responsePlan.guidance
          : `${decision.responsePlan.guidance} Depois, faça somente esta pergunta de qualificação: ${question}`,
      },
    },
    composed: { draft: { parts: [{ type: "text", content: text }] }, text },
  };
}