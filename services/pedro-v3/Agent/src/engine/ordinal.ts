// ============================================================================
// ordinal.ts — parser ÚNICO de ORDINAL de seleção/foto (endurecido). Reutilizado por photo-intent E
// lead-extraction (item 2 Codex: não criar dois parsers divergentes). QUANTIDADE NÃO é ordinal:
// exige um CUE (palavra ordinal, ou item/opção/número/posição/#, ou d[aeo]/[ao]) antes do dígito E um
// LOOKAHEAD NEGATIVO contra "N fotos"/"N imagens". "quero 3 fotos"/"manda 2 imagens" -> null;
// "quero o 3"/"foto da opção 3"/"o terceiro" -> ordinal.
// ============================================================================
import { normalizeText } from "./catalog-utils.ts";

const ORDINALS: Record<string, number> = {
  primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5,
};

const WEEKDAY_ORDINALS = new Set(["segunda", "quarta", "quinta"]);

function isTemporalWeekdayUse(norm: string, word: string, index: number): boolean {
  if (!WEEKDAY_ORDINALS.has(word)) return false;

  const before = norm.slice(Math.max(0, index - 24), index);
  const after = norm.slice(index + word.length, index + word.length + 28);
  const explicitListCue = /\b(?:item|opcao|alternativa|lista|unidade|versao|vaga)\s*$/.test(before)
    || /^\s*(?:opcao|alternativa|da\s+lista|unidade|versao)\b/.test(after);
  if (explicitListCue) return false;

  return /^\s*-?\s*feira\b/.test(after)
    || /\b(?:pra|para|na|nesta|ate|em)\s*$/.test(before)
    || /\b(?:pode\s+ser|fica\s+para|marcamos|agendamos)\s*$/.test(before)
    || /^\s*(?:as\s+)?\d{1,2}(?::[0-5]\d|h\b|\s+horas?\b)/.test(after);
}

export function parseOrdinal(msg: string): { value: number; strong: boolean } | null {
  const norm = normalizeText(msg);
  for (const [word, n] of Object.entries(ORDINALS)) {
    const match = new RegExp(`\\b${word}\\b`).exec(norm);
    if (!match) continue;
    if (isTemporalWeekdayUse(norm, word, match.index)) continue;
    return { value: n, strong: true };
  }
  const strong = /\b(?:item|opcao|numero|posicao|#)\s*([1-9])\b(?!\s*(?:fotos?|imagens?))/.exec(norm);
  if (strong) return { value: Number(strong[1]), strong: true };
  const weak = /\b(?:d[aeo]|[ao])\s+([1-9])\b(?!\s*(?:fotos?|imagens?))/.exec(norm);
  if (weak) return { value: Number(weak[1]), strong: false };
  return null;
}
