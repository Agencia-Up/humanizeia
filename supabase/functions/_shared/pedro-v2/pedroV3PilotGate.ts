// Pedro v3 pilot gate.
//
// This module is deliberately tiny and deterministic: the v3 pilot can only
// match the owner's explicit tenant+agent pair. Never authorize by email,
// agent name, instance fallback, or "first active agent".

export const PEDRO_V3_PILOT_TENANT_ID = "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0";
export const PEDRO_V3_PILOT_AGENT_ID = "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185";

export type PedroV3PilotMode = "off" | "shadow" | "active";

export type PedroV3PilotDecision = {
  enabled: boolean;
  mode: PedroV3PilotMode;
  identityMatched: boolean;
  reason: "pilot_allowed" | "pilot_disabled" | "not_pilot_identity";
};

export function normalizePedroV3PilotMode(value: unknown): PedroV3PilotMode {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "shadow" || raw === "active") return raw;
  return "off";
}

export function isPedroV3PilotIdentity(input: {
  tenantId?: string | null;
  agentId?: string | null;
}): boolean {
  return input.tenantId === PEDRO_V3_PILOT_TENANT_ID &&
    input.agentId === PEDRO_V3_PILOT_AGENT_ID;
}

export function evaluatePedroV3Pilot(input: {
  tenantId?: string | null;
  agentId?: string | null;
  mode?: unknown;
}): PedroV3PilotDecision {
  const identityMatched = isPedroV3PilotIdentity(input);
  if (!identityMatched) {
    return { enabled: false, mode: "off", identityMatched, reason: "not_pilot_identity" };
  }

  const mode = normalizePedroV3PilotMode(input.mode);
  if (mode === "off") {
    return { enabled: false, mode, identityMatched, reason: "pilot_disabled" };
  }

  return { enabled: true, mode, identityMatched, reason: "pilot_allowed" };
}

export function evaluatePedroV3PilotAgent(
  agent: any,
  waInstance: any,
  mode: unknown,
): PedroV3PilotDecision {
  return evaluatePedroV3Pilot({
    tenantId: typeof agent?.user_id === "string" ? agent.user_id : waInstance?.user_id,
    agentId: typeof agent?.id === "string" ? agent.id : null,
    mode,
  });
}