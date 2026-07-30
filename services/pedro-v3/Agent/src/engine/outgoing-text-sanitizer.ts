// Text hygiene at the final response boundary.
//
// Some provider responses have contained overlong JSON Unicode escapes such as
// `\u001f60A` (intended U+1F60A). JSON correctly consumes only four hex digits,
// producing U+001F followed by the visible suffix "60A". Once U+001F is merely
// stripped, the suffix leaks to WhatsApp and the original character is lost.
//
// Recovery is deliberately conservative: it only joins a C0 control prefix to
// an immediately adjacent hexadecimal suffix when the resulting code point is
// in a range used by Latin text, punctuation/symbols or emoji. This is transport
// normalization; it does not inspect or rewrite the commercial meaning.

const RECOVERABLE_CODE_POINT_RANGES = [
  [0x00a0, 0x02ff], // Latin-1, Latin Extended and IPA.
  [0x2000, 0x2bff], // Punctuation, currency, arrows and common symbols.
  [0x1f000, 0x1faff], // Emoji and supplementary pictographs.
] as const;

function isPreservedWhitespace(codePoint: number): boolean {
  return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
}

function isRepairableControlPrefix(codePoint: number): boolean {
  return codePoint < 0x20 && !isPreservedWhitespace(codePoint);
}

function isRecoverableCodePoint(codePoint: number): boolean {
  if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return false;
  return RECOVERABLE_CODE_POINT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function isHexDigit(value: string): boolean {
  return /^[0-9a-f]$/i.test(value);
}

/**
 * Reassembles the visible remainder left by an overlong JSON `\u` escape.
 *
 * The input is the already-parsed string, so no backslash remains. For example:
 * U+001F + "60A" becomes U+1F60A, and U+000E + "D" becomes U+00ED.
 */
export function repairOverlongUnicodeEscapeFragments(text: string): string {
  let output = "";

  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index) ?? 0;
    const width = codePoint > 0xffff ? 2 : 1;

    if (!isRepairableControlPrefix(codePoint)) {
      output += text.slice(index, index + width);
      index += width;
      continue;
    }

    const suffixStart = index + width;
    let suffix = "";
    while (suffix.length < 4 && suffixStart + suffix.length < text.length) {
      const next = text[suffixStart + suffix.length] ?? "";
      if (!isHexDigit(next)) break;
      suffix += next;
    }

    let repaired: string | null = null;
    let consumedSuffixLength = 0;
    for (let length = suffix.length; length >= 1; length--) {
      const candidateHex = `${codePoint.toString(16).padStart(4, "0")}${suffix.slice(0, length)}`;
      const candidate = Number.parseInt(candidateHex, 16);
      if (!isRecoverableCodePoint(candidate)) continue;
      repaired = String.fromCodePoint(candidate);
      consumedSuffixLength = length;
      break;
    }

    if (repaired != null) {
      output += repaired;
      index = suffixStart + consumedSuffixLength;
      continue;
    }

    // Leave an unrecognized control untouched for the stripping pass below.
    output += text.slice(index, index + width);
    index += width;
  }

  return output;
}

function stripUnsafeControlChars(text: string): string {
  let output = "";
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    const unsafeC0 = codePoint < 0x20 && !isPreservedWhitespace(codePoint);
    if (unsafeC0 || codePoint === 0x7f || codePoint === 0xfffd) continue;
    output += char;
  }
  return output;
}

// Compatibility net for already-visible corruption produced by older runtime
// versions after the control prefix had been discarded. Structural recovery
// above is authoritative for new responses.
function repairVisibleLatin1Escapes(text: string): string {
  if (!/(?:ðŸ|Voceaa|Taubate9|\bje1\b|\p{L}(?:eaa|e7|e9|e1|e0|e2|e3|f3|f4|f5)\b)/u.test(text)) return text;
  return text
    .replace(/ðŸ.{0,2}/g, "")
    .replace(/eaa/g, "ê")
    .replace(/e7/g, "ç")
    .replace(/e9/g, "é")
    .replace(/e1/g, "á")
    .replace(/e0/g, "à")
    .replace(/e2/g, "â")
    .replace(/e3/g, "ã")
    .replace(/f3/g, "ó")
    .replace(/f4/g, "ô")
    .replace(/f5/g, "õ");
}

export function sanitizeOutgoingText(text: string): string {
  const structurallyRepaired = repairOverlongUnicodeEscapeFragments(text);
  return repairVisibleLatin1Escapes(stripUnsafeControlChars(structurallyRepaired))
    .replace(/(\p{Extended_Pictographic})(?=\p{L})/gu, "$1 ")
    .normalize("NFC");
}
