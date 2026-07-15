// Pedro v3 pilot gate.
//
// This module is deliberately tiny and deterministic: the v3 pilot can only
// match the owner's explicit tenant+agent pair. Never authorize by email,
// agent name, instance fallback, or "first active agent".

export const PEDRO_V3_PILOT_TENANT_ID = "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0";
export const PEDRO_V3_PILOT_AGENT_ID = "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185";

export type PedroV3PilotMode = "off" | "shadow" | "active";

export type PedroV3ActiveScope = {
  tenantId: string;
  agentId: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const LEGACY_PEDRO_V3_SCOPE: PedroV3ActiveScope = Object.freeze({
  tenantId: PEDRO_V3_PILOT_TENANT_ID,
  agentId: PEDRO_V3_PILOT_AGENT_ID,
});

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

// Explicit allowlist shared with the Node runtime. An absent list preserves
// the legacy pilot only; invalid config must never broaden Edge routing.
export function parsePedroV3ActiveScopes(value: unknown): readonly PedroV3ActiveScope[] {
  if (value == null || String(value).trim() === "") return Object.freeze([LEGACY_PEDRO_V3_SCOPE]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new Error("PEDRO_V3_ACTIVE_SCOPES_INVALID");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20) {
    throw new Error("PEDRO_V3_ACTIVE_SCOPES_INVALID");
  }
  const scopes: PedroV3ActiveScope[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("PEDRO_V3_ACTIVE_SCOPES_INVALID");
    }
    const row = item as Record<string, unknown>;
    const tenantId = typeof row.tenantId === "string" ? row.tenantId.trim() : "";
    const agentId = typeof row.agentId === "string" ? row.agentId.trim() : "";
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(agentId)) {
      throw new Error("PEDRO_V3_ACTIVE_SCOPES_INVALID");
    }
    const key = `${tenantId.toLowerCase()}:${agentId.toLowerCase()}`;
    if (seen.has(key)) throw new Error("PEDRO_V3_ACTIVE_SCOPES_DUPLICATE");
    seen.add(key);
    scopes.push(Object.freeze({ tenantId, agentId }));
  }
  return Object.freeze(scopes);
}

export function isPedroV3PilotIdentity(input: {
  tenantId?: string | null;
  agentId?: string | null;
}, scopes: readonly PedroV3ActiveScope[] = [LEGACY_PEDRO_V3_SCOPE]): boolean {
  return scopes.some((scope) => scope.tenantId === input.tenantId && scope.agentId === input.agentId);
}

export function evaluatePedroV3Pilot(input: {
  tenantId?: string | null;
  agentId?: string | null;
  mode?: unknown;
  activeScopes?: readonly PedroV3ActiveScope[];
}): PedroV3PilotDecision {
  const identityMatched = isPedroV3PilotIdentity(input, input.activeScopes);
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
  activeScopes?: readonly PedroV3ActiveScope[],
): PedroV3PilotDecision {
  return evaluatePedroV3Pilot({
    tenantId: typeof agent?.user_id === "string" ? agent.user_id : waInstance?.user_id,
    agentId: typeof agent?.id === "string" ? agent.id : null,
    mode,
    activeScopes,
  });
}
