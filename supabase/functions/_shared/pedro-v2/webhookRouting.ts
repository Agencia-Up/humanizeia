// ── Helpers de roteamento compartilhados entre os webhooks de inbound ─────────
// Usado por pedro-webhook-v2 (UAZAPI) e meta-webhook (Cloud API do Meta) pra
// escolher QUAL agente da conta atende a instancia. Mantido aqui (fonte unica)
// pra os dois webhooks nao divergirem.

export function agentInstanceIds(agent: any): string[] {
  const values = [
    agent?.instance_id,
    ...(Array.isArray(agent?.instance_ids) ? agent.instance_ids : []),
    agent?.wa_instance_id,
    agent?.whatsapp_instance_id,
  ];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}

export function agentUsesInstance(agent: any, instanceId: string): boolean {
  return agentInstanceIds(agent).includes(instanceId);
}

export function shouldNamespaceConversationByInstance(agent: any, instanceId: string): boolean {
  const configured = agentInstanceIds(agent);
  if (configured.length <= 1) return false;

  // `instance_id` era a unica origem usada pelo v3 antes do suporte multiplo.
  // Manter essa instancia no namespace historico evita partir conversas em
  // andamento quando um segundo numero e adicionado. As instancias adicionais
  // recebem namespace proprio. Sem primaria legada nao ha origem segura para
  // adivinhar, portanto todas as instancias ficam isoladas.
  const legacyPrimary = typeof agent?.instance_id === "string" && agent.instance_id.trim()
    ? agent.instance_id.trim()
    : null;
  return legacyPrimary == null || legacyPrimary !== instanceId;
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
  const exact = activeAgents.find((a) => agentUsesInstance(a, instanceId));
  if (exact) return exact;

  // Se a conta ja usa vinculos explicitos, nunca envie uma instancia desconhecida
  // ao "primeiro agente ativo". O fallback antigo fica apenas para tenants 100%
  // legados, ainda sem qualquer binding configurado.
  if (list.some((agent) => agentInstanceIds(agent).length > 0)) return null;
  return activeAgents.find(agentLooksLikePedro) || activeAgents[0] || null;
}

