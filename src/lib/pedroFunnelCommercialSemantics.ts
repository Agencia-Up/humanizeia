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
  return /\b(?:nao|nunca|jamais|sem|nem|evite)\s+(?:(?:deve|deveria|pode|poderia|precisa|vai)\s+)?$/.test(before);
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
    /\b(?:pul\w*|ignor\w*)\b.{0,30}\b(?:etapas?|funil)\b/,
    /\b(?:nao|nunca)\b.{0,12}\b(?:pul\w*|ignor\w*)\b.{0,30}\b(?:etapas?|funil)\b/,
    /\b(?:segu\w*|sig\w*|cumpr\w*|respeit\w*)\b.{0,30}\b(?:etapas?|funil)\b.{0,45}\b(?:ordem|sequencia|sem excecao|rigid\w*)\b/,
    /\b(?:segu\w*|sig\w*|cumpr\w*|respeit\w*)\b.{0,24}\b(?:o\s+)?funil(?:\s+de\s+vendas)?(?:\s+do\s+prompt)?\b/,
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

const UNSUPPORTED_STOCK_ATTRIBUTE = String.raw`(?:cor|cinza|pret[oa]|branc[oa]|prata|vermelh[oa]|azul|verde|amarel[oa]|marrom|bege|dourad[oa]|grafite|laranja|vinho|acabamento|teto\s+solar|opciona(?:l|is))`;
const INVENTORY_ABSENCE = String.raw`(?:nao\s+(?:tem|temos|ha|existe|existem|possui|possuimos)|indisponiv\w*|esgotad\w*)`;
// “falar” e “falhar” compartilham o prefixo "fal". O lookahead impede que
// uma orientação segura sobre falha de consulta seja lida como ordem para
// afirmar ausência de estoque.
const STOCK_ASSERTION_ACTION = String.raw`(?:diz\w*|dig\w*|fal(?!h)\w*|inform\w*|avis\w*|declar\w*|afirm\w*|respond\w*|consider\w*)`;

/**
 * Regra livre que manda concluir a ausência de uma característica que a busca
 * de estoque não consegue provar como ausente. O caso clássico é trocar a cor
 * pedida por outra e afirmar "não temos a cor X". Uma alternativa real pode
 * ser apresentada, mas não transforma falta de correspondência em prova
 * global de ausência.
 */
export const isUnsupportedStockAttributeAbsenceDirective = (value: string): boolean => {
  const normalized = normalize(value);
  if (!new RegExp(`\\b${UNSUPPORTED_STOCK_ATTRIBUTE}\\b`).test(normalized)) return false;
  if (!new RegExp(`\\b${INVENTORY_ABSENCE}\\b`).test(normalized)) return false;
  if (/\b(?:nao foi possivel confirmar|nao confirmad\w*|sem confirmacao|nao comprovad\w*|sem prova)\b/.test(normalized)) return false;
  if (/\bnao\s+(?:temos?\s+como|consegu\w*)\b.{0,35}\b(?:confirm\w*|verific\w*|inform\w*)\b/.test(normalized)) return false;
  return hasNonNegatedMatch(normalized, new RegExp(`\\b${STOCK_ASSERTION_ACTION}\\b`, "i"));
};

/**
 * Uma restrição da garantia da loja pode coexistir com garantia de fábrica,
 * mas frases como “qualquer outro item não tem garantia” apagam essa distinção
 * e transformam duas políticas compatíveis em uma contradição factual.
 */
export const isAmbiguousWarrantyCoverageDirective = (value: string): boolean => {
  const normalized = normalize(value);
  if (!/\bgaranti\w*\b/.test(normalized)) return false;
  if (/\bgarantia\s+(?:da|de)\s+loja\b/.test(normalized)) return false;
  const mentionsCoverage = /\b(?:motor|cambio|transmissao)\b/.test(normalized);
  const restrictsCoverage = /\b(?:nao\s+seja|somente|apenas|so)\b.{0,40}\b(?:motor|cambio|transmissao)\b/.test(normalized)
    || /\b(?:qualquer|todo)\s+outro\s+(?:item|componente)\b.{0,24}\bnao\s+tem\b.{0,12}\bgaranti\w*\b/.test(normalized);
  return mentionsCoverage && restrictsCoverage;
};

const normalizeWarrantyCoverageDirective = (value: string): string | null => {
  if (!isAmbiguousWarrantyCoverageDirective(value)) return null;
  const normalized = normalize(value);
  const covered: string[] = [];
  if (/\bmotor\b/.test(normalized)) covered.push("motor");
  if (/\b(?:cambio|transmissao)\b/.test(normalized)) covered.push("câmbio");
  if (covered.length === 0) return null;
  const coverage = covered.length === 1
    ? covered[0]
    : `${covered.slice(0, -1).join(", ")} e ${covered[covered.length - 1]}`;
  return `Não afirmar cobertura da garantia da loja além de ${coverage}.`;
};

