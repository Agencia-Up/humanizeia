import type { ConversationState } from "../../domain/conversation-state.ts";
import type { V3DatabaseGateway } from "../../domain/database-gateway.ts";
import type { TenantAgentRef } from "../../domain/read-ports.ts";

export type FollowupCandidate = {
  conversationId: string;
  toAddr: string;
  leadId: string | null;
  state: ConversationState;
};

export class FollowupCandidateStore {
  constructor(private readonly gateway: V3DatabaseGateway) {}

  async list(ref: TenantAgentRef, limit = 100): Promise<FollowupCandidate[]> {
    const states = await this.gateway.selectMany("v3_conversation_state", {
      tenant_id: ref.tenantId,
      agent_id: ref.agentId,
    }, {
      columns: "conversation_id,lead_id,state",
      order: [{ column: "updated_at", ascending: false }],
      limit,
    });
    const candidates: FollowupCandidate[] = [];
    for (const row of states) {
      const conversationId = typeof row.conversation_id === "string" ? row.conversation_id : null;
      const state = row.state as unknown as ConversationState | undefined;
      if (!conversationId || !state || state.conversationId !== conversationId || state.tenantId !== ref.tenantId || state.agentId !== ref.agentId) continue;
      const routing = await this.gateway.selectOne("v3_conversation_routing", {
        tenant_id: ref.tenantId,
        conversation_id: conversationId,
        agent_id: ref.agentId,
      }, "to_addr,lead_id");
      const toAddr = typeof routing?.to_addr === "string" ? routing.to_addr : null;
      if (!toAddr) continue;
      const leadId = typeof state.leadId === "string"
        ? state.leadId
        : typeof routing?.lead_id === "string" ? routing.lead_id : null;
      candidates.push({ conversationId, toAddr, leadId, state });
    }
    return candidates;
  }
}
