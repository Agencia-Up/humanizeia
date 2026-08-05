/**
 * Resolve a linha institucional usada pelo Jose no WhatsApp.
 *
 * Invariante principal: uma instancia vinculada a vendedor nunca pode enviar
 * relatorio, alerta, resumo ou pedido de aprovacao do Jose. O fallback tambem
 * nao e "qualquer numero conectado": precisa ser uma linha de um agente de IA
 * ativo do mesmo tenant.
 */

export type JoseSenderInstance = {
  id: string;
  user_id: string;
  seller_member_id?: string | null;
  status?: string | null;
  is_active?: boolean | null;
  api_url?: string | null;
  instance_name?: string | null;
  api_key_encrypted?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

type AgentInstanceBinding = {
  id?: string | null;
  instance_id?: string | null;
  instance_ids?: string[] | null;
};

function boundInstanceIds(agents: AgentInstanceBinding[]): Set<string> {
  const ids = new Set<string>();
  for (const agent of agents || []) {
    if (agent?.instance_id) ids.add(String(agent.instance_id));
    for (const id of Array.isArray(agent?.instance_ids) ? agent.instance_ids : []) {
      if (id) ids.add(String(id));
    }
  }
  return ids;
}

export function isJoseSenderEligible(
  instance: JoseSenderInstance | null | undefined,
  activeAgentInstanceIds: Set<string>,
): instance is JoseSenderInstance {
  if (!instance?.id || !instance?.user_id) return false;
  if (instance.seller_member_id != null) return false;
  if (instance.status !== "connected" || instance.is_active !== true) return false;
  if (!instance.api_url || !instance.instance_name || !instance.api_key_encrypted) return false;
  return activeAgentInstanceIds.has(String(instance.id));
}

export function pickJoseSenderInstance(
  instances: JoseSenderInstance[],
  activeAgents: AgentInstanceBinding[],
  preferredInstanceId?: string | null,
): JoseSenderInstance | null {
  const activeAgentInstanceIds = boundInstanceIds(activeAgents || []);
  const eligible = (instances || []).filter((instance) =>
    isJoseSenderEligible(instance, activeAgentInstanceIds)
  );

  if (preferredInstanceId) {
    const preferred = eligible.find((instance) => String(instance.id) === String(preferredInstanceId));
    if (preferred) return preferred;
  }

  return eligible[0] || null;
}

export async function resolveJoseSenderInstance(
  supabase: any,
  input: {
    user_id: string;
    agent_id?: string | null;
    preferred_instance_id?: string | null;
  },
): Promise<JoseSenderInstance | null> {
  try {
    let agentQuery = supabase
      .from("wa_ai_agents")
      .select("id, instance_id, instance_ids, updated_at")
      .eq("user_id", input.user_id)
      .eq("is_active", true);

    if (input.agent_id) agentQuery = agentQuery.eq("id", input.agent_id);

    const { data: agents, error: agentsError } = await agentQuery
      .order("updated_at", { ascending: false });
    if (agentsError || !Array.isArray(agents) || agents.length === 0) return null;

    const { data: instances, error: instancesError } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("user_id", input.user_id)
      .eq("status", "connected")
      .eq("is_active", true)
      .is("seller_member_id", null)
      .order("updated_at", { ascending: false });

    if (instancesError || !Array.isArray(instances)) return null;
    return pickJoseSenderInstance(instances, agents, input.preferred_instance_id);
  } catch (error) {
    console.error("[jose-sender] falha ao resolver linha institucional:", error);
    return null;
  }
}
