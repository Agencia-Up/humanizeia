// Generated from C:/Users/Douglas Aloan/Downloads/carros_brasil_categorias.xlsx.
// Source workbook rows: HATCH, SEDAN, SUV and PICAPE. Keep deterministic and provider-independent.
import type { VehicleType } from "../../domain/types.ts";

export type VehicleTaxonomyEntry = { readonly brand: string; readonly model: string; readonly type: VehicleType };

export const VEHICLE_TAXONOMY: readonly VehicleTaxonomyEntry[] = [
  { brand: "Chevrolet", model: "Agile", type: "hatch" },
  { brand: "Chevrolet", model: "Celta", type: "hatch" },
  { brand: "Chevrolet", model: "Onix", type: "hatch" },
  { brand: "Citroën", model: "C3", type: "hatch" },
  { brand: "Fiat", model: "Argo", type: "hatch" },
  { brand: "Fiat", model: "Mobi", type: "hatch" },
  { brand: "Fiat", model: "Palio", type: "hatch" },
  { brand: "Fiat", model: "Punto", type: "hatch" },
  { brand: "Fiat", model: "Uno", type: "hatch" },
  { brand: "Ford", model: "Fiesta", type: "hatch" },
  { brand: "Ford", model: "Ka", type: "hatch" },
  { brand: "Honda", model: "City Hatchback", type: "hatch" },
  { brand: "Honda", model: "Fit", type: "hatch" },
  { brand: "Hyundai", model: "HB20", type: "hatch" },
  { brand: "Hyundai", model: "HB20X", type: "hatch" },
  { brand: "Hyundai", model: "i30", type: "hatch" },
  { brand: "Kia", model: "Picanto", type: "hatch" },
  { brand: "Kia", model: "Soul", type: "hatch" },
  { brand: "Nissan", model: "March", type: "hatch" },
  { brand: "Peugeot", model: "207", type: "hatch" },
  { brand: "Peugeot", model: "208", type: "hatch" },
  { brand: "Renault", model: "Clio", type: "hatch" },
  { brand: "Renault", model: "Kwid", type: "hatch" },
  { brand: "Renault", model: "Sandero", type: "hatch" },
  { brand: "Toyota", model: "Etios", type: "hatch" },
  { brand: "Toyota", model: "Yaris", type: "hatch" },
  { brand: "Volkswagen", model: "Fox", type: "hatch" },
  { brand: "Volkswagen", model: "Gol", type: "hatch" },
  { brand: "Volkswagen", model: "Polo", type: "hatch" },
  { brand: "Volkswagen", model: "up!", type: "hatch" },
  { brand: "BYD", model: "Shark", type: "pickup" },
  { brand: "Chevrolet", model: "Montana", type: "pickup" },
  { brand: "Chevrolet", model: "S10", type: "pickup" },
  { brand: "Fiat", model: "Strada", type: "pickup" },
  { brand: "Fiat", model: "Titano", type: "pickup" },
  { brand: "Fiat", model: "Toro", type: "pickup" },
  { brand: "Ford", model: "Courier", type: "pickup" },
  { brand: "Ford", model: "F-150", type: "pickup" },
  { brand: "Ford", model: "F-250", type: "pickup" },
  { brand: "Ford", model: "Maverick", type: "pickup" },
  { brand: "Ford", model: "Ranger", type: "pickup" },
  { brand: "GWM", model: "Poer", type: "pickup" },
  { brand: "Mitsubishi", model: "L200 (Triton/Sport)", type: "pickup" },
  { brand: "Mitsubishi", model: "Triton", type: "pickup" },
  { brand: "Nissan", model: "Frontier", type: "pickup" },
  { brand: "Peugeot", model: "Hoggar", type: "pickup" },
  { brand: "Ram", model: "1500", type: "pickup" },
  { brand: "Ram", model: "2500", type: "pickup" },
  { brand: "Ram", model: "3500", type: "pickup" },
  { brand: "Ram", model: "Dakota", type: "pickup" },
  { brand: "Ram", model: "Rampage", type: "pickup" },
  { brand: "Renault", model: "Oroch", type: "pickup" },
  { brand: "Toyota", model: "Hilux", type: "pickup" },
  { brand: "Volkswagen", model: "Amarok", type: "pickup" },
  { brand: "Volkswagen", model: "Saveiro", type: "pickup" },
  { brand: "BYD", model: "King", type: "sedan" },
  { brand: "Chevrolet", model: "Cobalt", type: "sedan" },
  { brand: "Chevrolet", model: "Cruze", type: "sedan" },
  { brand: "Chevrolet", model: "Onix Plus", type: "sedan" },
  { brand: "Chevrolet", model: "Prisma", type: "sedan" },
  { brand: "Citroën", model: "C4 Lounge", type: "sedan" },
  { brand: "Fiat", model: "Cronos", type: "sedan" },
  { brand: "Fiat", model: "Grand Siena", type: "sedan" },
  { brand: "Fiat", model: "Siena", type: "sedan" },
  { brand: "Ford", model: "Focus Sedan", type: "sedan" },
  { brand: "GAC", model: "Aion ES", type: "sedan" },
  { brand: "Honda", model: "City", type: "sedan" },
  { brand: "Honda", model: "Civic", type: "sedan" },
  { brand: "Hyundai", model: "Elantra", type: "sedan" },
  { brand: "Hyundai", model: "HB20S", type: "sedan" },
  { brand: "Nissan", model: "Sentra", type: "sedan" },
  { brand: "Nissan", model: "Versa", type: "sedan" },
  { brand: "Peugeot", model: "408", type: "sedan" },
  { brand: "Renault", model: "Fluence", type: "sedan" },
  { brand: "Renault", model: "Logan", type: "sedan" },
  { brand: "Toyota", model: "Corolla", type: "sedan" },
  { brand: "Volkswagen", model: "Bora", type: "sedan" },
  { brand: "Volkswagen", model: "Jetta", type: "sedan" },
  { brand: "Volkswagen", model: "Virtus", type: "sedan" },
  { brand: "Volkswagen", model: "Voyage", type: "sedan" },
  { brand: "BYD", model: "Song", type: "suv" },
  { brand: "BYD", model: "Song Plus / Pro", type: "suv" },
  { brand: "BYD", model: "Tang", type: "suv" },
  { brand: "BYD", model: "Yuan Plus / Atto 3", type: "suv" },
  { brand: "CAOA Chery", model: "Tiggo 5x", type: "suv" },
  { brand: "CAOA Chery", model: "Tiggo 7", type: "suv" },
  { brand: "CAOA Chery", model: "Tiggo 8", type: "suv" },
  { brand: "CAOA Chery", model: "Tiggo 2", type: "suv" },
  { brand: "CAOA Chery", model: "Tiggo 3x", type: "suv" },
  { brand: "Chevrolet", model: "Captiva", type: "suv" },
  { brand: "Chevrolet", model: "Tracker", type: "suv" },
  { brand: "Chevrolet", model: "Trailblazer", type: "suv" },
  { brand: "Citroën", model: "Aircross", type: "suv" },
  { brand: "Citroën", model: "Basalt", type: "suv" },
  { brand: "Citroën", model: "C3 Aircross", type: "suv" },
  { brand: "Diversas", model: "Linha premium (resumo)", type: "suv" },
  { brand: "Fiat", model: "Fastback", type: "suv" },
  { brand: "Fiat", model: "Pulse", type: "suv" },
  { brand: "Ford", model: "Bronco Sport", type: "suv" },
  { brand: "Ford", model: "EcoSport", type: "suv" },
  { brand: "Ford", model: "Territory", type: "suv" },
  { brand: "GWM", model: "Haval H6", type: "suv" },
  { brand: "Honda", model: "HR-V", type: "suv" },
  { brand: "Honda", model: "WR-V", type: "suv" },
  { brand: "Honda", model: "CR-V", type: "suv" },
  { brand: "Hyundai", model: "Creta", type: "suv" },
  { brand: "Hyundai", model: "ix35", type: "suv" },
  { brand: "Hyundai", model: "Santa Fe", type: "suv" },
  { brand: "Hyundai", model: "Tucson", type: "suv" },
  { brand: "Jaecoo", model: "Jaecoo 5 / 7", type: "suv" },
  { brand: "Jeep", model: "Commander", type: "suv" },
  { brand: "Jeep", model: "Compass", type: "suv" },
  { brand: "Jeep", model: "Renegade", type: "suv" },
  { brand: "Kia", model: "Seltos", type: "suv" },
  { brand: "Kia", model: "Sportage", type: "suv" },
  { brand: "Mitsubishi", model: "ASX", type: "suv" },
  { brand: "Mitsubishi", model: "Eclipse Cross", type: "suv" },
  { brand: "Mitsubishi", model: "Outlander", type: "suv" },
  { brand: "Mitsubishi", model: "Pajero Sport / Full", type: "suv" },
  { brand: "Nissan", model: "Kicks", type: "suv" },
  { brand: "Nissan", model: "X-Trail", type: "suv" },
  { brand: "Omoda", model: "Omoda 5", type: "suv" },
  { brand: "Peugeot", model: "2008", type: "suv" },
  { brand: "Peugeot", model: "3008", type: "suv" },
  { brand: "Renault", model: "Boreal", type: "suv" },
  { brand: "Renault", model: "Captur", type: "suv" },
  { brand: "Renault", model: "Duster", type: "suv" },
  { brand: "Renault", model: "Kardian", type: "suv" },
  { brand: "Toyota", model: "Corolla Cross", type: "suv" },
  { brand: "Toyota", model: "RAV4", type: "suv" },
  { brand: "Toyota", model: "SW4", type: "suv" },
  { brand: "Volkswagen", model: "Nivus", type: "suv" },
  { brand: "Volkswagen", model: "T-Cross", type: "suv" },
  { brand: "Volkswagen", model: "Taos", type: "suv" },
  { brand: "Volkswagen", model: "Tera", type: "suv" },
  { brand: "Volkswagen", model: "Tiguan", type: "suv" },
];
function normalizeTaxonomyText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTaxonomyText(value: string | null | undefined): string {
  return normalizeTaxonomyText(value).replace(/\s+/g, "");
}

