import type { TenantAgentRef, NormalizedVehicle, StockProvider } from "../../domain/read-ports.ts";
import type { CredentialProvider } from "../../domain/credential-provider.ts";
import type { StockIntegrationMetadataRow, V2ReadGateway } from "./v2-read-gateway.ts";
import { makeSecretRef } from "../../domain/credential-provider.ts";
import { ReadCache } from "./cache.ts";
import { SafeHttpClient } from "./http-client.ts";
import { decodeNormalizedVehicle } from "./stock-normalizer.ts";

export interface StockLoader {
  loadAll(ref: TenantAgentRef): Promise<NormalizedVehicle[]>;
}

type StockSelection = {
  readonly provider: StockProvider;
  readonly integration: StockIntegrationMetadataRow;
};

function isValidTimestampOrNull(value: unknown): boolean {
  if (value === null) return true;
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

function selectStockIntegration(ref: TenantAgentRef, rows: readonly StockIntegrationMetadataRow[]): StockSelection | null {
  const active = rows.filter((r) => r.isActive);
  const seenProviders = new Set<string>();

  for (const row of active) {
    if (row.tenantId !== ref.tenantId) {
      throw new Error("STOCK_METADATA_OWNERSHIP_MISMATCH");
    }
    if (typeof row.id !== "string" || row.id.trim() === "") {
      throw new Error("STOCK_METADATA_INVALID_ID");
    }
    const provider = typeof row.provider === "string" ? row.provider.toLowerCase() : "";
    if (provider !== "revendamais" && provider !== "bndv") {
      throw new Error("STOCK_METADATA_UNKNOWN_PROVIDER");
    }
    if (!isValidTimestampOrNull(row.updatedAt)) {
      throw new Error("STOCK_METADATA_INVALID_TIMESTAMP");
    }
    if (seenProviders.has(provider)) {
      throw new Error("STOCK_METADATA_DUPLICATE_PROVIDER");
    }
    seenProviders.add(provider);
  }

  const revenda = active.find((row) => row.provider.toLowerCase() === "revendamais");
  const bndv = active.find((row) => row.provider.toLowerCase() === "bndv");
  const chosen = revenda ?? bndv ?? null;
  if (!chosen) return null;
  return { provider: chosen.provider.toLowerCase() as StockProvider, integration: chosen };
}

function parseSecretMaterial(material: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(material) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Scalar secret fallback below.
  }
  return { api_token: material, feed_url: material };
}

function stringFromSecret(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

export class V2StockLoader implements StockLoader {
  constructor(
    private readonly gateway: V2ReadGateway,
    private readonly credentialProvider: CredentialProvider,
    private readonly cache: ReadCache<NormalizedVehicle[]>,
    private readonly httpClient: SafeHttpClient = new SafeHttpClient()
  ) {}

  async loadAll(ref: TenantAgentRef): Promise<NormalizedVehicle[]> {
    const agent = await this.gateway.getOwnedAgent(ref);
    if (!agent || agent.id !== ref.agentId || agent.tenantId !== ref.tenantId || !agent.isActive) {
      return [];
    }

    const integrations = await this.gateway.listActiveStockIntegrationMetadata(ref);
    const chosen = selectStockIntegration(ref, integrations);
    if (!chosen) {
      return [];
    }

    const { provider, integration } = chosen;
    const secretRef = makeSecretRef({
      tenantId: ref.tenantId,
      integrationId: integration.id,
      provider,
      purpose: "stock_feed"
    });

    const integrationRes = await this.credentialProvider.resolve(secretRef);
    if (!integrationRes.ok) {
      return [];
    }

    const cacheExtraKey = `${integration.id}:${integration.updatedAt || "no-ts"}`;

    return this.cache.getOrFetch(ref.tenantId, provider, cacheExtraKey, async () => {
      const cred = parseSecretMaterial(integrationRes.secret.material);

      if (provider === "revendamais") {
        const feedUrl = stringFromSecret(cred, ["feed_url", "url"]);
        if (!feedUrl) {
          throw new Error("FEED_URL_NOT_FOUND");
        }

        const { text, contentType } = await this.httpClient.safeFetch(feedUrl, {
          provider,
          headers: { Accept: "application/json" }
        });

        if (!contentType.toLowerCase().includes("application/json")) {
          throw new Error("INVALID_CONTENT_TYPE");
        }

        const json = JSON.parse(text) as unknown;
        const rawList = Array.isArray((json as { vehicles?: unknown })?.vehicles)
          ? (json as { vehicles: unknown[] }).vehicles
          : (Array.isArray(json) ? json : []);

        return rawList
          .map((item: unknown) => {
            try {
              return decodeNormalizedVehicle(item, "revendamais");
            } catch {
              return null;
            }
          })
          .filter((v: NormalizedVehicle | null): v is NormalizedVehicle => v !== null);
      }

      const apiToken = stringFromSecret(cred, ["api_token", "token"]);
      if (!apiToken) {
        throw new Error("API_TOKEN_NOT_FOUND");
      }

      const graphqlQuery = `
        query BndvVehiclesFullSpec {
          vehiclesBy {
            modelName
            markName
            year
            km
            saleValue
            color
            fuelName
            transmissionName
            versionName
            pictureJs
            vehicleExternalKey
            subCategoryName
          }
        }
      `;

      const { text, contentType } = await this.httpClient.safeFetch("https://api-estoque.azurewebsites.net/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiToken}`
        },
        body: JSON.stringify({ query: graphqlQuery }),
        provider
      });

      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error("INVALID_CONTENT_TYPE");
      }

      const json = JSON.parse(text) as { data?: { vehiclesBy?: unknown } };
      const rawList = Array.isArray(json?.data?.vehiclesBy) ? json.data.vehiclesBy : [];

      return rawList
        .map((item: unknown) => {
          try {
            return decodeNormalizedVehicle(item, "bndv");
          } catch {
            return null;
          }
        })
        .filter((v: NormalizedVehicle | null): v is NormalizedVehicle => v !== null);
    });
  }
}
