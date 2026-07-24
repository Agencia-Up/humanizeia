import type { TenantAgentRef, NormalizedVehicle, StockProvider } from "../../domain/read-ports.ts";
import type { CredentialProvider } from "../../domain/credential-provider.ts";
import type { StockIntegrationMetadataRow, V2ReadGateway } from "./v2-read-gateway.ts";
import { makeSecretRef } from "../../domain/credential-provider.ts";
import { ReadCache } from "./cache.ts";
import { SafeHttpClient } from "./http-client.ts";
import { decodeNormalizedVehicle } from "./stock-normalizer.ts";
import { parseBndvCredentials, resolveBndvAuthHeader } from "./bndv-auth.ts";

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

const STOCK_LOAD_RETRY_DELAY_MS = 150;

function isRetryableStockLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SAFE_FETCH_FAILURE:\s*(?:TIMEOUT|NETWORK_ERROR|HTTP_STATUS_(?:408|425|429|5\d\d))\b/i.test(message);
}

async function loadStockSnapshotWithBoundedRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    // SafeHttpClient already retries transient GET failures. This single
    // loader-level retry also covers POST feeds such as BNDV, without retrying
    // validation/auth/configuration failures or creating a retry storm.
    if (!isRetryableStockLoadError(error)) throw error;
    await new Promise<void>((resolve) => setTimeout(resolve, STOCK_LOAD_RETRY_DELAY_MS));
    return load();
  }
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
      // ⭐HONESTIDADE DE ESTOQUE (incidente Mônaco 2026-07-24): uma integração CONFIGURADA (chosen != null acima) cuja
      // credencial NÃO resolve é FALHA DE CARGA, não "loja sem o carro". Lançar — em vez de `return []` — faz o runner
      // emitir stock_search {ok:false}, que o engine trata como indisponibilidade honesta (recovery_stock_failed),
      // nunca "não temos". `return []` aqui virava mentira silenciosa ao lead (token morto -> "não temos SUVs").
      // Isto NÃO afeta "sem integração": esse caso já retornou [] antes (chosen == null), fora deste ponto.
      throw new Error("STOCK_UNAVAILABLE: stock credential unresolved");
    }

    const cacheExtraKey = `${integration.id}:${integration.updatedAt || "no-ts"}`;

    return this.cache.getOrFetch(ref.tenantId, provider, cacheExtraKey, () => loadStockSnapshotWithBoundedRetry(async () => {
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

      // ⭐BNDV DOIS MODOS (incidente Mônaco 2026-07-24): resolve Bearer legado (api_token) OU faz /login (external_key+
      // password). Sem isto o v3 só falava o modo legado e todo cliente do fluxo novo caía com catálogo 0. Auth que não
      // resolve = FALHA DE CARGA honesta (STOCK_UNAVAILABLE), nunca "loja vazia".
      const auth = await resolveBndvAuthHeader(parseBndvCredentials(cred), this.httpClient);
      if (!auth.ok) {
        throw new Error(`STOCK_UNAVAILABLE: BNDV auth (${auth.error})`);
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
          "Authorization": auth.authHeader
        },
        body: JSON.stringify({ query: graphqlQuery }),
        provider
      });

      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error("INVALID_CONTENT_TYPE");
      }

      const json = JSON.parse(text) as { data?: { vehiclesBy?: unknown } | null; errors?: unknown };
      // ⭐HONESTIDADE DE ESTOQUE: uma resposta de ERRO do provedor (GraphQL `errors`, ou `data`/`vehiclesBy` ausente =
      // token inválido / query recusada) é FALHA DE CARGA, não estoque vazio. Só um ARRAY PRESENTE (mesmo `[]`) é
      // resultado genuíno de "0 veículos". Lançar aqui faz o turno virar indisponibilidade honesta em vez de "não temos".
      const errs = (json as { errors?: unknown }).errors;
      if ((Array.isArray(errs) && errs.length > 0) || json?.data == null || !Array.isArray(json.data.vehiclesBy)) {
        throw new Error("STOCK_UNAVAILABLE: BNDV provider returned no vehicle data");
      }
      const rawList = json.data.vehiclesBy;

      return rawList
        .map((item: unknown) => {
          try {
            return decodeNormalizedVehicle(item, "bndv");
          } catch {
            return null;
          }
        })
        .filter((v: NormalizedVehicle | null): v is NormalizedVehicle => v !== null);
    }));
  }
}
