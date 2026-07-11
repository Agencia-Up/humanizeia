// ============================================================================
// sensitive-data.ts — MISSÃO PII (2026-07-11). Classificação TIPADA de dados
// sensíveis (CPF e data de nascimento) por FORMATO + PLAUSIBILIDADE — nunca
// frase do incidente. Módulo PURO (zero IO), fonte única para:
//
//  - INGEST (pilot-ingest): sanitiza o texto ANTES de persistir no v3_inbox.
//    Causa-raiz provada no banco: `v3_inbox_redacted_ck` (v3_payload_is_redacted)
//    REJEITA qualquer run de 11 dígitos em formato CPF -> o INSERT falhava ->
//    ingested=false -> sticky bloqueava o v2 -> a mensagem do lead SUMIA sem
//    resposta. A sanitização torna a mensagem STORÁVEL e tipada.
//  - EXTRAÇÃO (lead-extraction): spans sensíveis/data são RESERVADOS — nunca
//    chegam ao parser de dinheiro/km/ano (precedência lexical:
//    sensível/data > km/ano > dinheiro). `01/10/1997` jamais vira parcela.
//  - PRIVACIDADE por construcao: o valor integral existe apenas em memoria
//    durante o ingest e e cifrado no cofre AES-GCM. State/WM/eventos/outbox/log
//    recebem somente uma referencia opaca e os quatro ultimos digitos do CPF.
//    Falha do cofre produz token explicito de NAO ARMAZENADO; nunca confirmacao falsa.
// ============================================================================

export type SensitiveFinding =
  | { readonly kind: "cpf"; readonly valid: boolean; readonly last4: string; readonly placeholder: string }
  | { readonly kind: "birth_date"; readonly valid: boolean; readonly placeholder: string }
  | { readonly kind: "numeric_11"; readonly valid: true; readonly last4: string; readonly placeholder: string };

export type SensitiveSecretCandidate = {
  readonly kind: "cpf" | "birth_date";
  readonly value: string;
  readonly last4: string | null;
  readonly placeholder: string;
};

export type SensitiveExtraction = {
  readonly sanitized: string;          // texto com os spans substituídos por tokens tipados (sem dígitos sensíveis)
  readonly findings: readonly SensitiveFinding[];
  // Somente em memoria, entre a borda HTTP e o cofre. Nunca persista/logue este campo.
  readonly secrets: readonly SensitiveSecretCandidate[];
};

// Tokens tipados que substituem os spans no texto (o cérebro/extrator leem o TIPO,
// nunca o valor). Formatos estáveis — os consumidores usam os *_TOKEN_RX abaixo.
export const CPF_VALID_TOKEN_RX = /\[CPF_VALIDO_REF_([a-f0-9]{32,64})_FINAL_(\d{4})\]/;
export const CPF_INVALID_TOKEN_RX = /\[CPF_INVALIDO_FINAL_(\d{4})\]/;
export const GENERIC_11_TOKEN_RX = /\[NUMERO_11_DIGITOS_FINAL_(\d{4})\]/;
export const BIRTH_DATE_VALID_TOKEN_RX = /\[DATA_NASCIMENTO_VALIDA_REF_([a-f0-9]{32,64})\]/;
export const BIRTH_DATE_INVALID_TOKEN_RX = /\[DATA_INVALIDA\]/;

export const CPF_UNSTORED_TOKEN = "[CPF_RECEBIDO_NAO_ARMAZENADO]";
export const BIRTH_UNSTORED_TOKEN = "[DATA_NASCIMENTO_RECEBIDA_NAO_ARMAZENADA]";
function cpfValidToken(ref: string, last4: string): string { return `[CPF_VALIDO_REF_${ref}_FINAL_${last4}]`; }
function cpfInvalidToken(last4: string): string { return `[CPF_INVALIDO_FINAL_${last4}]`; }
function generic11Token(last4: string): string { return `[NUMERO_11_DIGITOS_FINAL_${last4}]`; }
function birthValidToken(ref: string): string { return `[DATA_NASCIMENTO_VALIDA_REF_${ref}]`; }
const BIRTH_INVALID_TOKEN = "[DATA_INVALIDA]";

export type SensitiveContext = {
  readonly expectsCpf?: boolean;
  readonly expectsBirthDate?: boolean;
};

// Run de 11 dígitos em formato CPF (com ou sem separadores). MESMO shape que o
// CHECK do banco rejeita (\y[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}\y) —
// mais permissivo aqui (aceita espaço/hífen como separador) para sanitizar TUDO
// que o lead digitar como documento.
const CPF_SHAPE_RX = /(?<![\d./-])(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{3})[-.\s]?(\d{2})(?![\d./-])/g;

// Data DD/MM/AAAA (ou com - ou .). Só ANO DE 4 DÍGITOS entra na classificação de
// nascimento (dois dígitos, ex. "12/07/26", pode ser visita — fica intocado).
const FULL_DATE_RX = /(?<!\d)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?!\d)/g;

