/**
 * Contrato de políticas comerciais do tenant.
 *
 * A política descreve uma decisão de negócio que a LLM deve interpretar no
 * contexto da conversa. Ela não é um roteador da engine: o runtime exige que
 * a LLM declare a política aplicada e apresente evidência grounded antes de
 * executar qualquer efeito.
 */

export const TENANT_POLICY_SCHEMA_VERSION = "v1" as const;

export const TENANT_POLICY_DOMAINS = [
  "financial",
  "service_area",
  "qualification",
  "handoff",
  "disqualification",
  "followup",
  "business",
] as const;

export type TenantPolicyDomain = (typeof TENANT_POLICY_DOMAINS)[number];

export const TENANT_POLICY_ACTIONS = [
  "continue",
  "ask_clarification",
  "inform",
  "disqualify",
  "handoff",
] as const;

export type TenantPolicyAction = (typeof TENANT_POLICY_ACTIONS)[number];

/**
 * Declaração produzida pela LLM no understanding do turno.
 * Isto explica qual política configurada foi considerada; não é um comando
 * para a engine e não escolhe intenção, resposta ou efeito.
 */
export interface TenantPolicyDecision {
  policyId: string;
  action: TenantPolicyAction;
  evidence: string;
}

export interface TenantPolicyDecisionIssue {
  code:
    | "invalid_shape"
    | "unknown_policy"
    | "disabled_policy"
    | "action_mismatch"
    | "missing_evidence"
    | "evidence_not_in_current_block";
  message: string;
}

export interface TenantFunnelPolicy {
  id: string;
  enabled: boolean;
  name: string;
  domain: TenantPolicyDomain;
  /** Condição descrita pelo cliente em linguagem natural. */
  when: string;
  action: TenantPolicyAction;
  /** O que a LLM deve fazer na conversa quando a política for aplicável. */
  responseGuidance: string;
  /** Qual evidência precisa existir para a LLM declarar a política. */
  evidenceRequirement: string;
  /** Menor número = maior precedência entre políticas do mesmo domínio. */
  priority: number;
}

export interface TenantPolicyIssue {
  severity: "error" | "warning";
  code:
    | "invalid_shape"
    | "missing_id"
    | "duplicate_id"
    | "missing_name"
    | "invalid_domain"
    | "missing_condition"
    | "invalid_action"
    | "missing_guidance"
    | "missing_evidence"
    | "invalid_priority"
    | "same_scope_conflict";
  policyId?: string;
  message: string;
}

export interface TenantFunnelConfigIssue {
  severity: "error" | "warning";
  code:
    | "invalid_shape"
    | "missing_identity"
    | "missing_presentation"
    | "missing_company"
    | "invalid_list"
    | "empty_branch"
    | "duplicate_question"
    | "always_never_conflict"
    | "qualified_disqualified_overlap";
  path?: string;
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cleanText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const slug = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

const normalizedComparableText = (value: unknown): string =>
  cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();

const listValues = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];

/**
 * Valida a coerência estrutural do Funil antes de ele virar system_prompt.
 *
 * Esta função não tenta interpretar a conversa, escolher uma intenção ou
 * decidir uma transferência. Ela só impede que a configuração do cliente
 * publique um prompt internamente impossível ou que incentive formulário,
 * repetição e instruções conflitantes.
 */