/** Diretiva operacional duplicada que amarra o prompt a um provedor interno. */
export const isRedundantInventoryProviderDirective = (value: string): boolean => {
  const normalized = normalize(value);
  if (!/\b(?:bndv|revendamais)\b/.test(normalized)) return false;
  return /\b(?:consult\w*|busc\w*|chec\w*|verific\w*|confirm\w*)\b/.test(normalized);
};

/** Pedido de variar a abertura sem preservar a apresentação literal inicial. */
export const isUnscopedOpeningVariationDirective = (value: string): boolean => {
  const normalized = normalize(value);
  if (!/\b(?:vari\w*|altern\w*)\b.{0,28}\b(?:abertura|aberturas|saudacao|saudacoes)\b/.test(normalized)) return false;
  return !/\b(?:depois|apos|a partir)\b.{0,45}\b(?:primeir\w* contato|apresentacao|abertura literal)\b|\b(?:sem alterar|preserv\w*)\b.{0,35}\b(?:primeir\w* contato|apresentacao|abertura literal)\b/.test(normalized);
};

/** Repetição livre de uma obrigação já garantida pela abertura canônica. */
export const isRedundantFirstContactDirective = (value: string): boolean => {
  const normalized = normalize(value);
  return /\b(?:sempre|obrigatoriamente)\b.{0,24}\b(?:saud\w*|apresent\w*)\b.{0,30}\b(?:primeir\w* mensagem|primeir\w* contato|inicio do atendimento)\b|\b(?:primeir\w* mensagem|primeir\w* contato)\b.{0,30}\b(?:sempre|obrigatoriamente)\b.{0,20}\b(?:saud\w*|apresent\w*)\b/.test(normalized);
};

/** Instrução escrita como proibição dentro de um campo positivo (“Sempre”). */
export const isProhibitionDirective = (value: string): boolean =>
  /^(?:nunca|nao)\b/.test(normalize(value));

/** Critério absoluto sem uma definição objetiva do que seria obrigatório. */
export const isUndefinedRequiredDataQualificationCriterion = (value: string): boolean =>
  /\b(?:todos?|100%|totalidade)\b.{0,28}\b(?:dados?|informacoes?)\b.{0,18}\b(?:obrigatori\w*|necessari\w*|exigid\w*)\b|\b(?:dados?|informacoes?)\b.{0,18}\b(?:obrigatori\w*|necessari\w*|exigid\w*)\b.{0,28}\b(?:complet\w*|todos?|100%)\b/.test(normalize(value));

/** Julgamento financeiro subjetivo que não fornece limiar nem evidência. */
export const isSubjectiveFinancialQualificationCriterion = (value: string): boolean => {
  const normalized = normalize(value);
  if (!/\b(?:condicoes?|capacidade|perfil|situacao)\b.{0,24}\bfinanceir\w*\b/.test(normalized)) return false;
  if (!/\b(?:compativ\w*|adequad\w*|suficient\w*|ideal|apropriad\w*|boa)\b/.test(normalized)) return false;
  return !/\b(?:r\$|reais?|mil|entrada|minim\w*|maxim\w*|ate|acima|abaixo|parcela)\b.{0,18}\d|\d.{0,18}\b(?:r\$|reais?|mil|entrada|parcela)\b/.test(normalized);
};

/** Redação declarativa negativa dentro de um campo que já significa "Nunca". */
export const isAmbiguousNeverDirective = (value: string): boolean =>
  /^\s*nao\s+(?:fazemos|realizamos|oferecemos|aceitamos|trabalhamos\s+com|e\s+possivel)\b/.test(normalize(value));

const sentence = (value: string): string => {
  const cleaned = value.replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
  if (!cleaned) return "";
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}.`;
};

const prohibition = (value: string): string => {
  const action = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;]+$/, "")
    .replace(/^nunca\s+/i, "")
    .replace(/^n[aã]o\s+/i, "");
  const grammaticalAction = /^[A-ZÀ-Ý][a-zà-ÿ]*(?:ar|er|ir)\b/.test(action)
    ? `${action.charAt(0).toLocaleLowerCase("pt-BR")}${action.slice(1)}`
    : action;
  return grammaticalAction ? sentence(`Não ${grammaticalAction}`) : "";
};

/** Pequena revisão editorial por classe de intenção, sem ler mensagens de lead. */
export const normalizeConversationalInstruction = (value: string): string => {
  const normalized = normalize(value);
  if (/\brepetitiv\w*\b/.test(normalized) && /\b(?:mesm\w* coisas?|informacoes?|perguntas?)\b/.test(normalized)) {
    return "Repetir informações ou perguntas já respondidas.";
  }
  if (/\bfing\w*\b.{0,28}\b(?:entend\w*|sab\w*)\b/.test(normalized) || (/\bfing\w*\b/.test(normalized) && /\baleatori\w*\b/.test(normalized))) {
    return "Fingir que entendeu ou responder algo sem relação com o que o lead disse.";
  }
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}` : "";
};

