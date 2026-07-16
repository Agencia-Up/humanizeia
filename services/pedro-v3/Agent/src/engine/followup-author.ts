import type { AgentBrainPort, TurnFrame } from "../domain/agent-brain.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import { ResponseRenderer } from "./response-renderer.ts";
import { buildWorkingMemory } from "./working-memory.ts";
import { buildConversationContext } from "./conversation-context.ts";
import type { FollowupStage } from "./followup-policy.ts";

function questionCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
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
  readonly reason: "authored" | "brain_error" | "query_not_allowed" | "text_missing" | "question_contract";
};

export async function authorFollowupMessageDetailed(args: {
  brain: AgentBrainPort;
  state: ConversationState;
  stage: FollowupStage;
  turnId: string;
  now: string;
  portalPromptSha256: string;
  maxAttempts?: number;
}): Promise<FollowupAuthorResult> {
  const { memory } = buildWorkingMemory(args.state, args.state.workingMemory);
  let feedback = "";
  let lastReason: FollowupAuthorResult["reason"] = "text_missing";
  const maxAttempts = args.maxAttempts ?? 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const block = `[EVENTO SISTEMICO FOLLOW-UP T${args.stage}] O cliente esta inativo. Redija a mensagem conforme o protocolo de follow-up.${feedback}`;
    const frame: TurnFrame = {
      turnId: args.turnId,
      now: args.now,
      block,
      portalPromptSha256: args.portalPromptSha256,
      workingMemory: memory,
      recentTranscript: (args.state.recentTurns ?? []).slice(-12).map((turn) => ({ role: turn.role, text: turn.text })),
      conversationContext: buildConversationContext({ state: args.state, workingMemory: memory }),
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
    const questions = questionCount(text);
    if (!text || (args.stage === 3 ? questions !== 0 : questions > 1)) {
      lastReason = !text ? "text_missing" : "question_contract";
      feedback = args.stage === 3
        ? " FEEDBACK: T3 deve ser uma despedida curta sem pergunta."
        : " FEEDBACK: escreva uma mensagem curta com no maximo uma pergunta.";
      continue;
    }
    return { text, attempts: attempt + 1, reason: "authored" };
  }
  return { text: null, attempts: maxAttempts, reason: lastReason };
}
