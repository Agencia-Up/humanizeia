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
export function selectActiveAgent(agents: any[], instanceId: string): any | null {
  const list = Array.isArray(agents) ? agents : [];
  return list.find((a) => agentUsesInstance(a, instanceId)) ||
    list.find(agentLooksLikePedro) ||
    list[0] ||
    null;
}
