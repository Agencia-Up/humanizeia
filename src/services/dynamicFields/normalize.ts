// Normalização compartilhada — espelha a função SQL normalize_dynamic_name.
// Usada em validação cliente-side ANTES de enviar pro Supabase (UX em tempo real).
// Banco aplica a função SQL na chave única, então mesmo se cliente errar, o
// INSERT cai em ON CONFLICT.

const SMALL_WORDS_PT = new Set([
  "de", "da", "do", "das", "dos", "e", "a", "o", "as", "os",
  "para", "com", "em", "por",
]);

/** Remove acentos via NFD + filtragem dos combinings */
function removeAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Espelha exatamente o normalize_dynamic_name do Postgres */
export function normalizeForDedup(input: string): string {
  if (!input) return "";
  const lower = removeAccents(String(input)).toLowerCase();
  return lower.replace(/\s+/g, " ").trim();
}

/**
 * Title Case com preposições PT-BR minúsculas (mas SEMPRE primeira palavra maiúscula).
 * - "são josé dos campos" → "São José dos Campos"
 * - "RIO DE JANEIRO"     → "Rio de Janeiro"
 * - "ubatuba"            → "Ubatuba"
 */
export function toDisplayName(input: string): string {
  if (!input) return "";
  const cleaned = String(input).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  return cleaned
    .split(" ")
    .map((word, idx) => {
      if (!word) return word;
      const lower = word.toLowerCase();
      // Primeira palavra sempre capitalizada, mesmo se for "de"
      if (idx === 0) return capitalizeWord(word);
      // Preposições/conjunções minúsculas
      if (SMALL_WORDS_PT.has(removeAccents(lower))) return lower;
      return capitalizeWord(word);
    })
    .join(" ");
}

function capitalizeWord(word: string): string {
  // Lida com hífen (Santa-Cruz → Santa-Cruz, não Santa-cruz) e apóstrofe (D'Ávila)
  return word
    .split(/(['\-])/)
    .map((part, i) => {
      if (part === "'" || part === "-") return part;
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

/**
 * Validação básica de entrada (antes de chamar API).
 * Retorna lista de erros (string vazia = ok).
 */
export function validateNameInput(
  input: string,
  opts?: { allowNumbers?: boolean; minLen?: number; maxLen?: number }
): string[] {
  const errors: string[] = [];
  const trimmed = (input || "").trim();
  const minLen = opts?.minLen ?? 2;
  const maxLen = opts?.maxLen ?? 100;
  const allowNumbers = opts?.allowNumbers ?? false;

  if (trimmed.length < minLen) {
    errors.push(`Mínimo ${minLen} caracteres`);
  }
  if (trimmed.length > maxLen) {
    errors.push(`Máximo ${maxLen} caracteres`);
  }
  if (!allowNumbers && /\d/.test(trimmed)) {
    errors.push("Não pode conter números");
  }
  // Permite letras, números (se allowed), espaço, hífen, apóstrofe, ponto (S.A.)
  const allowedRegex = allowNumbers
    ? /^[\p{L}\p{N}\s\-'.()]+$/u
    : /^[\p{L}\s\-'.()]+$/u;
  if (trimmed && !allowedRegex.test(trimmed)) {
    errors.push("Caracteres especiais não permitidos (use só letras, hífen, apóstrofe, ponto)");
  }

  return errors;
}