export function normalizeNeverInstructions(rawInstructions: unknown): string[] {
  const source = Array.isArray(rawInstructions)
    ? rawInstructions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return uniqueInstructions(source.map((value) => {
    const cleaned = value.replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
    const warrantyCoverage = normalizeWarrantyCoverageDirective(cleaned);
    if (warrantyCoverage) return warrantyCoverage;
    const explicitNever = cleaned.match(/^nunca\s+(.+)$/i);
    if (explicitNever) return prohibition(explicitNever[1]);
    const noServices = cleaned.match(/^n[aã]o\s+(?:fazemos|realizamos|oferecemos|aceitamos)\s+(.+)$/i);
    if (noServices) return sentence(`Não afirmar nem oferecer ${noServices[1]} como prática da empresa`);
    const notPossible = cleaned.match(/^n[aã]o\s+[ée]\s+poss[ií]vel\s+(.+)$/i);
    if (notPossible) return sentence(`Não afirmar que é possível ${notPossible[1]}`);
    const doNotWorkWith = cleaned.match(/^n[aã]o\s+trabalhamos\s+com\s+(.+)$/i);
    if (doNotWorkWith) return sentence(`Não oferecer nem afirmar disponibilidade de ${doNotWorkWith[1]}`);
    const doNotInfinitive = cleaned.match(/^n[aã]o\s+([A-Za-zÀ-ÿ]+(?:ar|er|ir)\b.*)$/i);
    if (doNotInfinitive) return prohibition(doNotInfinitive[1]);
    return prohibition(normalizeConversationalInstruction(value));
  }));
}

export function reconcileQualificationCriteria(rawCriteria: unknown, preferredData: unknown): string[] {
  const source = Array.isArray(rawCriteria)
    ? rawCriteria.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const hasPreferredData = Array.isArray(preferredData)
    && preferredData.some((item) => typeof item === "string" && item.trim().length > 0);
  const result: string[] = [];
  let needsSufficientContextCriterion = false;

  for (const criterion of source) {
    if (isSubjectiveFinancialQualificationCriterion(criterion)) continue;
    if (isUndefinedRequiredDataQualificationCriterion(criterion)) {
      needsSufficientContextCriterion = needsSufficientContextCriterion || hasPreferredData;
      continue;
    }
    result.push(normalizeConversationalInstruction(criterion));
  }
  if (needsSufficientContextCriterion) {
    result.push("Há informação suficiente para o próximo passo desejado pelo lead; dados preferenciais ainda ausentes não bloqueiam um pedido explícito de atendimento humano.");
  }
  return uniqueInstructions(result);
}

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
  let needsTransparentAttributeAlternative = false;
  let needsScopedOpeningVariation = false;

  for (const instruction of source) {
    if (isUnsupportedStockAttributeAbsenceDirective(instruction)) {
      needsTransparentAttributeAlternative = true;
      continue;
    }
    if (isRedundantInventoryProviderDirective(instruction)) continue;
    if (isRedundantFirstContactDirective(instruction)) continue;
    if (isUnscopedOpeningVariationDirective(instruction)) {
      needsScopedOpeningVariation = true;
      continue;
    }
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
      result.push(normalizeConversationalInstruction(part));
    }
  }

  if (needsSensitiveDataGuard) {
    result.push(hasFinancialContext(trigger, source)
      ? "Entenda a forma de pagamento, o valor de entrada e a faixa de parcela apenas quando forem relevantes e ainda faltarem, solicitando CPF ou data de nascimento somente se uma análise escolhida pelo lead realmente exigir esses dados, com explicação do motivo e sem bloquear o atendimento."
      : "Solicite CPF ou data de nascimento somente se forem indispensáveis à etapa escolhida pelo lead, explicando o motivo e sem bloquear o atendimento.");
  }
  if (needsValuationHandoff) {
    result.push("Colete somente os dados relevantes do veículo para troca que ainda faltarem e, se o lead quiser uma avaliação, ofereça encaminhamento a um consultor ou avaliador usando handoff quando disponível, sem estimar nem afirmar o valor do veículo.");
  }
  if (needsApprovalHandoff) {
    result.push("Se o lead quiser avançar, ofereça encaminhamento a um consultor para análise ou simulação usando handoff quando disponível, sem afirmar aprovação, condição ou parcela como confirmada.");
  }
  if (needsTransparentAttributeAlternative) {
    result.push("Quando uma característica pedida não tiver sido confirmada na consulta, apresente apenas veículos reais retornados como alternativas transparentes e informe que a característica não foi confirmada no resultado atual, sem afirmar ausência global sem prova factual suficiente.");
  }
  if (needsScopedOpeningVariation) {
    result.push("Depois da apresentação literal do primeiro contato, varie a redação das mensagens seguintes sem repetir fórmulas.");
  }

  return uniqueInstructions(result);
}
