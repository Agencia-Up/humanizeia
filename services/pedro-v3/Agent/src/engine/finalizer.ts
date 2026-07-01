// ============================================================================
// Finalizer — PURO. ÚNICA autoridade que emite a TurnDecision (Brain/02 §2.7).
// Combina propostas + vereditos + injeta effectId infalsificável.
// ============================================================================
import type { Id } from "../domain/types.ts";
import type {
  ProposedDecision, PolicyVerdict, QueryResult, TurnDecision, TurnAction, EffectPlan, SendMessagePlan, DecisionMutation, EffectOutcomeMutation
} from "../domain/decision.ts";
import type { PlannedObjective } from "../domain/conversation-state.ts";
import { hasDeny, collectRequirements } from "./policy-engine.ts";

const ALLOWED_OUTCOMES: Record<string, string[]> = {
  send_message: ["activate_objective", "mark_message_delivered", "record_offer", "set_presented_vehicle_focus", "advance_stage", "append_assistant_turn"],
  send_media: ["mark_photos_sent", "record_offer", "set_presented_vehicle_focus", "append_assistant_turn", "activate_objective", "advance_stage"],
  crm_write: ["advance_stage"],
  schedule_visit: ["advance_stage"],
  handoff: ["mark_handoff_completed", "advance_stage"],
  notify_seller: ["advance_stage"],
};

export function effectIdFor(turnId: Id, planId: Id): Id {
  return `${turnId}:${planId}`;
}

function safeSendMessagePlan(turnId: Id, planId: Id): SendMessagePlan {
  return {
    kind: "send_message",
    planId,
    effectId: effectIdFor(turnId, planId),
    order: 1,
    onSuccess: []
  };
}

function filterOrphanObjectives(mutations: DecisionMutation[], activePlanIds: Set<Id>, turnId: Id): DecisionMutation[] {
  const activeEffectIds = new Set([...activePlanIds].map(pid => `${turnId}:${pid}`));
  return mutations.filter((m) => {
    if (m.op === "set_planned_objective") {
      return activeEffectIds.has(m.planned.effectId);
    }
    return true;
  });
}

export function validateEffectPlans(plans: EffectPlan[]): string[] {
  const violations: string[] = [];
  const planIds = new Set<string>();

  // 1. planIds únicos
  for (const p of plans) {
    if (planIds.has(p.planId)) {
      violations.push(`planId duplicado: ${p.planId}`);
    }
    planIds.add(p.planId);
  }

  // 2. dependsOn existentes
  for (const p of plans) {
    if (p.dependsOn) {
      for (const dep of p.dependsOn) {
        if (!planIds.has(dep)) {
          violations.push(`plano ${p.planId} depende de plano inexistente ${dep}`);
        }
      }
    }
  }

  // 3. sem ciclos (DFS)
  const adj = new Map<string, string[]>();
  for (const p of plans) {
    adj.set(p.planId, p.dependsOn ?? []);
  }

  const visited = new Map<string, number>();
  function hasCycle(u: string): boolean {
    visited.set(u, 1);
    const neighbors = adj.get(u) ?? [];
    for (const v of neighbors) {
      const state = visited.get(v) ?? 0;
      if (state === 1) return true;
      if (state === 0) {
        if (hasCycle(v)) return true;
      }
    }
    visited.set(u, 2);
    return false;
  }

  for (const p of plans) {
    if ((visited.get(p.planId) ?? 0) === 0) {
      if (hasCycle(p.planId)) {
        violations.push("ciclo de dependência detectado nos planos de efeito");
        break;
      }
    }
  }

  // 4. outcome permitido pelo kind & dados coerentes
  for (const p of plans) {
    const allowed = ALLOWED_OUTCOMES[p.kind];
    for (const o of p.onSuccess) {
      if (!allowed || !allowed.includes(o.op)) {
        violations.push(`operação ${o.op} não permitida para o tipo ${p.kind} no plano ${p.planId}`);
      }

      if (p.kind === "send_media" && o.op === "mark_photos_sent") {
        if (o.vehicleKey !== p.vehicleKey) {
          violations.push(`mark_photos_sent.vehicleKey ${o.vehicleKey} divergente de plan.vehicleKey ${p.vehicleKey}`);
        }
        for (const id of o.photoIds) {
          if (!p.photoIds.includes(id)) {
            violations.push(`mark_photos_sent.photoId ${id} ausente de plan.photoIds no plano ${p.planId}`);
          }
        }
      }

      if (p.kind === "handoff" && o.op === "mark_handoff_completed") {
        if (o.sellerId !== p.sellerId) {
          violations.push(`mark_handoff_completed.sellerId ${o.sellerId} divergente de plan.sellerId ${p.sellerId}`);
        }
      }
    }
  }

  return violations;
}

