import type { TurnDecision } from "../domain/decision.ts";

export type FollowupStage = 1 | 2 | 3;

/**
 * Cria somente a parte autoral do follow-up. Texto e efeito operacional sao
 * eixos independentes: T1/T2 precisam de texto; o T3 pode continuar sem
 * send_message quando a cadeia de handoff configurada for materializada pelo
 * chamador. Assim uma falha de redacao nunca cancela a regra operacional do
 * portal, e a engine tambem nao inventa uma mensagem substituta.
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
