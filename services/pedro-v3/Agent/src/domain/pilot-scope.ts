// Pedro v3 rollout scope.
//
// This module keeps the old pilot API for compatibility, but production is now
// globally v3-only. PEDRO_V3_ACTIVE_SCOPES is retained as a parseable legacy
// diagnostic setting; it is not required to activate a tenant or agent.

export const PEDRO_V3_PILOT_TENANT_ID = "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0";
export const PEDRO_V3_PILOT_AGENT_ID = "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185";

export type PilotMode = "off" | "shadow" | "active";

export const PEDRO_V3_GLOBAL_ROLLOUT = true;

export type PedroV3ActiveScope = {
  readonly tenantId: string;
  readonly agentId: string;
};

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const LEGACY_PEDRO_V3_SCOPE: PedroV3ActiveScope = Object.freeze({
  tenantId: PEDRO_V3_PILOT_TENANT_ID,
  agentId: PEDRO_V3_PILOT_AGENT_ID,
});

// A lista vem da infra, mas este parser permanece puro para o bridge e o runtime
// usarem exatamente o mesmo contrato. Ela não é mais necessária no rollout
// global; mantemos o parsing para detectar configuração antiga malformada.
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
  const seen = new Set<string>();
  const scopes: PedroV3ActiveScope[] = [];
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

export function isPedroV3ActiveScope(
  input: { readonly tenantId?: string | null; readonly agentId?: string | null },
  scopes: readonly PedroV3ActiveScope[] = [LEGACY_PEDRO_V3_SCOPE],
): boolean {
  if (PEDRO_V3_GLOBAL_ROLLOUT) {
    return Boolean(String(input.tenantId ?? "").trim() && String(input.agentId ?? "").trim());
  }
  return scopes.some((scope) => input.tenantId === scope.tenantId && input.agentId === scope.agentId);
}

export function isPedroV3PilotScope(input: {
  readonly tenantId?: string | null;
  readonly agentId?: string | null;
}): boolean {
  return isPedroV3ActiveScope(input);
}

export function evaluatePedroV3PilotScope(input: {
  readonly tenantId?: string | null;
  readonly agentId?: string | null;
  readonly mode?: unknown;
  readonly activeScopes?: readonly PedroV3ActiveScope[];
}): PilotScopeDecision {
  const identityMatched = isPedroV3ActiveScope(input, input.activeScopes);
  if (!identityMatched) {
    return { enabled: false, mode: "off", identityMatched, reason: "not_pilot_identity" };
  }

  // Missing mode is active after the global rollout. Explicit "off" remains
  // the emergency kill switch and keeps rollback possible without a deploy.
  const rawMode = String(input.mode ?? "").trim();
  const mode = rawMode === "" ? "active" : normalizePilotMode(rawMode);
  if (mode === "off") {
    return { enabled: false, mode, identityMatched, reason: "pilot_disabled" };
  }

  return { enabled: true, mode, identityMatched, reason: "pilot_allowed" };
}