export function validateDecisionObjectives(decision: TurnDecision): string[] {
  const violations: string[] = [];

  const plannedCounts = new Map<string, number>();
  const plannedMap = new Map<string, { effectId: string; mutation: DecisionMutation }>();
  for (const m of decision.decisionMutations) {
    if (m.op === "set_planned_objective") {
      const id = m.planned.id;
      plannedCounts.set(id, (plannedCounts.get(id) ?? 0) + 1);
      plannedMap.set(id, { effectId: m.planned.effectId, mutation: m });
    }
  }

  const activateCounts = new Map<string, number>();
  const activateMap = new Map<string, { effectId: string; planKind: string }>();
  for (const p of decision.effectPlan) {
    for (const o of p.onSuccess) {
      if (o.op === "activate_objective") {
        const id = o.plannedObjectiveId;
        activateCounts.set(id, (activateCounts.get(id) ?? 0) + 1);
        activateMap.set(id, { effectId: p.effectId, planKind: p.kind });
      }
    }
  }

  // 1. Verificar duplicatas de set_planned_objective (Fase 1.4)
  for (const [objId, count] of plannedCounts.entries()) {
    if (count > 1) {
      violations.push(`duplicata de set_planned_objective para o objetivo '${objId}' (${count} ocorrências)`);
    }
  }

  // 2. Verificar duplicatas de activate_objective (Fase 1.4)
  for (const [objId, count] of activateCounts.entries()) {
    if (count > 1) {
      violations.push(`duplicata de activate_objective para o objetivo '${objId}' (${count} ocorrências)`);
    }
  }

  // 3. Cada set_planned_objective exige exatamente um activate_objective no mesmo effectId
  for (const [objId, pl] of plannedMap.entries()) {
    const act = activateMap.get(objId);
    if (!act) {
      violations.push(`set_planned_objective para '${objId}' não possui activate_objective correspondente`);
      continue;
    }
    if (act.effectId !== pl.effectId) {
      violations.push(`set_planned_objective effectId '${pl.effectId}' divergente de activate_objective effectId '${act.effectId}' para o objetivo '${objId}'`);
    }
    if (act.planKind !== "send_message" && act.planKind !== "send_media") {
      violations.push(`objetivo '${objId}' ativado por plano incompatível '${act.planKind}' (apenas send_message/send_media permitido)`);
    }
  }

  // 4. Cada activate_objective exige exatamente um set_planned_objective correspondente
  for (const [objId, act] of activateMap.entries()) {
    const pl = plannedMap.get(objId);
    if (!pl) {
      violations.push(`activate_objective para '${objId}' não possui set_planned_objective correspondente`);
    }
  }

  return violations;
}

export function attachQualificationObjective(
  decision: TurnDecision,
  objective: Omit<PlannedObjective, "activationPlanId" | "effectId">,
): TurnDecision | null {
  if (decision.decisionMutations.some((m) => m.op === "set_planned_objective")) return null;
  if (decision.effectPlan.some((p) => p.onSuccess.some((o) => o.op === "activate_objective"))) return null;

  const messageIndex = decision.effectPlan.findIndex((p) => p.kind === "send_message");
  if (messageIndex < 0) return null;
  const message = decision.effectPlan[messageIndex];
  const planned: PlannedObjective = {
    ...objective,
    activationPlanId: message.planId,
    effectId: message.effectId,
  };
  const effectPlan = decision.effectPlan.map((plan, index) => index === messageIndex
    ? {
        ...plan,
        onSuccess: [
          ...plan.onSuccess,
          { op: "activate_objective" as const, effectId: plan.effectId, plannedObjectiveId: planned.id },
        ],
      }
    : plan);
  const next: TurnDecision = {
    ...decision,
    decisionMutations: [...decision.decisionMutations, { op: "set_planned_objective", planned }],
    effectPlan,
  };
  if (validateEffectPlans(next.effectPlan).length > 0) return null;
  if (validateDecisionObjectives(next).length > 0) return null;
  return next;
}