export function validateTenantFunnelConfig(input: unknown): TenantFunnelConfigIssue[] {
  if (!isRecord(input)) {
    return [{ severity: "error", code: "invalid_shape", message: "A configuração do Funil precisa ser um objeto." }];
  }

  const issues: TenantFunnelConfigIssue[] = [];
  const section = (key: string): Record<string, unknown> => {
    const value = input[key];
    if (!isRecord(value)) {
      issues.push({ severity: "error", code: "invalid_shape", path: key, message: `${key} precisa ser um objeto.` });
      return {};
    }
    return value;
  };
  const b1 = section("bloco1_identidade");
  const b3 = section("bloco3_abordagem");
  const b4 = section("bloco4_qualificacao");
  const b5 = section("bloco5_ramificacoes");
  const b6 = section("bloco6_criterios");
  const b7 = section("bloco7_transferencia");
  const b8 = section("bloco8_regras");
  const b9 = section("bloco9_empresa");

  if (!cleanText(b1.agent_name)) issues.push({ severity: "error", code: "missing_identity", path: "bloco1_identidade.agent_name", message: "Informe o nome do agente antes de gerar o prompt." });
  if (!cleanText(b1.company)) issues.push({ severity: "error", code: "missing_company", path: "bloco1_identidade.company", message: "Informe a empresa no bloco de identidade antes de gerar o prompt." });
  if (!cleanText(b3.presentation)) issues.push({ severity: "error", code: "missing_presentation", path: "bloco3_abordagem.presentation", message: "Defina a apresentação da primeira mensagem antes de gerar o prompt." });
  if (!cleanText(b9.name)) issues.push({ severity: "error", code: "missing_company", path: "bloco9_empresa.name", message: "Informe o nome da empresa no bloco de informações da empresa." });

  const arrayFields: Array<[string, Record<string, unknown>, string]> = [
    ["bloco3_abordagem.avoid", b3, "avoid"],
    ["bloco4_qualificacao.questions", b4, "questions"],
    ["bloco4_qualificacao.required_data", b4, "required_data"],
    ["bloco4_qualificacao.transfer_now_rules", b4, "transfer_now_rules"],
    ["bloco6_criterios.qualified_when", b6, "qualified_when"],
    ["bloco6_criterios.disqualified_when", b6, "disqualified_when"],
    ["bloco7_transferencia.required_data", b7, "required_data"],
    ["bloco8_regras.always", b8, "always"],
    ["bloco8_regras.never", b8, "never"],
  ];
  for (const [path, owner, key] of arrayFields) {
    if (owner[key] !== undefined && !Array.isArray(owner[key])) {
      issues.push({ severity: "error", code: "invalid_list", path, message: `${path} precisa ser uma lista de textos.` });
    }
  }

  const always = new Set(listValues(b8.always).map(normalizedComparableText));
  for (const item of listValues(b8.never)) {
    if (always.has(normalizedComparableText(item))) {
      issues.push({ severity: "error", code: "always_never_conflict", path: "bloco8_regras", message: `A mesma orientação aparece em Sempre e Nunca: "${item}".` });
    }
  }

  const preferredQuestions = [
    cleanText(b3.first_question),
    ...listValues(b4.questions),
    ...listValues(b7.required_data),
  ].filter(Boolean);
  const seenQuestions = new Set<string>();
  for (const question of preferredQuestions) {
    const comparable = normalizedComparableText(question);
    if (seenQuestions.has(comparable)) {
      issues.push({ severity: "warning", code: "duplicate_question", path: "bloco3/bloco4/bloco7", message: `A pergunta ou dado aparece repetido no Funil: "${question}". A LLM deve usar cada item no máximo quando ainda fizer sentido.` });
    }
    seenQuestions.add(comparable);
  }

  const qualified = new Set(listValues(b6.qualified_when).map(normalizedComparableText));
  for (const item of listValues(b6.disqualified_when)) {
    if (qualified.has(normalizedComparableText(item))) {
      issues.push({ severity: "warning", code: "qualified_disqualified_overlap", path: "bloco6_criterios", message: `O mesmo critério aparece como qualificado e desqualificado: "${item}". Revise o sentido antes de publicar.` });
    }
  }

  if (b5.branches !== undefined && !Array.isArray(b5.branches)) {
    issues.push({ severity: "error", code: "invalid_list", path: "bloco5_ramificacoes.branches", message: "As ramificações precisam ser uma lista." });
  } else if (Array.isArray(b5.branches)) {
    b5.branches.forEach((branch, index) => {
      if (!isRecord(branch) || !cleanText(branch.trigger) || listValues(branch.questions).length === 0) {
        issues.push({ severity: "error", code: "empty_branch", path: `bloco5_ramificacoes.branches[${index}]`, message: `A ramificação ${index + 1} precisa ter gatilho e pelo menos uma orientação.` });
      }
    });
  }

  return issues;
}

export function normalizeTenantPolicies(input: unknown): TenantFunnelPolicy[] {
  if (!Array.isArray(input)) return [];

  return input.map((raw, index) => {
    const item = isRecord(raw) ? raw : {};
    const name = cleanText(item.name) || `Política ${index + 1}`;
    const domain = TENANT_POLICY_DOMAINS.includes(item.domain as TenantPolicyDomain)
      ? (item.domain as TenantPolicyDomain)
      : "qualification";
    const action = TENANT_POLICY_ACTIONS.includes(item.action as TenantPolicyAction)
      ? (item.action as TenantPolicyAction)
      : "ask_clarification";
    const priority = Number.isFinite(Number(item.priority))
      ? Math.max(1, Math.min(99, Number(item.priority)))
      : 50;

    return {
      id: cleanText(item.id) || `policy_${slug(name) || index + 1}`,
      enabled: item.enabled !== false,
      name,
      domain,
      when: cleanText(item.when),
      action,
      responseGuidance: cleanText(item.responseGuidance),
      evidenceRequirement: cleanText(item.evidenceRequirement),
      priority,
    };
  });
}

