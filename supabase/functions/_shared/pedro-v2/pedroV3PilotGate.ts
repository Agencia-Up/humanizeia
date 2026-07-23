// Pedro v3 rollout gate.
//
// The historical name is kept for import compatibility, but production is now
// v3-only: every real tenant+agent identity is eligible for v3. The old
// PEDRO_V3_ACTIVE_SCOPES variable remains parseable for diagnostics and older
// callers, but it is no longer an activation allowlist.

export const PEDRO_V3_PILOT_TENANT_ID = "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0";
export const PEDRO_V3_PILOT_AGENT_ID = "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185";

export type PedroV3PilotMode = "off" | "shadow" | "active";

export type PedroV3ActiveScope = {
  tenantId: string;
  agentId: string;
};

// Migração concluída: esta Edge Function conserva o nome histórico, mas não
// pode mais entregar turnos comerciais ao Pedro v2.
export const PEDRO_V3_ONLY = true;
export const PEDRO_V3_GLOBAL_ROLLOUT = true;

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

// Compatibility parser shared with the Node runtime. The list is retained so
// old deployments can still report malformed configuration, but global v3
// rollout does not require or depend on this variable.
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
  if (PEDRO_V3_GLOBAL_ROLLOUT) {
    return Boolean(String(input.tenantId || "").trim() && String(input.agentId || "").trim());
  }
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

  // Missing mode means active after the global rollout. An explicit "off"
  // still remains an emergency kill switch.
  const rawMode = String(input.mode ?? "").trim();
  const mode = rawMode === "" ? "active" : normalizePedroV3PilotMode(rawMode);
  if (mode === "off") {
    return { enabled: false, mode, identityMatched, reason: "pilot_disabled" };
  }

  return { enabled: true, mode, identityMatched, reason: "pilot_allowed" };
}

// Ownership boundary shared by every legacy v2 entry point. Once a scope is
// active in v3, no webhook, recovery worker or follow-up cron may invoke v2
// for that same tenant+agent pair.
export function isPedroV3ExclusiveScope(input: {
  tenantId?: string | null;
  agentId?: string | null;
  mode?: unknown;
  activeScopes?: readonly PedroV3ActiveScope[];
}): boolean {
  const decision = evaluatePedroV3Pilot(input);
  return decision.enabled && decision.mode === "active";
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
