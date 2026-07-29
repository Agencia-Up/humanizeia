/**
 * Semântica editorial do Funil do Pedro v3.
 *
 * Este módulo não interpreta mensagens de leads e não roteia o runtime. Ele
 * atua somente durante a criação do prompt no portal, reconciliando texto
 * livre do cliente com capacidades que o produto realmente possui.
 */

const normalize = (value: string): string => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/^[\s\-*•>]+/, "")
  .replace(/\s+/g, " ")
  .trim();

const isNegatedAt = (normalized: string, index: number): boolean => {
  const before = normalized.slice(Math.max(0, index - 24), index);
  return /\b(?:nao|nunca|jamais|sem|nem|evite)\s+$/.test(before);
};

const hasNonNegatedMatch = (value: string, pattern: RegExp): boolean => {
  const normalized = normalize(value);
  const expression = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (const match of normalized.matchAll(expression)) {
    if (!isNegatedAt(normalized, match.index ?? 0)) return true;
  }
  return false;
};

/** Diretiva que transforma o funil adaptativo em checklist ou ordem fixa. */
export const isRigidFunnelSequencingDirective = (value: string): boolean => {
  const normalized = normalize(value);
  return [
    /\b(?:pular|pule|ignorar|ignore)\b.{0,30}\b(?:etapas?|funil)\b/,
    /\b(?:nao|nunca)\b.{0,12}\b(?:pular|pule|ignorar|ignore)\b.{0,30}\b(?:etapas?|funil)\b/,
    /\b(?:seguir|siga|cumprir|cumpra|respeitar|respeite)\b.{0,30}\b(?:etapas?|funil)\b.{0,45}\b(?:ordem|sequencia|sem excecao|rigid\w*)\b/,
    /\b(?:etapas?|funil)\b.{0,35}\b(?:ordem fixa|sequencia obrigatoria|obrigatoriamente)\b/,
  ].some((pattern) => pattern.test(normalized));
};

/**
 * Pedido para o próprio agente estimar ou informar o valor do veículo usado.
 * Encaminhar a um avaliador não entra nesta classe; estimar sem fonte entra.
 */
export const isUnsupportedVehicleValuationDirective = (value: string): boolean => {
  const normalized = normalize(value);
  const valuationObject = String.raw`(?:faixa\s+(?:de\s+)?(?:avaliacao|valor)|quanto\s+vale|(?:avaliacao|valor|preco)\s+(?:estimad[oa]\s+)?(?:d[oa]|para\s+[oa])\s+(?:carro|veiculo)(?:\s+(?:da|de)\s+troca)?|(?:avaliacao|valor|preco)\s+(?:da|de)\s+troca)`;
  const valuationAction = new RegExp(
    String.raw`\b(?:dar|passar|informar|fornecer|estimar|calcular|avaliar|definir|sugerir)\w*\b.{0,55}\b${valuationObject}\b`,
    "i",
  );
  const directAppraisal = /\b(?:estimar|calcular|avaliar)\w*\b.{0,45}\b(?:carro|veiculo)(?:\s+(?:da|de)\s+troca)?\b/i;

  return hasNonNegatedMatch(normalized, valuationAction)
    || hasNonNegatedMatch(normalized, directAppraisal);
};

/** Ação que afirma ou inicia uma aprovação que o Pedro v3 não executa. */
export const isUnsupportedFinancingApprovalDirective = (value: string): boolean => {
  const normalized = normalize(value);
  if (!/\b(?:aprovacao|aprovar|aprovad[oa]s?|pre[- ]?aprovacao)\b/.test(normalized)) return false;
  return hasNonNegatedMatch(
    normalized,
    /\b(?:avanc\w*|segu\w*|encaminh\w*|envi\w*|submet\w*|fac\w*|realiz\w*|solicit\w*|obtenh\w*|obter|garant\w*|confirm\w*|aprov\w*)\b.{0,55}\b(?:aprovacao|aprovar|aprovad[oa]s?|pre[- ]?aprovacao)\b|\b(?:financiamento|credito)\b.{0,30}\baprovad[oa]\b/i,
  );
};