export function validateTenantPolicies(input: unknown): TenantPolicyIssue[] {
  if (!Array.isArray(input)) {
    return [{ severity: "error", code: "invalid_shape", message: "As políticas comerciais devem ser uma lista." }];
  }

  const issues: TenantPolicyIssue[] = [];
  const rawPolicies = input as unknown[];
  const policies = normalizeTenantPolicies(input);
  const ids = new Map<string, TenantFunnelPolicy>();

  rawPolicies.forEach((raw, index) => {
    const item = isRecord(raw) ? raw : {};
    const rawId = cleanText(item.id);
    const rawName = cleanText(item.name);
    const rawDomain = cleanText(item.domain);
    const rawAction = cleanText(item.action);
    const rawPriority = item.priority;
    const policy = policies[index];
    const policyId = rawId || policy.id;

    if (!isRecord(raw)) issues.push({ severity: "error", code: "invalid_shape", policyId, message: `A política ${index + 1} precisa ser um objeto.` });
    if (!rawId) issues.push({ severity: "error", code: "missing_id", policyId, message: "Toda política precisa de um identificador." });
    if (ids.has(policy.id)) issues.push({ severity: "error", code: "duplicate_id", policyId: policy.id, message: `A política ${policy.id} está duplicada.` });
    ids.set(policy.id, policy);
    if (!rawName) issues.push({ severity: "error", code: "missing_name", policyId: policy.id, message: "A política precisa de um nome." });
    if (!TENANT_POLICY_DOMAINS.includes(rawDomain as TenantPolicyDomain)) issues.push({ severity: "error", code: "invalid_domain", policyId: policy.id, message: `Domínio inválido na política ${policy.id}.` });
    if (!cleanText(item.when)) issues.push({ severity: "error", code: "missing_condition", policyId: policy.id, message: `A política ${policy.id} precisa explicar quando se aplica.` });
    if (!TENANT_POLICY_ACTIONS.includes(rawAction as TenantPolicyAction)) issues.push({ severity: "error", code: "invalid_action", policyId: policy.id, message: `A política ${policy.id} possui uma ação inválida.` });
    if (!cleanText(policy.responseGuidance)) issues.push({ severity: "error", code: "missing_guidance", policyId: policy.id, message: `A política ${policy.id} precisa orientar a resposta da LLM.` });
    if (!cleanText(policy.evidenceRequirement)) issues.push({ severity: "error", code: "missing_evidence", policyId: policy.id, message: `A política ${policy.id} precisa definir sua evidência.` });
    if (!Number.isInteger(Number(rawPriority)) || Number(rawPriority) < 1 || Number(rawPriority) > 99) issues.push({ severity: "error", code: "invalid_priority", policyId: policy.id, message: `A prioridade da política ${policy.id} deve estar entre 1 e 99.` });
  });

  const byScope = new Map<string, TenantFunnelPolicy[]>();
  for (const policy of policies.filter((item) => item.enabled)) {
    const key = `${policy.domain}:${policy.priority}`;
    byScope.set(key, [...(byScope.get(key) ?? []), policy]);
  }
  for (const [scope, sameScope] of byScope) {
    const actions = new Set(sameScope.map((policy) => policy.action));
    if (sameScope.length > 1 && actions.has("disqualify") && (actions.has("continue") || actions.has("handoff"))) {
      issues.push({ severity: "warning", code: "same_scope_conflict", message: `Políticas ativas em ${scope} possuem ações potencialmente conflitantes. Defina prioridades diferentes ou revise as condições.` });
    }
  }

  return issues;
}

/**
 * Valida uma declaração da LLM sem decidir se a política deveria aplicar-se.
 * A engine só pode rejeitar uma declaração impossível ou sem proveniência;
 * ela não procura palavras no bloco nem escolhe outra política.
 */
