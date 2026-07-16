import type { AgentBrainPort, TurnFrame } from "../domain/agent-brain.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import { ResponseRenderer } from "./response-renderer.ts";
import { buildWorkingMemory } from "./working-memory.ts";
import { buildConversationContext } from "./conversation-context.ts";
import type { FollowupStage } from "./followup-policy.ts";

function questionCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function normalizeFollowupText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function lastAgentMessage(state: ConversationState): string | null {
  for (let i = (state.recentTurns ?? []).length - 1; i >= 0; i -= 1) {
    if (state.recentTurns[i]?.role === "agent") return state.recentTurns[i]!.text;
  }
  return null;
}

function lastLeadMessage(state: ConversationState): string | null {
  for (let i = (state.recentTurns ?? []).length - 1; i >= 0; i -= 1) {
    if (state.recentTurns[i]?.role === "lead") return state.recentTurns[i]!.text;
  }
  return null;
}

// Follow-up pode mencionar algo enviado somente quando existe material
// factual correspondente no histórico/na oferta visível. Isto valida uma
// afirmação da LLM; não escolhe assunto, CTA ou próximo slot.
function claimsUnseenOutboundMaterial(text: string, state: ConversationState): boolean {
  const normalized = normalizeFollowupText(text);
  const claims = /\b(?:te|lhe)\s+(?:enviei|mandei|passei|mostrei|encaminhei)\b|\b(?:que|q)\s+(?:te|lhe)\s+(?:enviei|mandei|passei|mostrei)\b/.test(normalized);
  if (!claims) return false;
  const hasVisibleOffer = (state.lastRenderedOfferContext?.items.length ?? 0) > 0;
  const hasConcreteAgentMaterial = (state.recentTurns ?? [])
    .filter((turn) => turn.role === "agent")
    .some((turn) => /\b(?:r\$|km|modelo|ano|carro|veiculo|foto|endereco|avenida|rua|opcao|informac)/.test(normalizeFollowupText(turn.text)));
  return !hasVisibleOffer && !hasConcreteAgentMaterial;
}

// A T3 may mention an analyst only when the surrounding pilot is about to
// materialize the handoff chain. This validates an operational claim; it does
// not choose whether the lead should be transferred.
function claimsHandoffContinuity(text: string): boolean {
  const normalized = normalizeFollowupText(text);
  const mentionsTeam = /\b(?:analistas?|vendedores?|consultores?|equipe)\b/.test(normalized);
  const claimsAction = /\b(?:seu contato|contato)\b.{0,70}\b(?:ja\s+est[aá]|esta\s+com|ficara?\s+com|sera?\s+encaminhad|vai\s+(?:falar|receber)|entrara?\s+em\s+contato|dar[aá]\s+continuidade|encaminhad|transferid)/.test(normalized);
  return mentionsTeam && claimsAction;
}

function repeatsLastAgentQuestion(text: string, previous: string | null): boolean {
  if (!previous) return false;
  const normalizedText = normalizeFollowupText(text);
  const questions = previous.match(/[^?]{12,}\?/g) ?? [];
  return questions.some((question) => {
    const core = normalizeFollowupText(question).replace(/\?$/, "").trim();
    return core.length >= 18 && normalizedText.includes(core);
  });
}

function violatesFollowupStyle(text: string): boolean {
  const normalized = normalizeFollowupText(text);
  const startsWithGreeting = /^(?:bom dia|boa tarde|boa noite|ola|oi)\b/.test(normalized);
  const repeatsPresentation = /\b(?:sou o|sou a|aqui e o|aqui e a|meu nome e)\b/.test(normalized)
    || /\bconsultor(?:a)?\b/.test(normalized);
  const coldFarewell = /\bprefiro ser honesto\b|\btalvez nao seja o melhor cenario\b/.test(normalized);
  return startsWithGreeting || repeatsPresentation || coldFarewell;
}

export async function authorFollowupMessage(args: {
  brain: AgentBrainPort;
  state: ConversationState;
  stage: FollowupStage;
  turnId: string;
  now: string;
  portalPromptSha256: string;
  maxAttempts?: number;
}): Promise<string | null> {
  return (await authorFollowupMessageDetailed(args)).text;
}

export type FollowupAuthorResult = {
  readonly text: string | null;
  readonly attempts: number;
  readonly reason: "authored" | "brain_error" | "query_not_allowed" | "text_missing" | "question_contract" | "unsupported_claim" | "unsupported_handoff_claim";
};

