import type { PersistResult } from "./persistPrivateInbound.ts";

export interface HumanOnlyLinkedAgent {
  id: string;
  user_id: string;
  is_active?: boolean | null;
}

export type HumanOnlyInboundDecision =
  | { kind: "skip"; reason: string }
  | {
      kind: "ensure";
      tenantId: string;
      agentId: string;
      instanceId: string;
      phone: string;
    };

export interface HumanOnlyInboundInput {
  persistResult: PersistResult;
  linkedAgent: HumanOnlyLinkedAgent | null;
  instanceId: string;
  phone: string;
}

/**
 * Decides only the operational consequence of an inbound message received on
 * an AI line whose linked agent is intentionally inactive.
 *
 * It never enables AI, sends a message, starts a transfer, or schedules a
 * follow-up. Its sole purpose is to ensure that the already persisted inbound
 * has a paused CRM projection so the human operation can see and handle it.
 */
export function decideInactiveAgentHumanMode(
  input: HumanOnlyInboundInput,
): HumanOnlyInboundDecision {
  if (!["persisted", "deduped"].includes(input.persistResult.status)) {
    return { kind: "skip", reason: `inbox_${input.persistResult.status}` };
  }
  if (input.persistResult.direction !== "incoming") {
    return { kind: "skip", reason: "not_incoming" };
  }
  if (!input.linkedAgent) {
    return { kind: "skip", reason: "no_linked_agent" };
  }
  if (input.linkedAgent.is_active !== false) {
    return {
      kind: "skip",
      reason: input.linkedAgent.is_active === true
        ? "agent_active"
        : "agent_state_unknown",
    };
  }
  if (!input.instanceId || !input.phone) {
    return { kind: "skip", reason: "missing_identity" };
  }
  return {
    kind: "ensure",
    tenantId: input.linkedAgent.user_id,
    agentId: input.linkedAgent.id,
    instanceId: input.instanceId,
    phone: input.phone,
  };
}

export type HumanOnlyInboundResult =
  | { ok: true; status: "skipped"; reason: string }
  | {
      ok: true;
      status: "ensured";
      reason: string;
      leadId: string | null;
      conversationId: string | null;
      created: boolean;
    }
  | { ok: false; status: "failed"; reason: string; error: string };

export async function ensureInactiveAgentHumanMode(
  supabase: any,
  input: HumanOnlyInboundInput,
): Promise<HumanOnlyInboundResult> {
  const decision = decideInactiveAgentHumanMode(input);
  if (decision.kind === "skip") {
    return { ok: true, status: "skipped", reason: decision.reason };
  }

  const { data, error } = await supabase.rpc("ensure_inactive_agent_human_lead_v1", {
    p_tenant: decision.tenantId,
    p_agent: decision.agentId,
    p_instance: decision.instanceId,
    p_phone: decision.phone,
  });

  if (error) {
    return {
      ok: false,
      status: "failed",
      reason: "rpc_error",
      error: String(error?.message || error),
    };
  }

  const result = data && typeof data === "object" ? data : null;
  if (!result || result.ok !== true) {
    // If the agent changed to active after the webhook read, the in-memory
    // agent snapshot is stale. Retrying the already persisted/idempotent
    // inbound is safer than silently dropping this first active turn.
    return {
      ok: false,
      status: "failed",
      reason: String(result?.reason || "rpc_rejected"),
      error: String(result?.error || result?.reason || "human_mode_not_ensured"),
    };
  }

  return {
    ok: true,
    status: "ensured",
    reason: String(result.reason || "inactive_agent_human_mode"),
    leadId: typeof result.lead_id === "string" ? result.lead_id : null,
    conversationId: typeof result.conversation_id === "string" ? result.conversation_id : null,
    created: result.created === true,
  };
}
