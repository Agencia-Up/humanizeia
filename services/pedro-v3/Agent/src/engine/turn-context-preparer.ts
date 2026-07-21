import type { TurnContextPreparer } from "../domain/context.ts";
import type {
  AutomotiveClaim,
  ClaimExtractor,
  TenantCatalog,
  TurnInterpretation,
} from "../domain/decision.ts";
import type { TurnUnderstanding } from "../domain/conversation-model.ts";
import type { StockSource, TenantAgentRef } from "../domain/read-ports.ts";
import { buildTenantCatalog, normalizeText, normalizedTermInText } from "./catalog-utils.ts";
import { CompositeClaimExtractor } from "./automotive-claim-extractor.ts";

export interface TenantCatalogSource {
  loadCatalog(ref: TenantAgentRef): Promise<TenantCatalog>;
}

export class StockTenantCatalogSource implements TenantCatalogSource {
  constructor(private readonly stock: StockSource) {}

  async loadCatalog(ref: TenantAgentRef): Promise<TenantCatalog> {
    const result = await this.stock.search(ref, {});
    return buildTenantCatalog(result.items);
  }
}

/** Catalog boundary for non-automotive profiles: no stock read, no vehicle claims. */
export class EmptyTenantCatalogSource implements TenantCatalogSource {
  async loadCatalog(_ref: TenantAgentRef): Promise<TenantCatalog> {
    return { entries: [] };
  }
}

export class CatalogClaimExtractor implements ClaimExtractor {
  constructor(private readonly catalog: TenantCatalog) {}

  extractClaims(text: string): AutomotiveClaim[] {
    const claims: AutomotiveClaim[] = [];
    const seen = new Set<string>();
    const add = (kind: AutomotiveClaim["kind"], original: string) => {
      const normalized = normalizeText(original);
      const key = `${kind}:${normalized}`;
      if (!normalized || seen.has(key)) return;
      seen.add(key);
      claims.push({ kind, text: original, normalized });
    };

    for (const entry of this.catalog.entries) {
      if (normalizedTermInText(text, entry.brand)) add("brand", entry.brand);
    }

    // Model names frequently overlap in a live catalog (HB20/HB20S,
    // Onix/Onix Plus, C3/C3 Aircross). Keep the longest match at each span so
    // rendering a grounded model cannot manufacture an extra shorter claim.
    const normalizedText = normalizeText(text);
    const matches: Array<{ start: number; end: number; model: string }> = [];
    const ranges = (term: string): Array<{ start: number; end: number }> => {
      const needle = normalizeText(term);
      if (!needle) return [];
      const haystack = ` ${normalizedText} `;
      const bounded = ` ${needle} `;
      const out: Array<{ start: number; end: number }> = [];
      let from = 0;
      while (from < haystack.length) {
        const index = haystack.indexOf(bounded, from);
        if (index < 0) break;
        const start = index + 1;
        out.push({ start, end: start + needle.length });
        from = index + 1;
      }
      return out;
    }

    for (const entry of this.catalog.entries) {
      for (const term of new Set([entry.model, ...entry.aliases])) {
        for (const range of ranges(term)) matches.push({ ...range, model: entry.model });
      }
    }

    matches.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const selected: typeof matches = [];
    for (const candidate of matches) {
      const overlapsLonger = selected.some((match) =>
        candidate.start < match.end && match.start < candidate.end &&
        (match.end - match.start) > (candidate.end - candidate.start));
      if (!overlapsLonger) selected.push(candidate);
    }
    selected.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    for (const match of selected) add("model", match.model);
    return claims;
  }
}

export class ConversationTurnContextPreparer implements TurnContextPreparer {
  constructor(
    private readonly ref: TenantAgentRef,
    private readonly understanding: TurnUnderstanding,
    private readonly catalogs: TenantCatalogSource,
    private readonly independentClaimExtractor?: ClaimExtractor,
  ) {}

  async prepare(args: Parameters<TurnContextPreparer["prepare"]>[0]) {
    let tenantCatalog: TenantCatalog;
    let catalogDegraded = false;
    try {
      tenantCatalog = await this.catalogs.loadCatalog(this.ref);
    } catch {
      // Empty catalog fails closed for vehicle grounding without blocking a greeting.
      // ⭐Missão P0: a degradação é OBSERVÁVEL (decision_final.catalogDegraded) — nunca silenciosa; os fatos
      // frescos das tools do turno seguem aterrando oferta (isVehicleKeyGrounded), o snapshot vazio não os apaga.
      tenantCatalog = { entries: [] };
      catalogDegraded = true;
    }

    let interpretation: TurnInterpretation;
    try {
      interpretation = await this.understanding.interpret({
        state: args.state,
        turnId: args.turnId,
        now: args.now,
        leadMessage: args.leadMessage,
        tenantCatalog,
      });
    } catch {
      // The decision engine still sees the lead text and can emit its terminal-safe path.
      interpretation = { relation: "ambiguous", intentSummary: "understanding_unavailable" };
    }

    return {
      interpretation,
      tenantCatalog,
      catalogDegraded,
      claimExtractor: this.independentClaimExtractor
        ? new CompositeClaimExtractor([new CatalogClaimExtractor(tenantCatalog), this.independentClaimExtractor])
        : new CatalogClaimExtractor(tenantCatalog),
    };
  }
}