const TAXONOMY_BY_SPECIFICITY = [...VEHICLE_TAXONOMY].sort((a, b) => {
  const modelDelta = compactTaxonomyText(b.model).length - compactTaxonomyText(a.model).length;
  if (modelDelta !== 0) return modelDelta;
  return compactTaxonomyText(b.brand).length - compactTaxonomyText(a.brand).length;
});

// Segmento de mercado brasileiro: modelos compactos/de entrada de grande volume.
// A carroceria continua vindo da taxonomia completa; esta lista apenas responde ao
// sentido comercial de "carro popular" e nunca transforma SUV/picape em popular.
// Fonte: modelos de volume das abas HATCH/SEDA do workbook que gerou este arquivo.
const POPULAR_TAXONOMY: readonly { readonly brand: string; readonly model: string }[] = [
  { brand: "Chevrolet", model: "Agile" },
  { brand: "Chevrolet", model: "Celta" },
  { brand: "Chevrolet", model: "Onix" },
  { brand: "Chevrolet", model: "Onix Plus" },
  { brand: "Chevrolet", model: "Prisma" },
  { brand: "Citroen", model: "C3" },
  { brand: "Fiat", model: "Argo" },
  { brand: "Fiat", model: "Cronos" },
  { brand: "Fiat", model: "Grand Siena" },
  { brand: "Fiat", model: "Mobi" },
  { brand: "Fiat", model: "Palio" },
  { brand: "Fiat", model: "Siena" },
  { brand: "Fiat", model: "Uno" },
  { brand: "Ford", model: "Fiesta" },
  { brand: "Ford", model: "Ka" },
  { brand: "Ford", model: "Ka Sedan" },
  { brand: "Hyundai", model: "HB20" },
  { brand: "Hyundai", model: "HB20S" },
  { brand: "Nissan", model: "March" },
  { brand: "Peugeot", model: "207" },
  { brand: "Peugeot", model: "208" },
  { brand: "Renault", model: "Clio" },
  { brand: "Renault", model: "Kwid" },
  { brand: "Renault", model: "Logan" },
  { brand: "Renault", model: "Sandero" },
  { brand: "Toyota", model: "Etios" },
  { brand: "Toyota", model: "Etios Sedan" },
  { brand: "Volkswagen", model: "Fox" },
  { brand: "Volkswagen", model: "Gol" },
  { brand: "Volkswagen", model: "up!" },
  { brand: "Volkswagen", model: "Voyage" },
];

