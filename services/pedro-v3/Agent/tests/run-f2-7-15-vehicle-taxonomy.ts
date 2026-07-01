// ============================================================================
// F2.7.15 - Taxonomia automotiva canonica.
// A API de estoque pode chamar picape/SUV de "outros" ou "utilitario"; o Pedro
// deve entender pelo modelo real do carro antes de filtrar estoque.
//   npx tsx tests/run-f2-7-15-vehicle-taxonomy.ts
// ============================================================================
import { classifyVehicleType } from "../src/adapters/read/stock-normalizer.ts";
import { V2StockSource } from "../src/adapters/read/stock-source.ts";
import type { StockLoader } from "../src/adapters/read/stock-loader.ts";
import type { NormalizedVehicle, TenantAgentRef } from "../src/domain/read-ports.ts";

let ok = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`  OK  ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.error(`  RED ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function typeOf(brand: string, model: string, version = "", sourceCategory = "AUTOMOVEL", sourceBodyType = "Outros") {
  return classifyVehicleType(sourceCategory, sourceBodyType, "bndv", { brand, model, version });
}

const ref: TenantAgentRef = { tenantId: "tenant", agentId: "agent" };

function vehicle(input: Partial<NormalizedVehicle> & { source: string; externalVehicleId: string; markName: string; modelName: string; year: number; saleValue: number }): NormalizedVehicle {
  return {
    versionName: null,
    km: 50000,
    color: null,
    fuelName: null,
    transmissionName: null,
    pictureJs: null,
    category: "AUTOMOVEL",
    bodyType: "Outros",
    ...input,
  };
}

class FakeStockLoader implements StockLoader {
  constructor(private readonly vehicles: readonly NormalizedVehicle[]) {}
  async loadAll(): Promise<NormalizedVehicle[]> {
    return [...this.vehicles];
  }
}

async function main(): Promise<void> {
  console.log("\n=== F2.7.15 Vehicle taxonomy ===\n");

  check("taxonomy: Fiat Strada => pickup mesmo se source=Outros", typeOf("Fiat", "Strada").value === "pickup");
  check("taxonomy: Fiat Toro => pickup mesmo se source=Outros", typeOf("Fiat", "Toro").value === "pickup");
  check("taxonomy: Toyota Hilux Cabine Simples => pickup por modelo especifico", typeOf("Toyota", "Hilux Cabine Simples").value === "pickup");
  check("taxonomy: Nissan Frontier => pickup", typeOf("Nissan", "Frontier").value === "pickup");
  check("taxonomy: Jeep Renegade => suv mesmo se source=Outros", typeOf("Jeep", "Renegade").value === "suv");
  check("taxonomy: Fiat Fastback => suv", typeOf("Fiat", "Fastback").value === "suv");
  check("taxonomy: Fiat Pulse => suv", typeOf("Fiat", "Pulse").value === "suv");
  check("taxonomy: Peugeot 2008 => suv", typeOf("Peugeot", "2008").value === "suv");
  check("taxonomy: HB20S vence HB20 e vira sedan", typeOf("Hyundai", "HB20S").value === "sedan");
  check("taxonomy: HB20 sem S vira hatch", typeOf("Hyundai", "HB20").value === "hatch");
  check("taxonomy: Onix Plus vence Onix e vira sedan", typeOf("Chevrolet", "Onix Plus").value === "sedan");
  check("taxonomy: Onix hatch continua hatch", typeOf("Chevrolet", "Onix").value === "hatch");
  check("taxonomy: C3 Aircross vence C3 e vira suv", typeOf("Citroen", "C3 Aircross").value === "suv");
  check("taxonomy: C3 sozinho vira hatch", typeOf("Citroen", "C3").value === "hatch");
  check("fallback: source_field ainda funciona", classifyVehicleType("", "sedan", "bndv").value === "sedan");
  check("fallback: unknown permanece unknown sem taxonomia/source", classifyVehicleType("AUTOMOVEL", "Outros", "bndv", { brand: "X", model: "Modelo Fantasma" }).value === "unknown");

  const stock: NormalizedVehicle[] = [
    vehicle({ source: "revendamais", externalVehicleId: "strada", markName: "Fiat", modelName: "Strada", bodyType: "utilitario", year: 2018, saleValue: 76990 }),
    vehicle({ source: "bndv", externalVehicleId: "toro", markName: "Fiat", modelName: "Toro", bodyType: "Outros", year: 2017, saleValue: 94990 }),
    vehicle({ source: "bndv", externalVehicleId: "hilux", markName: "Toyota", modelName: "Hilux Cabine Simples", bodyType: "Outros", year: 2011, saleValue: 109990 }),
    vehicle({ source: "bndv", externalVehicleId: "frontier", markName: "Nissan", modelName: "Frontier", bodyType: "Caminhonete", year: 2018, saleValue: 129990 }),
    vehicle({ source: "bndv", externalVehicleId: "fastback", markName: "Fiat", modelName: "Fastback", bodyType: "Outros", year: 2023, saleValue: 99990 }),
    vehicle({ source: "bndv", externalVehicleId: "pulse", markName: "Fiat", modelName: "Pulse", bodyType: "Outros", year: 2022, saleValue: 89990 }),
    vehicle({ source: "bndv", externalVehicleId: "renegade", markName: "Jeep", modelName: "Renegade", bodyType: "Utilitario", year: 2021, saleValue: 82990 }),
    vehicle({ source: "bndv", externalVehicleId: "onix", markName: "Chevrolet", modelName: "Onix", bodyType: "Outros", year: 2014, saleValue: 54990 }),
    vehicle({ source: "bndv", externalVehicleId: "onix-plus", markName: "Chevrolet", modelName: "Onix Plus", bodyType: "Outros", year: 2021, saleValue: 79990 }),
  ];
  const source = new V2StockSource(new FakeStockLoader(stock));

  const pickups = await source.search(ref, { tipo: "pickup" });
  const pickupModels = pickups.items.map((v) => v.modelo).sort().join(",");
  check("stock: filtro pickup encontra Strada/Toro/Hilux/Frontier", /Strada/.test(pickupModels) && /Toro/.test(pickupModels) && /Hilux/.test(pickupModels) && /Frontier/.test(pickupModels), pickupModels);
  check("stock: filtro pickup nao traz hatch/sedan", pickups.items.every((v) => v.tipo === "pickup"), JSON.stringify(pickups.items));

  const suvs = await source.search(ref, { tipo: "suv" });
  const suvModels = suvs.items.map((v) => v.modelo).sort().join(",");
  check("stock: filtro suv encontra Fastback/Pulse/Renegade mesmo com source ruim", /Fastback/.test(suvModels) && /Pulse/.test(suvModels) && /Renegade/.test(suvModels), suvModels);
  check("stock: filtro suv nao traz picapes", suvs.items.every((v) => v.tipo === "suv"), JSON.stringify(suvs.items));

  const sedans = await source.search(ref, { tipo: "sedan" });
  check("stock: Onix Plus entra como sedan", sedans.items.some((v) => v.modelo === "Onix Plus"));
  const hatches = await source.search(ref, { tipo: "hatch" });
  check("stock: Onix hatch entra como hatch sem trazer Onix Plus", hatches.items.some((v) => v.modelo === "Onix") && hatches.items.every((v) => v.modelo !== "Onix Plus"), JSON.stringify(hatches.items));

  console.log(`\n=== F2.7.15: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) {
    for (const failure of failures) console.error("  - " + failure);
    process.exit(1);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
