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

export function parseOrdinal(msg: string): { value: number; strong: boolean } | null {
  const norm = normalizeText(msg);
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(norm)) return { value: n, strong: true };
  }
  const strong = /\b(?:item|opcao|numero|posicao|#)\s*([1-9])\b(?!\s*(?:fotos?|imagens?))/.exec(norm);
  if (strong) return { value: Number(strong[1]), strong: true };
  const weak = /\b(?:d[aeo]|[ao])\s+([1-9])\b(?!\s*(?:fotos?|imagens?))/.exec(norm);
  if (weak) return { value: Number(weak[1]), strong: false };
  return null;
}
