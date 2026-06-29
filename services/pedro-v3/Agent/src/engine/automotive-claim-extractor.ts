import type { AutomotiveClaim, ClaimExtractor } from "../domain/decision.ts";
import { normalizeText, normalizedTermInText } from "./catalog-utils.ts";

export type AutomotiveLexiconEntry = {
  readonly kind: AutomotiveClaim["kind"];
  readonly term: string;
  readonly aliases?: readonly string[];
};

function uniqueKey(kind: AutomotiveClaim["kind"], normalized: string): string {
  return `${kind}:${normalized}`;
}

function isValidEntry(entry: AutomotiveLexiconEntry): boolean {
  return typeof entry.term === "string" &&
    normalizeText(entry.term) !== "" &&
    ["brand", "model", "brand_model"].includes(entry.kind) &&
    (entry.aliases === undefined || entry.aliases.every((alias) => typeof alias === "string" && normalizeText(alias) !== ""));
}

export class LexiconAutomotiveClaimExtractor implements ClaimExtractor {
  readonly #entries: readonly AutomotiveLexiconEntry[];

  constructor(entries: readonly AutomotiveLexiconEntry[]) {
    if (!Array.isArray(entries) || !entries.every(isValidEntry)) {
      throw new Error("AUTOMOTIVE_LEXICON_INVALID");
    }
    this.#entries = structuredClone(entries);
    Object.freeze(this.#entries);
  }

  extractClaims(text: string): AutomotiveClaim[] {
    const claims: AutomotiveClaim[] = [];
    const seen = new Set<string>();
    const add = (kind: AutomotiveClaim["kind"], original: string) => {
      const normalized = normalizeText(original);
      const key = uniqueKey(kind, normalized);
      if (!normalized || seen.has(key)) return;
      seen.add(key);
      claims.push({ kind, text: original, normalized });
    };

    for (const entry of this.#entries) {
      if (normalizedTermInText(text, entry.term)) add(entry.kind, entry.term);
      for (const alias of entry.aliases ?? []) {
        if (normalizedTermInText(text, alias)) add(entry.kind, entry.term);
      }
    }
    return claims;
  }
}

export class CompositeClaimExtractor implements ClaimExtractor {
  readonly #extractors: readonly ClaimExtractor[];

  constructor(extractors: readonly ClaimExtractor[]) {
    if (!Array.isArray(extractors) || extractors.length === 0 ||
      extractors.some((extractor) => typeof extractor?.extractClaims !== "function")) {
      throw new Error("CLAIM_EXTRACTOR_INVALID");
    }
    this.#extractors = Object.freeze([...extractors]);
  }

  extractClaims(text: string): AutomotiveClaim[] {
    const claims: AutomotiveClaim[] = [];
    const seen = new Set<string>();
    for (const extractor of this.#extractors) {
      for (const claim of extractor.extractClaims(text)) {
        const key = uniqueKey(claim.kind, claim.normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        claims.push(claim);
      }
    }
    return claims;
  }
}
