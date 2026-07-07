import type {
  StockSource,
  VehicleDetailSource,
  TenantAgentRef,
  StockSearchFilters,
  StockSearchResult
} from "../../domain/read-ports.ts";
import type { VehicleFact } from "../../domain/types.ts";
import type { StockLoader } from "./stock-loader.ts";
import {
  generateVehicleKey,
  classifyVehicleType,
  parseVehiclePhotos,
  normalizeText
} from "./stock-normalizer.ts";
import {
  isPopularVehicleFromTaxonomy,
  resolveCanonicalVehicleModelFromTaxonomy,
} from "./vehicle-taxonomy.ts";

// F2.29 (P0): detecção de MOTO por FATO da fonte (categoria/carroceria) + modelo de moto conhecido. Roda ANTES dos
// filtros de tipo. A taxonomia de CARRO não conhece motos (resolveVehicleTypeFromTaxonomy => null p/ moto), então um
// Honda CB com categoria errada ("carro") ainda é pego pelo modelo — o fato/heurística VENCE um `tipo` errado da API.
// Objetivo: moto NUNCA aparece em lista de carro, salvo o lead pedir moto (includeMotorcycles=true).
const MOTORCYCLE_CATEGORY_RX = /\b(moto|motocicleta|motoneta|scooter|triciclo|quadriciclo|ciclomotor|motorcycle|motorbike)\b/;
const MOTORCYCLE_MODEL_RX = /\b(cb\d{0,4}|cg\d{0,3}|biz|pop\d{2,3}|fan\d{0,3}|titan|bros|xre\d{0,3}|nxr|cbr\d{0,4}|twister|hornet|fazer|ybr\d{0,3}|factor|xtz\d{0,3}|lander|tenere|crosser|fz15|fz25|mt03|mt07|mt09|nmax|xmax|pcx|adv150|burgman|bandit|gsr\d{0,3}|intruder|boulevard|vstrom|dl650|shineray|dk150|next300|citycom)\b/;

function isMotorcycleVehicle(category: string | null, bodyType: string | null, modelName: string | null): boolean {
  const cat = normalizeText(`${category ?? ""} ${bodyType ?? ""}`);
  if (cat && MOTORCYCLE_CATEGORY_RX.test(cat)) return true;
  const model = normalizeText(`${modelName ?? ""}`);
  if (model && MOTORCYCLE_MODEL_RX.test(model)) return true;
  return false;
}

export class V2StockSource implements StockSource, VehicleDetailSource {
  constructor(
    private readonly loader: StockLoader
  ) {}