/** Coleta imperativa de PII sem necessidade, escolha do lead ou explicação. */
export const isUnconditionalSensitiveDataDirective = (value: string): boolean => {
  const normalized = normalize(value);
  if (!/\b(?:cpf|data de nascimento|rg|documento de identidade)\b/.test(normalized)) return false;
  if (!hasNonNegatedMatch(normalized, /\b(?:colet\w*|peca|pedir|solicit\w*|obtenh\w*|obter|captur\w*)\b/i)) return false;
  return !/\b(?:somente se|apenas se|se (?:for|forem) necessar\w*|quando (?:for|forem) necessar\w*|se (?:a|o) (?:analise|etapa|lead)|explic\w*.{0,25}\bmotivo|com (?:uma )?explicacao)\b/.test(normalized);
};

/** Texto de horário que provavelmente confundiu a conjunção “e” com “é”. */
export const hasAmbiguousBusinessHours = (value: string): boolean =>
  /\bs[aá]bado\s+(?:é|eh)\s+feriados?\b/i.test(value);

export const normalizeBusinessHours = (value: string): string => value
  .replace(/\bs[aá]bado\s+(?:é|eh)\s+feriados?\b/gi, "Sábados e feriados")
  .replace(/\s+/g, " ")
  .trim();

const splitInstruction = (value: string): string[] => value
  .split(/\s*(?:[.;]\s+|\r?\n+)\s*/)
  .map((part) => part.trim())
  .filter(Boolean);

const uniqueInstructions = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const hasFinancialContext = (trigger: string, instructions: string[]): boolean =>
  /\b(?:financi\w*|credito|entrada|parcela)\b/.test(normalize(`${trigger} ${instructions.join(" ")}`));

/**
 * Reconciliador determinístico das ramificações livres do formulário.
 *
 * Ele preserva a intenção comercial, remove apenas ações impossíveis ou
 * rígidas e acrescenta uma alternativa executável. A LLM continua decidindo
 * se e quando usar a orientação na conversa real.
 */
export function reconcileBranchInstructions(trigger: string, rawInstructions: unknown): string[] {
  const source = Array.isArray(rawInstructions)
    ? rawInstructions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
  const result: string[] = [];
  let needsValuationHandoff = false;
  let needsApprovalHandoff = false;
  let needsSensitiveDataGuard = false;

  for (const instruction of source) {
    for (const part of splitInstruction(instruction)) {
      if (isRigidFunnelSequencingDirective(part)) continue;
      if (isUnsupportedVehicleValuationDirective(part)) {
        needsValuationHandoff = true;
        continue;
      }
      if (isUnsupportedFinancingApprovalDirective(part)) {
        needsApprovalHandoff = true;
        continue;
      }
      if (isUnconditionalSensitiveDataDirective(part)) {
        needsSensitiveDataGuard = true;
        continue;
      }
      result.push(part);
    }
  }

  if (needsSensitiveDataGuard) {
    result.push(hasFinancialContext(trigger, source)
      ? "Entenda a forma de pagamento, o valor de entrada e a faixa de parcela apenas quando forem relevantes e ainda faltarem. CPF ou data de nascimento só podem ser solicitados se uma análise escolhida pelo lead realmente exigir esses dados, com explicação do motivo e sem bloquear o atendimento."
      : "Solicite CPF ou data de nascimento somente se forem indispensáveis à etapa escolhida pelo lead, explicando o motivo e sem bloquear o atendimento.");
  }
  if (needsValuationHandoff) {
    result.push("Colete somente os dados relevantes do veículo para troca que ainda faltarem. Se o lead quiser uma avaliação, ofereça encaminhamento a um consultor ou avaliador e use handoff quando disponível; não estime nem afirme o valor do veículo.");
  }
  if (needsApprovalHandoff) {
    result.push("Se o lead quiser avançar, ofereça encaminhamento a um consultor para análise ou simulação e use handoff quando disponível; não afirme aprovação, condição ou parcela como confirmada.");
  }

  return uniqueInstructions(result);
}
