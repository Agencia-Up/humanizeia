const BNDV_API_URL = "https://api-estoque.azurewebsites.net/graphql";
const DEFAULT_LIMIT = 8;

type BndvCredentials = {
  api_token?: string;
};

type BndvVehicle = {
  modelName?: string | null;
  markName?: string | null;
  year?: number | null;
  km?: number | null;
  saleValue?: number | null;
  color?: string | null;
  fuelName?: string | null;
  transmissionName?: string | null;
  versionName?: string | null;
  pictureJs?: string | null;
};

export type PedroStockSearchInput = {
  user_id: string;
  query?: string;
  filters?: Record<string, any>;
  limit?: number;
};

function parseCredentials(raw: string | null): BndvCredentials {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { api_token: raw };
  }
}

function normalizeText(value?: string | null) {
  let normalized = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/-/g, " ")
    .replace(/[^\w\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  normalized = normalized
    .replace(/\beco\s*sport\b/g, "ecosport")
    .replace(/\bfree\s*style\b/g, "freestyle")
    .replace(/\bcresta\b/g, "creta")
    .replace(/\bauthen\.?\b/g, "authentique")
    .replace(/\bauthent\.?\b/g, "authentique")
    .replace(/\bauth\b/g, "authentique")
    .replace(/\bh rv\b/g, "hrv")
    .replace(/\bt\s*cross\b/g, "tcross")
    .replace(/\bonix\s+plus\b/g, "onix sedan plus")
    .trim();

  const expansions: string[] = [];
  if (/\bonix\b/.test(normalized)) expansions.push("chevrolet onix hatch sedan plus joy premier lt ltz activ");
  if (/\bcreta\b/.test(normalized)) expansions.push("hyundai creta action comfort limited platinum ultimate");
  if (/\bduster\b/.test(normalized)) expansions.push("renault duster authentique dynamique expression intense iconic suv");
  if (/\boroch\b/.test(normalized)) expansions.push("renault oroch duster pickup camionete picape");
  if (/\bstrada\b/.test(normalized)) expansions.push("fiat strada cabine dupla cd volcano freedom endurance pickup");
  if (/\btoro\b/.test(normalized)) expansions.push("fiat toro pickup caminhonete");
  if (/\basx\b/.test(normalized)) expansions.push("mitsubishi asx suv automatico");
  if (/\becosport\b/.test(normalized)) expansions.push("ford ecosport freestyle titanium se");
  if (expansions.length > 0) normalized = `${normalized} ${expansions.join(" ")}`;

  return normalized;
}

const WEAK_WORDS = new Set([
  "carro", "carros", "veiculo", "veiculos", "tem", "voces", "voce", "estoque",
  "disponivel", "preco", "valor", "anuncio", "instagram", "facebook", "esse",
  "essa", "este", "esta", "sobre", "quero", "queria", "saber", "mais", "de",
  "da", "do", "dos", "das", "um", "uma", "com", "sem", "para", "por", "ate",
  "automatico", "manual", "flex", "gasolina", "diesel", "aut", "mec",
]);

function searchTokens(value?: string | null) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !WEAK_WORDS.has(token));
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j++) previous[j] = current[j];
  }

  return previous[right.length];
}

function tokenSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length <= 3 || right.length <= 3) return 0;
  return 1 - levenshteinDistance(left, right) / Math.max(left.length, right.length);
}

function buildIndexedText(vehicle: BndvVehicle) {
  let indexed = normalizeText([
    vehicle.markName,
    vehicle.modelName,
    vehicle.versionName,
    vehicle.color,
    vehicle.fuelName,
    vehicle.transmissionName,
    vehicle.year?.toString(),
  ].filter(Boolean).join(" "));

  if (/\b(hilux|s10|ranger|amarok|toro|frontier|triton|l200|strada|saveiro|montana|oroch|maverick|ram)\b/i.test(indexed)) {
    indexed += " picape caminhonete camionete pickup";
  }
  if (/\b(compass|renegade|creta|kicks|hrv|tracker|tcross|nivus|fastback|pulse|tiggo|sw4|ecosport|duster|oroch|asx)\b/i.test(indexed)) {
    indexed += " suv utilitario";
  }
  if (/\b(onix|hb20|polo|argo|208|yaris|mobi|kwid|c3|gol|fox|sandero)\b/i.test(indexed)) {
    indexed += " hatch popular";
  }
  return indexed;
}

