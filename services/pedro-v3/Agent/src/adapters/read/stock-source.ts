import type {
  StockSource,
  VehicleDetailSource,
  TenantAgentRef,
  StockSearchFilters,
  StockSearchResult,
  NormalizedVehicle
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

    // Requisito de propulsão é duro: um carro flex/gasolina não atende um
    // pedido por híbrido, mesmo que satisfaça tipo, preço e câmbio.
    if (filters.hibrido === true) {
      pool = pool.filter((v) => /\b(?:hibrid|hybrid)\b/.test(normalizeText(v.fuelName ?? "")));
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

    // D) Filtro por modelo (textual: marca+modelo+versão). O `pool` ATÉ AQUI tem os filtros OBJETIVOS (tipo/câmbio/preço/
    // ano/marca) — é a BASE do fallback de FAMÍLIA. ⭐F2.76 def#1 (Codex): cada ALTERNATIVA de modelo (modelos[] multi-
    // modelo OU o modelo único) casa por TODOS os seus tokens (AND interno); o veículo casa se bater QUALQUER alternativa
    // (OR entre modelos DISTINTOS). `broad` NÃO relaxa mais o modelo — o antigo OR-de-token deixava a versão de um modelo
    // contaminar outro ("HB20 Confort Plus" pegava "Argo Confort Plus"); segue aceito p/ compat, porém INERTE no modelo.
    const poolBeforeModel = pool;
    const vehicleText = (v: NormalizedVehicle): string => normalizeText(`${v.markName} ${v.modelName} ${v.versionName}`);
    const modelAlternatives: string[][] = (filters.modelos && filters.modelos.length > 0)
      ? filters.modelos.map((m) => normalizeText(m).split(/\s+/).filter(Boolean)).filter((toks) => toks.length > 0)
      : (filters.modelo ? [normalizeText(filters.modelo).split(/\s+/).filter(Boolean)].filter((toks) => toks.length > 0) : []);
    const exactPool = modelAlternatives.length === 0
      ? poolBeforeModel
      : poolBeforeModel.filter((v) => modelAlternatives.some((toks) => toks.every((t) => vehicleText(v).includes(t))));

    // ⭐F2.76 (incidente Wa "HB20 Confort Plus"): a busca EXATA (com versão) vem VAZIA, mas o MODELO-BASE existe no estoque.
    // Em vez de "não temos" seco, devolvemos CANDIDATOS DE FAMÍLIA SEPARADOS (matchKind=family_candidate), NUNCA como match
    // exato. Preserva os filtros objetivos (já no poolBeforeModel) e só RELAXA a versão, casando pelo MODELO CANÔNICO da
    // taxonomia ("HB20 Confort Plus" -> família "HB20"). SÓ para busca de UM modelo (não multi-modelo modelos[], onde a
    // relaxação de versão não se aplica a um OR de modelos distintos). A LLM decide apresentar e SEMPRE confirma a versão.
    const singleModel = filters.modelo && !(filters.modelos && filters.modelos.length > 0) ? filters.modelo : null;
    let familyPool: readonly NormalizedVehicle[] = [];
    if (exactPool.length === 0 && singleModel != null) {
      const queryFamily = normalizeText(resolveCanonicalVehicleModelFromTaxonomy({ brand: filters.marca ?? "", model: singleModel, version: "" }) ?? "");
      // Só busca família quando a consulta é MAIS ESPECÍFICA que a própria família (tem versão): "HB20 Confort Plus" != "HB20".
      if (queryFamily.length > 0 && queryFamily !== normalizeText(singleModel)) {
        familyPool = poolBeforeModel.filter((v) => {
          const fam = normalizeText(resolveCanonicalVehicleModelFromTaxonomy({ brand: v.markName ?? "", model: v.modelName ?? "", version: v.versionName ?? "" }) ?? "");
          return fam.length > 0 && fam === queryFamily;
        });
      }
    }

    // Mapeia NormalizedVehicle[] -> VehicleFact[] (ordena por preço asc, depois maior ano; dedup estrito de vehicleKey).
    const toItems = (list: readonly NormalizedVehicle[]): VehicleFact[] => {
      const sorted = [...list].sort((a, b) => (a.saleValue! !== b.saleValue! ? a.saleValue! - b.saleValue! : b.year! - a.year!));
      const out: VehicleFact[] = [];
      const seen = new Set<string>();
      for (const v of sorted) {
        const { key } = generateVehicleKey(v);
        if (seen.has(key)) continue;
        seen.add(key);
        const isAmbiguous = (fingerprintCounts.get(key) || 0) > 1;
        const classifiedType = classifyVehicleType(v.category, v.bodyType, v.source, { brand: v.markName, model: v.modelName, version: v.versionName });
        const canonicalModel = resolveCanonicalVehicleModelFromTaxonomy({ brand: v.markName, model: v.modelName, version: v.versionName });
        const photos = parseVehiclePhotos(key, v.pictureJs);
        const photoIds = isAmbiguous ? [] : photos.map((p) => p.id);
        out.push({
          vehicleKey: key,
          marca: this.cleanPart(v.markName || ""),
          modelo: canonicalModel || this.cleanPart(v.modelName || ""),
          ano: v.year!,
          preco: v.saleValue!,
          km: v.km !== null ? v.km : undefined,
          cambio: v.transmissionName ? this.cleanPart(v.transmissionName) : undefined,
          cor: v.color ? this.cleanPart(v.color) : undefined,
          tipo: classifiedType.value,
          photoIds: photoIds.length > 0 ? photoIds : undefined,
        });
      }
      return out;
    };

    const items = toItems(exactPool);
    const familyCandidates = items.length === 0 ? toItems(familyPool) : [];
    const matchKind: "exact" | "family_candidate" | "none" = items.length > 0 ? "exact" : (familyCandidates.length > 0 ? "family_candidate" : "none");

    return { items, filtersUsed: filters, familyCandidates, matchKind };
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
