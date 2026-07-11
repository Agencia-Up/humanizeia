import type { AgentBrainPort, TurnFrame } from "../domain/agent-brain.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import { ResponseRenderer } from "./response-renderer.ts";
import { buildWorkingMemory } from "./working-memory.ts";
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
  const { memory } = buildWorkingMemory(args.state, args.state.workingMemory);
  let feedback = "";
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
    const step = await args.brain.proposeNextStep(frame, []);
    if (step.kind !== "final") {
      feedback = " FEEDBACK: follow-up nao usa tools; devolva final em texto.";
      continue;
    }
    const draft = step.decision.responsePlan.draft;
    if (!draft || draft.parts.some((part) => part.type !== "text") || step.decision.proposedEffects.length > 0) {
      feedback = " FEEDBACK: use somente partes text e nenhum efeito; a infraestrutura cuida das acoes.";
      continue;
    }
    let text: string;
    try { text = ResponseRenderer.render(draft, [], args.state).trim(); }
    catch { text = ""; }
    const questions = questionCount(text);
    if (!text || (args.stage === 3 ? questions !== 0 : questions > 1)) {
      feedback = args.stage === 3
        ? " FEEDBACK: T3 deve ser uma despedida curta sem pergunta."
        : " FEEDBACK: escreva uma mensagem curta com no maximo uma pergunta.";
      continue;
    }
    return text;
  }
  return null;
}
