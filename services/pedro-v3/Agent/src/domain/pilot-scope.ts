// Pedro v3 pilot scope.
//
// The active pilot is not a marketing flag and not an email check. It is a
// hard tenant+agent authorization boundary so production clients remain on v2.

export const PEDRO_V3_PILOT_TENANT_ID = "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0";
export const PEDRO_V3_PILOT_AGENT_ID = "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185";

export type PilotMode = "off" | "shadow" | "active";

export type PilotScopeDecision = {
  readonly enabled: boolean;
  readonly mode: PilotMode;
  readonly identityMatched: boolean;
  readonly reason: "pilot_allowed" | "pilot_disabled" | "not_pilot_identity";
};

export function normalizePilotMode(value: unknown): PilotMode {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "shadow" || raw === "active") return raw;
  return "off";
}

export function isPedroV3PilotScope(input: {
  readonly tenantId?: string | null;
  readonly agentId?: string | null;
}): boolean {
  return input.tenantId === PEDRO_V3_PILOT_TENANT_ID &&
    input.agentId === PEDRO_V3_PILOT_AGENT_ID;
}

export function evaluatePedroV3PilotScope(input: {
  readonly tenantId?: string | null;
  readonly agentId?: string | null;
  readonly mode?: unknown;
}): PilotScopeDecision {
  const identityMatched = isPedroV3PilotScope(input);
  if (!identityMatched) {
    return { enabled: false, mode: "off", identityMatched, reason: "not_pilot_identity" };
  }

  const mode = normalizePilotMode(input.mode);
  if (mode === "off") {
    return { enabled: false, mode, identityMatched, reason: "pilot_disabled" };
  }

  return { enabled: true, mode, identityMatched, reason: "pilot_allowed" };
}
