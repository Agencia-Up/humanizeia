// =============================================================================
// GUARDRAILS DE SAÍDA — IT-4.2 (confiabilidade do Pedro SDR)
// =============================================================================
//
// Filtra a resposta do LLM ANTES de enviar pro cliente, bloqueando:
//   1. PROMESSA DE PREÇO sem ter o veículo apresentado (ou sem BNDV)
//   2. PROMESSA DE ENTREGA / FRETE / GARANTIA fora do escopo do agente
//   3. INVENÇÃO de dados (KM, ano específico, número de portas) sem fonte
//   4. SAÍDA DO ESCOPO (assunto não-veicular, opinião sobre concorrente
//      específico, tópicos sensíveis: política, religião)
//
// COMPORTAMENTO:
//   - Cada guardrail é uma função `(text, state) => Violation | null`
//   - `applyGuardrails(text, state, opts)` retorna `{ blocked, violations,
//     safeFallback }`
//   - Se `blocked=true`, caller substitui o texto pelo `safeFallback`
//     (pergunta de redirecionamento educada)
//
// USO (fonte canônica testável):
//   ```ts
//   import { applyGuardrails, SAFE_FALLBACK } from './guardrails';
//
//   const result = applyGuardrails(aiResponse, conversationState);
//   if (result.blocked) {
//     finalText = result.safeFallback;
//     console.warn('[Guardrails] violation:', result.violations);
//   }
//   ```
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá.
// =============================================================================

export type GuardrailViolation = {
  rule: string;
  reason: string;
  matched_text: string;
};

export type GuardrailResult = {
  blocked: boolean;
  violations: GuardrailViolation[];
  safeFallback: string;
};

/** Mensagem de redirecionamento usada quando guardrail bloqueia a saída. */
export const SAFE_FALLBACK =
  "Deixa eu confirmar essa info antes pra te passar certinho. Pode me dizer qual modelo te interessou?";

// ─── Patterns de detecção ───────────────────────────────────────────────────

// 1. Promessa de preço sem ter veículo apresentado/BNDV
// Match: "R$ X", "X mil", "X reais" — números monetários
const PRICE_PATTERN = /\b(r\$\s*[\d.,]+|\d+\s*mil\s*reais?|\d+\s*mil\b)/i;

// 2. Promessa de entrega/frete
// Acentos não funcionam bem com \b em JS regex — usamos limites permissivos.
const DELIVERY_PROMISE_PATTERNS = [
  /\bfa[çc]o\s+a?\s*entrega/i,
  /\bentrego\s+(em|na)\b/i,
  /\bfrete\s+(?:[eé]\s+)?(gr[áa]tis|gratuito|inclu[íi]do|por\s+nossa)/i,
  /\bgarantia\s+de\s+\d+\s+(anos?|meses?)/i,
  /\bdou\s+\d+\s+(anos?|meses?)\s+de\s+garantia/i,
];

// 3. Invenção de dados sem fonte (KM/ano específico sem BNDV apresentado)
const SPECIFIC_KM_PATTERN = /\b(\d{1,3}\.\d{3}|\d{4,6})\s*(km|quilômetros?)\b/i;
const SPECIFIC_YEAR_PATTERN = /\b20[12]\d\b/; // anos 2010-2029

// 4. Saída de escopo (tópicos sensíveis)
const OUT_OF_SCOPE_PATTERNS = [
  // Política / religião / opinião pessoal
  { rule: "politica", regex: /\b(lula|bolsonaro|pt|psl|stf|governo\s+atual)\b/i },
  { rule: "religiao", regex: /\bdeus\s+(te\s+)?aben[çc]o|\bigreja\b|\borar?\s+por\b/i },
  // Depreciar concorrente específico
  {
    rule: "depreciacao_concorrente",
    regex: /\beles\s+(s[ãa]o|cobram|enganam)|outra\s+loja\s+[ée]\s+(ruim|pior|mais\s+cara)/i,
  },
];

