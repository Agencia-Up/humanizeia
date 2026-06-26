// ── Helpers de roteamento compartilhados entre os webhooks de inbound ─────────
// Usado por pedro-webhook-v2 (UAZAPI) e meta-webhook (Cloud API do Meta) pra
// escolher QUAL agente da conta atende a instancia. Mantido aqui (fonte unica)
// pra os dois webhooks nao divergirem.

export function agentUsesInstance(agent: any, instanceId: string): boolean {
  return agent?.instance_id === instanceId ||
    (Array.isArray(agent?.instance_ids) && agent.instance_ids.includes(instanceId)) ||
    agent?.wa_instance_id === instanceId ||
    agent?.whatsapp_instance_id === instanceId;
}

export function agentLooksLikePedro(agent: any): boolean {
  const haystack = [
    agent?.name,
    agent?.agent_name,
    agent?.title,
    agent?.description,
    agent?.agent_type,
    agent?.type,
  ].filter(Boolean).join(" ").toLowerCase();

  return haystack.includes("pedro") ||
    haystack.includes("carvalho") ||
    haystack.includes("sdr") ||
    haystack.includes("pre-venda") ||
    haystack.includes("pré-venda");
}

// Mesma prioridade do pedro-webhook-v2: agente vinculado a esta instancia ->
// agente que "parece o Pedro" -> primeiro ativo.
export function selectActiveAgent(allAgents: any[], instanceId: string): any | null {
  const list = Array.isArray(allAgents) ? allAgents : [];

  // Se a instância estiver vinculada a um agente INATIVO, ignoramos para respeitar a desativação no painel
  const inactiveAgents = list.filter((a) => !a.is_active);
  if (inactiveAgents.some((a) => agentUsesInstance(a, instanceId))) {
    console.log(`[selectActiveAgent] Instância ${instanceId} vinculada a um agente inativo — ignorando roteamento`);
    return null;
  }

  const activeAgents = list.filter((a) => a.is_active);
  return activeAgents.find((a) => agentUsesInstance(a, instanceId)) ||
    activeAgents.find(agentLooksLikePedro) ||
    activeAgents[0] ||
    null;
}