export async function authorFollowupMessageDetailed(args: {
  brain: AgentBrainPort;
  state: ConversationState;
  stage: FollowupStage;
  turnId: string;
  now: string;
  portalPromptSha256: string;
  handoffAvailable?: boolean;
  maxAttempts?: number;
}): Promise<FollowupAuthorResult> {
  const { memory } = buildWorkingMemory(args.state, args.state.workingMemory);
  let feedback = "";
  let lastReason: FollowupAuthorResult["reason"] = "text_missing";
  const maxAttempts = args.maxAttempts ?? 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const previousAgent = lastAgentMessage(args.state);
    const previousLead = lastLeadMessage(args.state);
    const block = `[EVENTO SISTEMICO FOLLOW-UP T${args.stage}] O cliente esta inativo. Reabra a conversa com autoria propria, usando apenas o historico factual deste frame. Nao afirme que algo foi enviado se nao aparece nas falas anteriores ou na oferta visivel.${feedback}`;
    const conversationContext = buildConversationContext({ state: args.state, workingMemory: memory });
    const frame: TurnFrame = {
      turnId: args.turnId,
      now: args.now,
      block,
      portalPromptSha256: args.portalPromptSha256,
      workingMemory: memory,
      recentTranscript: (args.state.recentTurns ?? []).slice(-12).map((turn) => ({ role: turn.role, text: turn.text })),
      conversationContext: {
        ...conversationContext,
        followup: {
          stage: args.stage,
          lastLeadMessage: previousLead,
          lastAgentMessage: previousAgent,
          hasVisibleOffer: (args.state.lastRenderedOfferContext?.items.length ?? 0) > 0,
          handoffAvailable: args.handoffAvailable === true,
        },
      },
      currentTurnFacts: { expectedAnswer: { slot: null, lastAgentQuestion: null }, extracted: [], offerReference: null },
      signals: {
        mentionsPhoto: false,
        mentionsStore: false,
        mentionsMoreOptions: false,
        mentionsVehicleType: null,
        isMemoryQuestion: false,
        relation: "unrelated",
        currentTurnIntent: "other",
        followupStage: args.stage,
        handoffAvailable: args.handoffAvailable === true,
      },
    };
    let step;
    try {
      step = await args.brain.proposeNextStep(frame, []);
    } catch {
      lastReason = "brain_error";
      feedback = " FEEDBACK: gere apenas a mensagem curta de follow-up em um final de texto.";
      continue;
    }
    if (step.kind !== "final") {
      lastReason = "query_not_allowed";
      feedback = " FEEDBACK: follow-up nao usa tools; devolva final em texto.";
      continue;
    }
    const draft = step.decision.responsePlan.draft;
    const textParts = draft?.parts.filter((part) => part.type === "text") ?? [];
    if (textParts.length === 0) {
      lastReason = "text_missing";
      feedback = " FEEDBACK: inclua uma mensagem em draft.parts usando uma parte text.";
      continue;
    }
    // A LLM continua sendo a autora. Efeitos ou refs adicionais propostos por ela
    // sao deliberadamente ignorados: o turno sistemico possui seu proprio plano
    // seguro e nao deve falhar apenas porque o provider devolveu metadados extras.
    let text: string;
    try { text = ResponseRenderer.render({ parts: textParts }, [], args.state).trim(); }
    catch { text = ""; }
    const repeatedQuestion = args.stage !== 3 && repeatsLastAgentQuestion(text, lastAgentMessage(args.state));
    const invalidStyle = violatesFollowupStyle(text);
    const unsupportedClaim = claimsUnseenOutboundMaterial(text, args.state);
    const unsupportedHandoffClaim = args.stage === 3 && claimsHandoffContinuity(text) && args.handoffAvailable !== true;
    const questions = questionCount(text);
    if (!text || invalidStyle || repeatedQuestion || unsupportedClaim || unsupportedHandoffClaim || (args.stage === 3 ? questions !== 0 : questions > 1)) {
      lastReason = !text ? "text_missing" : unsupportedHandoffClaim ? "unsupported_handoff_claim" : unsupportedClaim ? "unsupported_claim" : "question_contract";
      feedback = args.stage === 3
        ? unsupportedHandoffClaim
          ? " FEEDBACK: o contexto deste T3 nao confirma uma transferencia executavel. Despeca-se sem dizer que o contato esta com analista/vendedor/equipe; deixe a porta aberta de forma cordial."
          : " FEEDBACK: T3 deve ser uma despedida curta, amigavel e sem pergunta. Nao use saudacao, apresentacao, 'Prefiro ser honesto' ou linguagem de desistencia fria."
        : unsupportedClaim
          ? " FEEDBACK: sua mensagem afirmou que algo foi enviado, mas esse material nao esta comprovado no historico atual. Reescreva sem essa afirmacao e reabra com uma mensagem verdadeira ligada ao contexto disponivel."
        : repeatedQuestion
          ? " FEEDBACK: voce repetiu a ultima pergunta do atendente. Retome o assunto com uma pergunta diferente, simples e facil de responder."
          : invalidStyle
            ? " FEEDBACK: follow-up nao pode ter saudacao, reapresentacao, 'Prefiro ser honesto' ou linguagem de desistencia. Retome o historico com naturalidade."
            : " FEEDBACK: escreva uma mensagem curta com no maximo uma pergunta.";
      continue;
    }
    return { text, attempts: attempt + 1, reason: "authored" };
  }
  return { text: null, attempts: maxAttempts, reason: lastReason };
}
