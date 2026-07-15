// Read-only pre-flight for enabling Pedro v3 on Carvalho/Bruno.
// No LLM calls, CRM writes, WhatsApp sends, or routing changes happen here.
import { SupabaseReadOnlyDatabase } from "../src/adapters/read/supabase-read-database.ts";
import { V2DatabaseCredentialProvider, V2DatabaseReadGateway } from "../src/adapters/read/supabase-v2-read-adapter.ts";
import { V2PlaintextApiKeyReader } from "../src/adapters/read/v2-api-key-reader.ts";
import { V2TenantConfigSource } from "../src/adapters/read/tenant-config-source.ts";
import { ReadCache } from "../src/adapters/read/cache.ts";
import { SafeHttpClient } from "../src/adapters/read/http-client.ts";
import { V2StockLoader } from "../src/adapters/read/stock-loader.ts";
import { V2StockSource } from "../src/adapters/read/stock-source.ts";
import { SupabaseTransferStore } from "../src/adapters/effects/supabase-transfer-store.ts";
import type { NormalizedVehicle, TenantAgentRef } from "../src/domain/read-ports.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { loadServiceEnv } from "./real-harness.ts";

const BRUNO: TenantAgentRef = {
  tenantId: "f49fd48a-4386-4009-95f3-26a5100b84f7",
  agentId: "aee7e916-31b1-431c-ba6f-f38178fd4899",
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`ENV_${name}_MISSING`);
  return value;
}

function hostOf(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("SUPABASE_URL_INVALID");
  return parsed.hostname.toLowerCase();
}

function sampleLabel(vehicle: VehicleFact | undefined): string | null {
  if (!vehicle) return null;
  return [vehicle.marca, vehicle.modelo, vehicle.ano].filter((value) => value != null && value !== "").join(" ") || null;
}

async function main(): Promise<void> {
  loadServiceEnv();
  const url = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const allowedHosts = [hostOf(url)];
  const clock = { now: () => new Date().toISOString() };
  const readDb = SupabaseReadOnlyDatabase.create({ url, apiKey: serviceRoleKey, allowedHosts, timeoutMs: 20_000, maxResponseBytes: 4 * 1024 * 1024 });
  const gateway = new V2DatabaseReadGateway(readDb);
  const config = await new V2TenantConfigSource(gateway).load(BRUNO);
  if (!config.ok) throw new Error(`BRUNO_CONFIG_${config.error.code}`);

  const credentials = new V2DatabaseCredentialProvider(readDb, new V2PlaintextApiKeyReader());
  const cache = new ReadCache<NormalizedVehicle[]>(clock as never, { ttlMs: 30_000, maxItems: 2, enabled: true });
  const stock = new V2StockSource(new V2StockLoader(gateway, credentials, cache, new SafeHttpClient()));
  const inventory = await stock.search(BRUNO, {});
  if (inventory.items.length === 0) throw new Error("BRUNO_BNDV_STOCK_EMPTY_OR_UNAVAILABLE");

  const transfers = new SupabaseTransferStore({ url, serviceRoleKey, allowedHosts, timeoutMs: 15_000 });
  const transferConfig = await transfers.loadAgentConfig(BRUNO);
  if (!transferConfig) throw new Error("BRUNO_TRANSFER_CONFIG_MISSING");
  const scopedSellers = await transfers.listActiveSellers(BRUNO.tenantId, BRUNO.agentId);
  const roster = scopedSellers.length > 0 ? scopedSellers : await transfers.listActiveSellers(BRUNO.tenantId, null);
  const sellersWithPhone = roster.filter((seller) => String(seller.whatsappNumber ?? "").replace(/\D/g, "").length >= 10);
  if (sellersWithPhone.length === 0) throw new Error("BRUNO_NO_ACTIVE_SELLER_WITH_PHONE");

  console.log(JSON.stringify({
    ok: true,
    scope: "carvalho_bndv",
    agent: { promptSource: config.config.promptSource, promptConfigured: config.config.promptText.trim().length > 0 },
    stock: { provider: config.config.stockProvider, itemCount: inventory.items.length, sample: sampleLabel(inventory.items[0]) },
    automation: {
      transferEnabled: transferConfig.rules.transfer.enabled,
      followupEnabled: transferConfig.rules.followup.enabled,
      sellerResponseMin: transferConfig.rules.transfer.sellerResponseMin,
      sellerCount: sellersWithPhone.length,
      sellerScope: scopedSellers.length > 0 ? "agent" : "tenant_fallback",
    },
    sideEffects: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "PREFLIGHT_FAILED", sideEffects: false }));
  process.exitCode = 1;
});