function inferRequestedVehicleType(filters: Record<string, any>): "carro" | "moto" | "qualquer" {
  const explicit = normalizeText(filters?.tipo_veiculo || filters?.tipo || filters?.categoria);
  const searchText = normalizeText([
    explicit,
    filters?.query,
    filters?.ad_context,
    filters?.contexto_anuncio,
    filters?.modelo,
  ].filter(Boolean).join(" "));

  if (/\b(moto|motos|motocicleta|scooter|biz|cg|fan|titan|bros|xre|pcx|nmax|fazer|factor|lander)\b/.test(searchText)) {
    return "moto";
  }
  if (/\b(carro|carros|automovel|veiculo|veiculos|suv|sedan|hatch|picape|pickup|caminhonete|camionete)\b/.test(searchText)) {
    return "carro";
  }
  return "qualquer";
}

function isLikelyMotorcycle(vehicle: BndvVehicle) {
  const indexed = buildIndexedText(vehicle);
  return /\b(yamaha|kawasaki|shineray|harley|dafra|triumph|ducati|ktm|bajaj|haojue|biz|cg|fan|titan|bros|xre|pcx|nmax|fazer|factor|lander|ybr|twister|crosser|hornet|scooter)\b/.test(indexed);
}

function passesRequestedVehicleType(vehicle: BndvVehicle, requestedType: "carro" | "moto" | "qualquer") {
  if (requestedType === "qualquer") return true;
  const moto = isLikelyMotorcycle(vehicle);
  return requestedType === "moto" ? moto : !moto;
}

function buildSearchText(filters: Record<string, any>) {
  return normalizeText([
    filters?.query,
    filters?.ad_context,
    filters?.contexto_anuncio,
    filters?.marca,
    filters?.modelo,
    filters?.versao,
    filters?.cor,
    filters?.combustivel,
    filters?.cambio,
    filters?.ano_min && filters?.ano_min === filters?.ano_max ? String(filters.ano_min) : "",
  ].filter(Boolean).join(" "));
}

function scoreVehicle(vehicle: BndvVehicle, filters: Record<string, any>) {
  const searchText = buildSearchText(filters);
  if (!searchText) return { score: 1, matchedTokens: [] as string[] };

  const indexed = buildIndexedText(vehicle);
  const indexedTokens = searchTokens(indexed);
  const queryTokens = [...new Set(searchTokens(searchText))];
  const matchedTokens: string[] = [];
  let score = 0;

  for (const token of queryTokens) {
    if (indexed.includes(token)) {
      matchedTokens.push(token);
      score += token.length <= 3 ? 1 : 2;
      continue;
    }
    if (indexedTokens.some((candidate) => tokenSimilarity(candidate, token) >= 0.84)) {
      matchedTokens.push(token);
      score += 1.25;
    }
  }

  const model = normalizeText(vehicle.modelName);
  const version = normalizeText(vehicle.versionName);
  const mark = normalizeText(vehicle.markName);
  const year = String(vehicle.year || "");

  if (filters?.marca && mark.includes(normalizeText(filters.marca))) score += 4;
  if (filters?.modelo && (model.includes(normalizeText(filters.modelo)) || indexed.includes(normalizeText(filters.modelo)))) score += 7;
  if (filters?.versao && version.includes(normalizeText(filters.versao))) score += 4;
  if (year && searchText.includes(year)) score += 3;

  for (const keyword of ["onix", "ecosport", "creta", "duster", "oroch", "strada", "toro", "asx"]) {
    if (searchText.includes(keyword) && model.includes(keyword)) score += 10;
    if (searchText.includes(keyword) && !model.includes(keyword)) score -= 8;
  }

  for (const modelToken of searchTokens(model)) {
    if (queryTokens.includes(modelToken)) score += 5;
  }

  const requiredTokens = Math.min(2, queryTokens.length);
  if (queryTokens.length > 0 && matchedTokens.length < requiredTokens && score < 5) score = 0;
  return { score, matchedTokens };
}

function passesNumericFilters(vehicle: BndvVehicle, filters: Record<string, any>, relaxed = false) {
  if (relaxed) return true;
  const year = Number(vehicle.year || 0);
  const price = Number(vehicle.saleValue || 0);
  const mileage = Number(vehicle.km || 0);
  return (
    (!filters?.ano_min || year >= Number(filters.ano_min)) &&
    (!filters?.ano_max || year <= Number(filters.ano_max)) &&
    (!filters?.preco_max || price <= Number(filters.preco_max)) &&
    (!filters?.km_max || mileage <= Number(filters.km_max))
  );
}