  // 1. StockSource: search
  async search(ref: TenantAgentRef, filters: StockSearchFilters): Promise<StockSearchResult> {
    const vehicles = await this.loader.loadAll(ref);

    // Identifica colisões de fingerprint para marcar ambiguous=true
    const fingerprintCounts = new Map<string, number>();
    for (const v of vehicles) {
      const { key } = generateVehicleKey(v);
      fingerprintCounts.set(key, (fingerprintCounts.get(key) || 0) + 1);
    }

    // Filtra em cima de NormalizedVehicle
    let pool = vehicles;

    // REGRA: Sem preço ou ano -> Fail-Closed (não entra em oferta firme/fato)
    pool = pool.filter(v => v.year !== null && v.saleValue !== null && v.saleValue > 0);

    // A) Exclusão por excludeKeys (cumulativo)
    if (filters.excludeKeys && filters.excludeKeys.length > 0) {
      const excludeSet = new Set(filters.excludeKeys);
      pool = pool.filter(v => {
        const { key } = generateVehicleKey(v);
        return !excludeSet.has(key);
      });
    }

    // A2) F2.29 (P0): MOTO NUNCA entra em lista de carro. Filtro DEFAULT (salvo o lead pedir moto: includeMotorcycles).
    // Fato da fonte (categoria/carroceria) OU modelo de moto conhecido — a taxonomia/fato vence um `tipo` errado da API.
    if (!filters.includeMotorcycles) {
      pool = pool.filter(v => !isMotorcycleVehicle(v.category, v.bodyType, v.modelName));
    }

    // B) Filtro rígido por tipo/carroceria (broad não relaxa!)
    if (filters.tipo) {
      pool = pool.filter(v => {
        const classified = classifyVehicleType(v.category, v.bodyType, v.source, { brand: v.markName, model: v.modelName, version: v.versionName });
        // unknown nunca atende SUV, sedan, hatch ou pickup!
        if (classified.value === "unknown") return false;
        return classified.value === filters.tipo;
      });
    }

    // "Carro popular" e um segmento de mercado brasileiro, nao sinonimo de
    // qualquer veiculo barato. A taxonomia exclui SUV/picape e modelos medios.
    if (filters.popular === true) {
      pool = pool.filter((v) => isPopularVehicleFromTaxonomy({
        brand: v.markName,
        model: v.modelName,
        version: v.versionName,
      }));
    }

    // C) Filtro rígido por teto de preço (broad não relaxa!)
    if (filters.cambio) {
      pool = pool.filter(v => {
        const transmission = normalizeText(v.transmissionName ?? "");
        if (!transmission) return false;
        const automatic = /automatic|automatiz|cvt|dsg|dualogic|imotion|tiptronic/.test(transmission);
        const manual = /manual/.test(transmission) && !automatic;
        return filters.cambio === "automatic" ? automatic : manual;
      });
    }

    if (filters.precoMax && filters.precoMax > 0) {
      pool = pool.filter(v => v.saleValue !== null && v.saleValue <= filters.precoMax!);
    }

    // C3) Filtro RÍGIDO por ANO (F2.28): "EcoSport 13/14/15" -> só 2013/2014/2015. Um carro fora do ano NUNCA é match.
    if (filters.anos && filters.anos.length > 0) {
      const anos = new Set(filters.anos);
      pool = pool.filter(v => v.year != null && anos.has(v.year));
    }

    // C2) Filtro por MARCA/fabricante (markName). O engine já canonicaliza (volks->volkswagen); o match é por inclusão
    // bidirecional p/ tolerar abreviação crua do cérebro ("volks" ⊂ "volkswagen").
    if (filters.marca) {
      const m = normalizeText(filters.marca);
      if (m.length > 0) {
        pool = pool.filter(v => {
          const brand = normalizeText(v.markName ?? "");
          return brand.length > 0 && (brand.includes(m) || m.includes(brand));
        });
      }
    }

    // D) Filtro por modelo (textual, incluindo marca, modelo e versão!)
    if (filters.modelo) {
      const queryNorm = normalizeText(filters.modelo);
      const queryTokens = queryNorm.split(/\s+/).filter(Boolean);

      if (queryTokens.length > 0) {
        if (filters.broad) {
          // Casamento amplo: pelo menos um token deve bater
          pool = pool.filter(v => {
            const vText = normalizeText(`${v.markName} ${v.modelName} ${v.versionName}`);
            return queryTokens.some(token => vText.includes(token));
          });
        } else {
          // Casamento estrito: todos os tokens devem bater
          pool = pool.filter(v => {
            const vText = normalizeText(`${v.markName} ${v.modelName} ${v.versionName}`);
            return queryTokens.every(token => vText.includes(token));
          });
        }
      }
    }

    // Ordenação (Desempate): Preço crescente, depois maior ano
    pool.sort((a, b) => {
      if (a.saleValue! !== b.saleValue!) return a.saleValue! - b.saleValue!;
      return b.year! - a.year!;
    });

    // Mapeia para VehicleFact mantendo de-duplicação estrita de ofertas
    const items: VehicleFact[] = [];
    const seenKeys = new Set<string>();

    for (const v of pool) {
      const { key } = generateVehicleKey(v);
      // REGRA: "Não devolver duas ofertas com o mesmo vehicleKey em colisão de fingerprint"
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);

      const isAmbiguous = (fingerprintCounts.get(key) || 0) > 1;
      const classifiedType = classifyVehicleType(v.category, v.bodyType, v.source, { brand: v.markName, model: v.modelName, version: v.versionName });
      const canonicalModel = resolveCanonicalVehicleModelFromTaxonomy({ brand: v.markName, model: v.modelName, version: v.versionName });
      const photos = parseVehiclePhotos(key, v.pictureJs);
      const photoIds = isAmbiguous ? [] : photos.map(p => p.id);

      items.push({
        vehicleKey: key,
        marca: this.cleanPart(v.markName || ""),
        modelo: canonicalModel || this.cleanPart(v.modelName || ""),
        ano: v.year!,
        preco: v.saleValue!,
        km: v.km !== null ? v.km : undefined,
        cambio: v.transmissionName ? this.cleanPart(v.transmissionName) : undefined,
        cor: v.color ? this.cleanPart(v.color) : undefined,
        tipo: classifiedType.value,
        photoIds: photoIds.length > 0 ? photoIds : undefined
      });
    }

    return {
      items,
      filtersUsed: filters
    };
  }

  // 2. VehicleDetailSource: getDetails
  async getDetails(ref: TenantAgentRef, vehicleKey: string): Promise<VehicleFact | null> {
    const searchResult = await this.search(ref, {});
    const found = searchResult.items.find(v => v.vehicleKey === vehicleKey);
    return found || null;
  }

  private cleanPart(value: string): string {
    return value
      .replace(/([A-Za-z])(\d)/g, "$1 $2")
      .replace(/(\d)([A-Za-z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  }
}
