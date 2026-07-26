import type { V3DatabaseGateway } from "../domain/database-gateway.ts";
import type { JsonValue } from "../domain/types.ts";
import type {
  AutomationExecutionDecision,
  AutomationExecutionGate,
} from "../engine/automation-execution-gate.ts";
import { sanitizeAutomationReason } from "../engine/automation-execution-gate.ts";

function decodeDecision(value: JsonValue): AutomationExecutionDecision {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("AUTOMATION_DECISION_INVALID");
  }
  const allowed = value.allowed;
  const reason = value.reason;
  if (typeof allowed !== "boolean" || typeof reason !== "string") {
    throw new Error("AUTOMATION_DECISION_INVALID");
  }
  return { allowed, reason: sanitizeAutomationReason(reason) };
}

export class DatabaseAutomationExecutionGate implements AutomationExecutionGate {
  constructor(private readonly gateway: V3DatabaseGateway) {}

  async decide(input: Parameters<AutomationExecutionGate["decide"]>[0]): Promise<AutomationExecutionDecision> {
    const result = await this.gateway.rpc<JsonValue>("is_ai_automation_allowed", {
      p_tenant: input.ref.tenantId,
      p_agent_id: input.ref.agentId,
      p_lead_id: input.leadId,
      p_action_kind: input.actionKind,
      p_origin: "ai",
    });
    return decodeDecision(result);
  }
}