// ─── Funções de check ───────────────────────────────────────────────────────

/**
 * Promessa de preço sem ter veículo apresentado.
 * Se o state já tem `veiculo_apresentado.ja_apresentado=true`, agente
 * pode citar o preço dele. Senão, qualquer R$/mil é suspeito.
 */
function checkUngroundedPrice(
  text: string,
  state: any
): GuardrailViolation | null {
  if (state?.veiculo_apresentado?.ja_apresentado) return null; // OK citar
  const match = text.match(PRICE_PATTERN);
  if (match) {
    return {
      rule: "preco_sem_veiculo",
      reason:
        "Agente citou preço sem ter veículo apresentado/consultado no BNDV.",
      matched_text: match[0],
    };
  }
  return null;
}

/**
 * Promessa de entrega/frete/garantia fora do escopo do agente.
 * Essas decisões são do vendedor humano, agente NÃO pode prometer.
 */
function checkDeliveryPromise(text: string): GuardrailViolation | null {
  for (const pattern of DELIVERY_PROMISE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return {
        rule: "promessa_indevida",
        reason:
          "Agente prometeu entrega/frete/garantia — decisão do vendedor humano.",
        matched_text: match[0],
      };
    }
  }
  return null;
}

/**
 * Invenção de KM/ano específico quando não há veículo apresentado nem
 * BNDV no contexto (state.veiculo_apresentado vazio).
 */
function checkInventedSpecs(
  text: string,
  state: any
): GuardrailViolation | null {
  if (state?.veiculo_apresentado?.ja_apresentado) return null; // OK
  const kmMatch = text.match(SPECIFIC_KM_PATTERN);
  if (kmMatch) {
    return {
      rule: "km_inventado",
      reason: "Agente citou KM específico sem veículo apresentado.",
      matched_text: kmMatch[0],
    };
  }
  // Ano específico SEM contexto — mais permissivo (cliente pode ter perguntado)
  // Só bloqueia se o texto não TEM uma pergunta (heurística: texto sem '?')
  const yearMatch = text.match(SPECIFIC_YEAR_PATTERN);
  if (yearMatch && !text.includes("?") && text.length > 50) {
    return {
      rule: "ano_inventado",
      reason: "Agente afirmou ano específico sem veículo apresentado.",
      matched_text: yearMatch[0],
    };
  }
  return null;
}

/**
 * Saída do escopo: política, religião, depreciação de concorrente.
 */
function checkOutOfScope(text: string): GuardrailViolation | null {
  for (const { rule, regex } of OUT_OF_SCOPE_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      return {
        rule,
        reason: "Agente saiu do escopo (vendas automotivas).",
        matched_text: match[0],
      };
    }
  }
  return null;
}

/**
 * Aplica todos os guardrails. Retorna estrutura com `blocked` + lista de
 * `violations` + `safeFallback` (texto a usar quando blocked).
 *
 * Caller decide o que fazer: substituir, logar e enviar mesmo, etc.
 */
export function applyGuardrails(
  text: string,
  state: any,
  opts?: { skipPriceCheck?: boolean; skipDeliveryCheck?: boolean }
): GuardrailResult {
  if (!text || typeof text !== "string") {
    return { blocked: false, violations: [], safeFallback: SAFE_FALLBACK };
  }

  const violations: GuardrailViolation[] = [];

  if (!opts?.skipPriceCheck) {
    const v = checkUngroundedPrice(text, state);
    if (v) violations.push(v);
  }
  if (!opts?.skipDeliveryCheck) {
    const v = checkDeliveryPromise(text);
    if (v) violations.push(v);
  }
  const invented = checkInventedSpecs(text, state);
  if (invented) violations.push(invented);
  const scope = checkOutOfScope(text);
  if (scope) violations.push(scope);

  return {
    blocked: violations.length > 0,
    violations,
    safeFallback: SAFE_FALLBACK,
  };
}