export function validateTenantPolicyDecision(
  decision: unknown,
  currentBlock: string,
  configuredPolicies: unknown,
): TenantPolicyDecisionIssue[] {
  if (decision == null) return [];
  if (!isRecord(decision)) {
    return [{ code: "invalid_shape", message: "A decisão de política da LLM precisa ser um objeto ou null." }];
  }

  const policyId = cleanText(decision.policyId);
  const action = cleanText(decision.action);
  const evidence = cleanText(decision.evidence);
  const policies = normalizeTenantPolicies(configuredPolicies);
  const policy = policies.find((item) => item.id === policyId);
  const issues: TenantPolicyDecisionIssue[] = [];

  if (!policy) issues.push({ code: "unknown_policy", message: `A política declarada (${policyId || "sem id"}) não está configurada.` });
  else if (!policy.enabled) issues.push({ code: "disabled_policy", message: `A política declarada (${policyId}) está desativada.` });

  if (!TENANT_POLICY_ACTIONS.includes(action as TenantPolicyAction)) {
    issues.push({ code: "action_mismatch", message: "A ação declarada não pertence ao contrato de políticas." });
  } else if (policy && policy.action !== action) {
    issues.push({ code: "action_mismatch", message: `A ação declarada para ${policyId} não coincide com a configuração da política.` });
  }

  if (!evidence) issues.push({ code: "missing_evidence", message: `A política ${policyId || "declarada"} não trouxe evidência.` });
  else if (!currentBlock.trim().toLocaleLowerCase().includes(evidence.toLocaleLowerCase())) {
    issues.push({ code: "evidence_not_in_current_block", message: "A evidência da política não aparece literalmente no bloco atual." });
  }

  return issues;
}

export function buildTenantPolicyPromptSection(input: unknown): string {
  const policies = normalizeTenantPolicies(input).filter((policy) => policy.enabled);
  if (policies.length === 0) return "";
  const ordered = [...policies].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const lines = ordered.map((policy) => [
    `- [${policy.id}] ${policy.name} (área: ${tenantPolicyDomainLabel(policy.domain)}, prioridade: ${policy.priority})`,
    `  Quando: ${policy.when}`,
    `  Ação esperada: ${tenantPolicyActionLabel(policy.action)}`,
    `  Evidência necessária: ${policy.evidenceRequirement}`,
    `  Orientação de resposta: ${policy.responseGuidance}`,
  ].join("\n")).join("\n\n");

  return `# POLÍTICAS COMERCIAIS DA EMPRESA (CONFIGURADAS PELO CLIENTE)

Estas políticas descrevem preferências comerciais da empresa. Você, a LLM, deve interpretá-las junto com o bloco atual e o histórico real. A engine não escolhe a política nem aplica a condição por palavras-chave.

- Não aplique uma política apenas porque uma palavra apareceu; compreenda o sentido da fala.
- A mensagem atual do lead vence uma intenção antiga, e fatos explícitos vencem inferências.
- Quando uma política se aplicar, declare o seu id, a decisão e a evidência literal ou fato grounded que sustentam a decisão.
- Se a condição estiver ambígua, faça uma pergunta curta de esclarecimento antes de desqualificar ou transferir.
- Não confunda entrada, parcela, financiamento, consórcio, troca, orçamento, veículo procurado e localização.
- A orientação de resposta define a condução comercial; efeitos como CRM, transferência e follow-up só podem ser executados quando declarados no contrato operacional e validados pela engine.

${lines}`;
}
/** Rótulos em português; os valores do contrato continuam sendo códigos internos. */
export const TENANT_POLICY_DOMAIN_LABELS: Record<TenantPolicyDomain, string> = {
  financial: "Financeiro",
  service_area: "\u00C1rea de atendimento",
  qualification: "Qualifica\u00E7\u00E3o",
  handoff: "Transfer\u00EAncia",
  disqualification: "Desqualifica\u00E7\u00E3o",
  followup: "Follow-up",
  business: "Informa\u00E7\u00F5es da empresa",
};

export const TENANT_POLICY_ACTION_LABELS: Record<TenantPolicyAction, string> = {
  continue: "Continuar atendimento",
  ask_clarification: "Pedir esclarecimento",
  inform: "Informar o cliente",
  disqualify: "Desqualificar lead",
  handoff: "Transferir para vendedor",
};

export const tenantPolicyDomainLabel = (domain: TenantPolicyDomain): string =>
  TENANT_POLICY_DOMAIN_LABELS[domain] ?? domain;

export const tenantPolicyActionLabel = (action: TenantPolicyAction): string =>
  TENANT_POLICY_ACTION_LABELS[action] ?? action;
