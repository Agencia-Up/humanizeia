// ============================================================================
// draft-grounding.ts — structural grounding of a natural-text vehicle mention.
//
// The LLM may speak naturally about one vehicle returned by stock_search. The
// engine validates identity; it does not require a commercial rendering format.
// Price and vehicle attributes remain covered by their own factual validators.
// ============================================================================
import type { ClaimExtractor, ResponseDraft } from "../domain/decision.ts";
import type { VehicleFact } from "../domain/types.ts";
import { modelIdentityMatches, normalizeText } from "./catalog-utils.ts";

function boundedTermInText(text: string, term: string): boolean {
  const haystack = ` ${normalizeText(text)} `;
  const needle = normalizeText(term);
  return needle !== "" && haystack.includes(` ${needle} `);
}

/**
 * Returns true only when natural text identifies exactly one fresh vehicle.
 * Brand-only mentions never qualify, and two returned cars with the same model
 * remain ambiguous. This is identity grounding, not attribute grounding.
 */
export function draftNaturallyReferencesSingleFreshVehicle(input: {
  readonly draft: ResponseDraft;
  readonly freshVehicles: readonly VehicleFact[];
  readonly claimExtractor: ClaimExtractor;
}): boolean {
  const byKey = new Map(input.freshVehicles.map((vehicle) => [vehicle.vehicleKey, vehicle]));
  if (byKey.size === 0) return false;

  const referencedKeys = new Set<string>();
  for (const part of input.draft.parts) {
    if (part.type !== "text") continue;
    const modelClaims = input.claimExtractor.extractClaims(part.content)
      .filter((claim) => claim.kind === "model" || claim.kind === "brand_model");

    for (const vehicle of byKey.values()) {
      const claimedByCatalog = modelClaims.some((claim) => modelIdentityMatches(claim.normalized, {
        marca: vehicle.marca,
        modelo: vehicle.modelo,
      }));
      // Fallback for a degraded catalog snapshot: a full, bounded model label
      // returned by the tool still grounds identity without substring matching.
      const claimedByFreshFact = boundedTermInText(part.content, vehicle.modelo)
        || boundedTermInText(part.content, `${vehicle.marca} ${vehicle.modelo}`);
      if (claimedByCatalog || claimedByFreshFact) referencedKeys.add(vehicle.vehicleKey);
    }
  }

  return referencedKeys.size === 1;
}