export function finalize(
  turnId: Id,
  proposal: ProposedDecision,
  postVerdicts: PolicyVerdict[],
  _facts: QueryResult[],
): TurnDecision {
  const denied = hasDeny(postVerdicts);

  let initialEffects = denied
    ? [safeSendMessagePlan(turnId, "safe-msg")]
    : proposal.proposedEffects;

  // Materializa e injeta os IDs exatos e inalteráveis nos planos de efeito
  const effectPlan = initialEffects.map((p) => {
    const effectId = effectIdFor(turnId, p.planId);
    return {
      ...p,
      effectId,
      onSuccess: p.onSuccess.map(o => ({ ...o, effectId }))
    } as EffectPlan;
  });

  // Materializa a mutação set_planned_objective injetando o effectId a partir do activationPlanId
  let decisionMutations = proposal.facts.map((m) => {
    if (m.op === "set_planned_objective") {
      const effectId = effectIdFor(turnId, m.planned.activationPlanId);
      return {
        ...m,
        planned: {
          ...m.planned,
          effectId
        }
      };
    }
    return m;
  });

  const activePlanIds = new Set(effectPlan.map(p => p.planId));
  decisionMutations = filterOrphanObjectives(decisionMutations, activePlanIds, turnId);

  const decision: TurnDecision = {
    turnId,
    action: denied ? "reply" : proposal.proposedAction,
    target: denied ? null : (proposal.target ?? null),
    reasonCode: denied ? "policy_deny" : proposal.reasonCode,
    reasonSummary: denied ? "Violação de política" : proposal.reasonSummary,
    confidence: denied ? 0.9 : proposal.confidence,
    decisionMutations,
    effectPlan,
    responsePlan: proposal.responsePlan,
    policyChecks: postVerdicts,
  };

  // 1. Validar planos de efeito estruturalmente
  const planViolations = validateEffectPlans(effectPlan);
  if (planViolations.length > 0) {
    return emitTerminalSafe(turnId, decision, `Plano de efeitos inválido: ${planViolations.join("; ")}`);
  }

  // 2. Validar acoplamento de objetivos
  const objectiveViolations = validateDecisionObjectives(decision);
  if (objectiveViolations.length > 0) {
    return emitTerminalSafe(turnId, decision, `Inconsistência de objetivos: ${objectiveViolations.join("; ")}`);
  }

  if (!denied) {
    return decision;
  }

  // Tratamento de DENY comercial -> ação de fallback no trilho seguro
  const reqs = collectRequirements(postVerdicts);
  const denyIds = postVerdicts.filter((v) => v.outcome === "deny").map((v) => v.policyId);
  let action: TurnAction = "reply";
  let guidance = "Responder no trilho atual sem violar invariante.";
  if (reqs.length > 0) {
    action = "collect_slot";
    guidance = `Coletar dado obrigatório: ${reqs.join(", ")}.`;
  } else if (denyIds.includes("POL-TRACK-001")) {
    action = "reply";
    guidance = "Acolher a restrição de financiamento e perguntar a parcela confortável.";
  } else if (denyIds.includes("POL-STOCK-003")) {
    action = "clarify";
    guidance = "Não ofertar veículo acima do teto; confirmar a faixa ou oferecer alternativa.";
  }

  return {
    ...decision,
    action,
    reasonCode: `policy_deny:${denyIds.join(",")}`,
    reasonSummary: guidance,
    responsePlan: { guidance },
  };
}

export function emitTerminalSafe(
  turnId: Id,
  originalDecision: TurnDecision,
  reason: string
): TurnDecision {
  const safe: EffectPlan[] = [safeSendMessagePlan(turnId, "safe-terminal")];
  const activePlanIds = new Set(safe.map(p => p.planId));
  const decisionMutations = filterOrphanObjectives(originalDecision.decisionMutations, activePlanIds, turnId);

  return {
    turnId,
    action: "reply",
    target: null,
    reasonCode: "terminal_safe",
    reasonSummary: `Validação falhou. Efeitos comerciais cancelados. Razão: ${reason}`,
    confidence: 0.9,
    decisionMutations,
    effectPlan: safe,
    responsePlan: { guidance: "Validação falhou. Resposta de fallback segura." },
    policyChecks: originalDecision.policyChecks,
  };
}

export function emitErrorTerminalSafe(
  turnId: Id,
  step: string,
  reason: string
): TurnDecision {
  const safe: EffectPlan[] = [safeSendMessagePlan(turnId, "safe-terminal")];

  return {
    turnId,
    action: "reply",
    target: null,
    reasonCode: step === "global" ? "timeout" : "error",
    reasonSummary: `Erro/Timeout no passo ${step}: ${reason}`,
    confidence: 0.5,
    decisionMutations: [],
    effectPlan: safe,
    responsePlan: { guidance: "Erro ou timeout detectado. Resposta segura." },
    policyChecks: [{ policyId: "POL-TIMEOUT-GUARD", outcome: "deny", detail: reason }],
  };
}