function rankVehicles(vehicles: BndvVehicle[], filters: Record<string, any>) {
  const requestedVehicleType = inferRequestedVehicleType(filters);
  const typedVehicles = vehicles.filter((vehicle) => passesRequestedVehicleType(vehicle, requestedVehicleType));
  const hasSearch = !!buildSearchText(filters);

  if (!hasSearch) {
    return typedVehicles
      .filter((vehicle) => passesNumericFilters(vehicle, filters))
      .map((vehicle) => ({ vehicle, score: 1, matchedTokens: [] as string[], relaxed: false }));
  }

  const ranked = typedVehicles
    .map((vehicle) => ({ vehicle, ...scoreVehicle(vehicle, filters), relaxed: false }))
    .filter((item) => item.score > 0 && passesNumericFilters(item.vehicle, filters))
    .sort((left, right) => right.score - left.score);

  if (ranked.length > 0) return ranked;

  return typedVehicles
    .map((vehicle) => ({ vehicle, ...scoreVehicle(vehicle, filters), relaxed: true }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}

function parseBndvPictures(rawPictureJs?: string | null) {
  if (!rawPictureJs) return [];
  try {
    const parsed = JSON.parse(rawPictureJs);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any) => ({
        url: String(item?.Link || item?.link || "").trim(),
        principal: String(item?.Principal || item?.principal || "").toLowerCase() === "true",
      }))
      .filter((item: any) => !!item.url)
      .sort((left: any, right: any) => Number(right.principal) - Number(left.principal));
  } catch {
    return [];
  }
}

function toPedroVehicle(vehicle: BndvVehicle, rank: { score: number; matchedTokens: string[]; relaxed: boolean }) {
  const pictures = parseBndvPictures(vehicle.pictureJs);
  const principalImage = pictures.find((item: any) => item.principal)?.url || pictures[0]?.url || null;
  const fotos = pictures.map((item: any) => item.url).filter(Boolean).slice(0, 12);
  return {
    marca: vehicle.markName || null,
    modelo: vehicle.modelName || null,
    versao: vehicle.versionName || null,
    ano: vehicle.year || null,
    km: vehicle.km || null,
    preco: vehicle.saleValue || null,
    cor: vehicle.color || null,
    combustivel: vehicle.fuelName || null,
    cambio: vehicle.transmissionName || null,
    label: [vehicle.markName, vehicle.modelName, vehicle.versionName].filter(Boolean).join(" "),
    principal_image: principalImage,
    fotos,
    images_count: pictures.length,
    match_score: rank.score,
    matched_tokens: rank.matchedTokens,
    relaxed_match: rank.relaxed,
  };
}

export async function searchPedroStock(supabase: any, input: PedroStockSearchInput) {
  const { data: integration, error: integrationError } = await supabase
    .from("platform_integrations")
    .select("api_key_encrypted, is_active")
    .eq("user_id", input.user_id)
    .eq("platform", "bndv")
    .maybeSingle();

  if (integrationError) throw integrationError;
  if (!integration?.is_active) {
    return { success: false, total: 0, items: [], error: "Integracao BNDV nao conectada para este cliente." };
  }

  const token = parseCredentials(integration.api_key_encrypted).api_token?.trim();
  if (!token) return { success: false, total: 0, items: [], error: "Bearer Token do BNDV nao encontrado." };

  const filters = {
    ...(input.filters || {}),
    query: input.query || input.filters?.query || input.filters?.modelo || "",
  };

  const graphqlResponse = await fetch(BNDV_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `
        query BndvVehicles {
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
          }
        }
      `,
    }),
  });

  const payload = await graphqlResponse.json().catch(() => null);
  if (!graphqlResponse.ok || Array.isArray(payload?.errors)) {
    return {
      success: false,
      total: 0,
      items: [],
      error: payload?.errors?.[0]?.message || payload?.message || `BNDV retornou status ${graphqlResponse.status}.`,
    };
  }

  const vehicles = Array.isArray(payload?.data?.vehiclesBy) ? payload.data.vehiclesBy : [];
  const ranked = rankVehicles(vehicles, filters).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftPrice = Number(left.vehicle.saleValue || 0);
    const rightPrice = Number(right.vehicle.saleValue || 0);
    if (leftPrice !== rightPrice) return leftPrice - rightPrice;
    return Number(right.vehicle.year || 0) - Number(left.vehicle.year || 0);
  });

  const limit = Math.max(1, Math.min(Number(input.limit || DEFAULT_LIMIT), 12));
  const items = ranked.slice(0, limit).map((rank) => toPedroVehicle(rank.vehicle, rank));
  return {
    success: true,
    total: ranked.length,
    items,
    filters_used: filters,
    response_guidance: ranked.length > 0
      ? "Ha candidatos compativeis no estoque. Se nao for exato, apresente como opcao proxima e confirme o detalhe."
      : "Nenhum candidato compativel encontrado mesmo com busca ampla. Nao invente disponibilidade.",
  };
}
