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
      if (normalizedTermInText(text, entry.model)) add("model", entry.model);
      for (const alias of entry.aliases) {
        // Alias identifies the canonical model; emitting the full alias as a model
        // would make "Jeep Renegade" differ from the grounded model "Renegade".
        if (normalizedTermInText(text, alias)) add("model", entry.model);
      }
    }
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
    try {
      tenantCatalog = await this.catalogs.loadCatalog(this.ref);
    } catch {
      // Empty catalog fails closed for vehicle grounding without blocking a greeting.
      tenantCatalog = { entries: [] };
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
      claimExtractor: this.independentClaimExtractor
        ? new CompositeClaimExtractor([new CatalogClaimExtractor(tenantCatalog), this.independentClaimExtractor])
        : new CatalogClaimExtractor(tenantCatalog),
    };
  }
}