function resolveVehicleTaxonomyEntry(input: {
  readonly brand?: string | null;
  readonly model?: string | null;
  readonly version?: string | null;
}): VehicleTaxonomyEntry | null {
  const brandNorm = compactTaxonomyText(input.brand);
  const modelNorm = compactTaxonomyText(input.model);
  const fullNorm = compactTaxonomyText(`${input.model ?? ""} ${input.version ?? ""}`);

  if (!modelNorm && !fullNorm) return null;

  for (const entry of TAXONOMY_BY_SPECIFICITY) {
    const entryBrand = compactTaxonomyText(entry.brand);
    if (brandNorm && entryBrand && brandNorm !== entryBrand) continue;

    const entryModel = compactTaxonomyText(entry.model);
    if (!entryModel) continue;
    if (modelNorm === entryModel || fullNorm === entryModel || fullNorm.includes(entryModel)) return entry;
  }
  return null;
}

export function resolveVehicleTypeFromTaxonomy(input: {
  readonly brand?: string | null;
  readonly model?: string | null;
  readonly version?: string | null;
}): VehicleType | null {
  return resolveVehicleTaxonomyEntry(input)?.type ?? null;
}

export function resolveCanonicalVehicleModelFromTaxonomy(input: {
  readonly brand?: string | null;
  readonly model?: string | null;
  readonly version?: string | null;
}): string | null {
  return resolveVehicleTaxonomyEntry(input)?.model ?? null;
}

export function isPopularVehicleFromTaxonomy(input: {
  readonly brand?: string | null;
  readonly model?: string | null;
  readonly version?: string | null;
}): boolean {
  const resolved = resolveVehicleTaxonomyEntry(input);
  if (!resolved || (resolved.type !== "hatch" && resolved.type !== "sedan")) return false;
  const brand = compactTaxonomyText(resolved.brand);
  const model = compactTaxonomyText(resolved.model);
  return POPULAR_TAXONOMY.some((entry) => compactTaxonomyText(entry.brand) === brand && compactTaxonomyText(entry.model) === model);
}
