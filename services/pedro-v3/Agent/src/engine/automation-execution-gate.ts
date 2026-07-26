import type { TenantAgentRef } from "../domain/read-ports.ts";

export type AutomationActionKind = "conversation_turn" | "followup" | "effect_dispatch";

export type AutomationExecutionDecision = {
  readonly allowed: boolean;
  readonly reason: string;
};

export interface AutomationExecutionGate {
  decide(input: {
    readonly ref: TenantAgentRef;
    readonly leadId: string | null;
    readonly actionKind: AutomationActionKind;
  }): Promise<AutomationExecutionDecision>;
}

export function sanitizeAutomationReason(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").slice(0, 80);
  return normalized || "blocked";
}
