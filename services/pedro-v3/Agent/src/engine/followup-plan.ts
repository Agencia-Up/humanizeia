import type { TurnDecision } from "../domain/decision.ts";

export type FollowupStage = 1 | 2 | 3;

export const T3_TRANSFER_NOTICE =
  "Estarei te transferindo para um dos nossos consultores de vendas. Agradeço o contato!";

export type FollowupMessageResolution = {
  readonly text: string | null;
  readonly source: "llm" | "operational_fallback" | "none";
};

/**
 * Preserva a autoria comercial da LLM. A unica excecao e um recibo operacional
 * no T3, depois de esgotadas as tentativas de autoria e somente quando o
 * handoff ja foi validado como executavel. T1/T2 nunca recebem texto da engine.
 */
export function resolveFollowupMessageText(args: {
  readonly stage: FollowupStage;
  readonly authoredText: string | null;
  readonly handoffAvailable: boolean;
}): FollowupMessageResolution {
  const authoredText = args.authoredText?.trim() || null;
  if (authoredText) return { text: authoredText, source: "llm" };
  if (args.stage === 3 && args.handoffAvailable) {
    return { text: T3_TRANSFER_NOTICE, source: "operational_fallback" };
  }
  return { text: null, source: "none" };
}

/**
 * Cria a parte de mensagem do follow-up. O chamador resolve antes se o texto
 * veio da LLM ou do recibo operacional estrito do T3; este builder apenas
 * materializa o texto recebido e nunca decide a conducao comercial.
 */
export function buildFollowupBaseDecision(args: {
  readonly turnId: string;
  readonly stage: FollowupStage;
  readonly anchorEffectId: string;
  readonly now: string;
  readonly text: string | null;
}): TurnDecision {
  const messagePlanId = "followup-message";
  const messageEffectId = `${args.turnId}:${messagePlanId}`;
  return {
    turnId: args.turnId,
    action: args.stage === 3 ? "close" : "reply",
    reasonCode: `followup_t${args.stage}`,
    reasonSummary: "system_followup_due",
    confidence: 1,
    decisionMutations: [],
    responsePlan: { guidance: "llm_authored_followup" },
    policyChecks: [],
    effectPlan: args.text == null ? [] : [{
      kind: "send_message",
      planId: messagePlanId,
      effectId: messageEffectId,
      order: 1,
      dependsOn: [],
      onSuccess: [
        {
          op: "mark_followup_sent",
          effectId: messageEffectId,
          anchorEffectId: args.anchorEffectId,
          stage: args.stage,
          sentAt: args.now,
        },
        {
          op: "append_assistant_turn",
          effectId: messageEffectId,
          turn: { role: "agent", text: args.text, at: args.now },
        },
      ],
    }],
  };
}
