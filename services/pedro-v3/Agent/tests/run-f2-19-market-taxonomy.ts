import { V2StockSource } from "../src/adapters/read/stock-source.ts";
import type { StockLoader } from "../src/adapters/read/stock-loader.ts";
import type { NormalizedVehicle, TenantAgentRef } from "../src/domain/read-ports.ts";
import {
  isPopularVehicleFromTaxonomy,
  resolveCanonicalVehicleModelFromTaxonomy,
  resolveVehicleTypeFromTaxonomy,
} from "../src/adapters/read/vehicle-taxonomy.ts";
import { enrichStockSearchCall } from "../src/engine/central-engine.ts";
import { buildFrameSignals } from "../src/engine/turn-frame-builder.ts";

let ok = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { ok += 1; console.log(`  OK  ${name}`); }
  else { failed += 1; console.error(`  RED ${name}${detail ? `: ${detail}` : ""}`); }
}

function vehicle(id: string, brand: string, model: string, version: string, price: number): NormalizedVehicle {
  return {
    source: "revendamais", externalVehicleId: id, markName: brand, modelName: model, versionName: version,
    year: 2018, km: 80_000, saleValue: price, color: "Branco", fuelName: "Flex", transmissionName: "Manual",
    pictureJs: null, category: "AUTOMOVEL", bodyType: "Outros",
  };
}

class FakeLoader implements StockLoader {
  constructor(private readonly stock: readonly NormalizedVehicle[]) {}
  async loadAll(): Promise<NormalizedVehicle[]> { return [...this.stock]; }
}

async function main(): Promise<void> {
  console.log("\n=== F2.19 Market taxonomy ===\n");
  const c3 = { brand: "Citroen", model: "C3", version: "C3 EXCLUSIVE" };
  const aircross = { brand: "Citroen", model: "C3", version: "C3 AIRCROSS EXCM" };
  check("C3 comum e hatch", resolveVehicleTypeFromTaxonomy(c3) === "hatch");
  check("C3 Aircross e SUV", resolveVehicleTypeFromTaxonomy(aircross) === "suv");
  check("rotulo canonico preserva Aircross", resolveCanonicalVehicleModelFromTaxonomy(aircross) === "C3 Aircross");
  check("C3 hatch pode ser popular", isPopularVehicleFromTaxonomy(c3));
  check("C3 Aircross nao vira popular por conter C3", !isPopularVehicleFromTaxonomy(aircross));
  check("Onix/Gol/Palio sao populares", [
    { brand: "Chevrolet", model: "Onix" },
    { brand: "Volkswagen", model: "Gol" },
    { brand: "Fiat", model: "Palio" },
  ].every(isPopularVehicleFromTaxonomy));
  check("CRV nao e popular", !isPopularVehicleFromTaxonomy({ brand: "Honda", model: "CRV" }));
  const signals = buildFrameSignals("Queria um carro popular de ate 50k", { relation: "direction_change" });
  check("frame detecta popular como evidencia", signals.mentionsPopular === true);
  const enriched = enrichStockSearchCall(
    { tool: "stock_search", input: { precoMax: 50_000 } },
    { popular: signals.mentionsPopular === true, moreOptions: false, previousVehicleKeys: [] },
  );
  check("engine injeta popular:true preservando teto", enriched.tool === "stock_search" && enriched.input.popular === true && enriched.input.precoMax === 50_000);

  const source = new V2StockSource(new FakeLoader([
    vehicle("aircross", "Citroen", "C3", "C3 AIRCROSS EXCM", 47_990),
    vehicle("c3", "Citroen", "C3", "C3 EXCLUSIVE", 46_990),
    vehicle("gol", "Volkswagen", "Gol", "Gol 1.0", 42_990),
    vehicle("onix", "Chevrolet", "Onix", "Onix LT", 49_990),
    vehicle("crv", "Honda", "CRV", "CRV EXL", 48_990),
  ]));
  const ref: TenantAgentRef = { tenantId: "tenant", agentId: "agent" };
  const suvs = await source.search(ref, { tipo: "suv" });
  check("busca SUV mostra C3 Aircross, nunca C3 truncado", suvs.items.some((v) => v.modelo === "C3 Aircross") && !suvs.items.some((v) => v.modelo === "C3"), JSON.stringify(suvs.items));
  const popular = await source.search(ref, { popular: true, precoMax: 50_000 });
  const popularModels = popular.items.map((v) => v.modelo);
  check("popular usa taxonomia e teto", popularModels.includes("Gol") && popularModels.includes("Onix") && popularModels.includes("C3"), JSON.stringify(popularModels));
  check("popular exclui C3 Aircross e CRV mesmo baratos", !popularModels.includes("C3 Aircross") && !popularModels.includes("CR-V"), JSON.stringify(popularModels));

  console.log(`\nF2.19: ${ok} OK | ${failed} FALHA`);
  if (failed > 0) process.exitCode = 1;
}

void main();