// Validação REAL de CPF (dígitos verificadores) — formato+matemática, não frase.
export function isValidCpfDigits(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;   // 000..., 111..., etc.
  const calc = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

// Data de calendário válida (mês 1-12, dia coerente com o mês, bissexto ok).
export function isValidCalendarDate(day: number, month: number, year: number): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

// Plausibilidade de NASCIMENTO: ano entre 1900 e (anoRef - 14). Ano recente/futuro
// (visita, ano de veículo) NÃO é nascimento e fica fora da sanitização.
export function isBirthPlausibleYear(year: number, referenceYear: number): boolean {
  return year >= 1900 && year <= referenceYear - 14;
}

// Extrai e SANITIZA os spans sensíveis. Precedência: CPF (runs de 11 dígitos)
// PRIMEIRO, depois datas completas plausíveis de nascimento. O texto resultante
// não contém nenhum run sensível — passa no CHECK do banco por construção e o
// parser de dinheiro nunca vê esses dígitos (spans reservados).
export function extractSensitiveSpans(text: string, referenceYear: number, context: SensitiveContext = {}): SensitiveExtraction {
  const findings: SensitiveFinding[] = [];
  const secrets: SensitiveSecretCandidate[] = [];
  let sanitized = String(text ?? "");
  let seq = 0;

  sanitized = sanitized.replace(CPF_SHAPE_RX, (_m, a: string, b: string, c: string, d: string) => {
    const digits = `${a}${b}${c}${d}`;
    const last4 = digits.slice(-4);
    const placeholder = `[SENSITIVE_${seq++}]`;
    if (!context.expectsCpf) {
      findings.push({ kind: "numeric_11", valid: true, last4, placeholder });
      return generic11Token(last4);
    }
    const valid = isValidCpfDigits(digits);
    findings.push({ kind: "cpf", valid, last4, placeholder });
    if (valid) secrets.push({ kind: "cpf", value: digits, last4, placeholder });
    return valid ? placeholder : cpfInvalidToken(last4);
  });

  sanitized = sanitized.replace(FULL_DATE_RX, (m, d: string, mo: string, y: string) => {
    const day = Number(d), month = Number(mo), year = Number(y);
    // Ano fora da faixa de nascimento (ex.: 2026 = visita/veículo) fica INTACTO.
    if (!isBirthPlausibleYear(year, referenceYear)) return m;
    if (!context.expectsBirthDate) return m;
    const valid = isValidCalendarDate(day, month, year);
    const placeholder = `[SENSITIVE_${seq++}]`;
    findings.push({ kind: "birth_date", valid, placeholder });
    if (valid) secrets.push({ kind: "birth_date", value: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`, last4: null, placeholder });
    return valid ? placeholder : BIRTH_INVALID_TOKEN;
  });

  return { sanitized, findings, secrets };
}

export function materializeSensitiveTokens(
  extraction: SensitiveExtraction,
  refs: ReadonlyMap<string, string>,
): string {
  let text = extraction.sanitized;
  for (const secret of extraction.secrets) {
    const ref = refs.get(secret.placeholder);
    const token = ref
      ? secret.kind === "cpf" ? cpfValidToken(ref, secret.last4 ?? "0000") : birthValidToken(ref)
      : secret.kind === "cpf" ? CPF_UNSTORED_TOKEN : BIRTH_UNSTORED_TOKEN;
    text = text.replace(secret.placeholder, token);
  }
  return text;
}

// O texto contém run em formato CPF que o CHECK do banco rejeitaria? (guarda de
// teste/última linha de defesa antes de qualquer persistência).
export function containsCpfShapedRun(text: string): boolean {
  CPF_SHAPE_RX.lastIndex = 0;
  return CPF_SHAPE_RX.test(String(text ?? ""));
}

// Spans RESERVADOS para o parser de dinheiro/km/ano (precedência lexical): remove
// datas completas (qualquer ano) e runs de 11 dígitos do texto ANTES da varredura
// numérica. Defesa em profundidade — mesmo que um span sensível escape da
// sanitização do ingest (ex.: replay antigo), ele nunca vira valor financeiro.
export function reserveSensitiveNumericSpans(text: string): string {
  let out = String(text ?? "");
  // Tokens tipados podem carregar final4/ref hexadecimal. Nenhum digito dentro
  // de um token de PII e dinheiro, ano, km ou telefone.
  out = out.replace(/\[(?:CPF|NUMERO_11_DIGITOS|DATA_)[^\]]+\]/gi, " ");
  out = out.replace(CPF_SHAPE_RX, " ");
  out = out.replace(/(?<!\d)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?!\d)/g, " ");   // QUALQUER data completa
  return out;
}

// Achados a partir de um texto JÁ SANITIZADO (tokens) — usado pelo engine/extrator
// para tipar o turno sem depender de repassar os findings do ingest.
export function findingsFromSanitizedText(text: string): readonly SensitiveFinding[] {
  const out: SensitiveFinding[] = [];
  const t = String(text ?? "");
  const validCpf = t.match(new RegExp(CPF_VALID_TOKEN_RX.source, "g")) ?? [];
  for (const m of validCpf) {
    const parsed = CPF_VALID_TOKEN_RX.exec(m);
    out.push({ kind: "cpf", valid: true, last4: parsed?.[2] ?? "", placeholder: "" });
  }
  const invalidCpf = t.match(new RegExp(CPF_INVALID_TOKEN_RX.source, "g")) ?? [];
  for (const m of invalidCpf) out.push({ kind: "cpf", valid: false, last4: CPF_INVALID_TOKEN_RX.exec(m)?.[1] ?? "", placeholder: "" });
  const generic = t.match(new RegExp(GENERIC_11_TOKEN_RX.source, "g")) ?? [];
  for (const m of generic) out.push({ kind: "numeric_11", valid: true, last4: GENERIC_11_TOKEN_RX.exec(m)?.[1] ?? "", placeholder: "" });
  if (BIRTH_DATE_VALID_TOKEN_RX.test(t)) out.push({ kind: "birth_date", valid: true, placeholder: "" });
  if (BIRTH_DATE_INVALID_TOKEN_RX.test(t)) out.push({ kind: "birth_date", valid: false, placeholder: "" });
  return out;
}
