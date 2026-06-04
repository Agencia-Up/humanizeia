import { PedroV2LeadMemory } from "./types.ts";

export type PedroVehicleResolution = {
  has_current_vehicle_signal: boolean;
  query: string | null;
  canonical_model: string | null;
  vehicle_type: string | null;
  confidence: number;
  source: "message" | "ad_context" | "media_context" | "memory" | "none";
  reason: string;
  current_message_overrides_memory: boolean;
  used_memory: boolean;
  possible_new_topic: boolean;
  has_multiple_vehicles: boolean;
  all_matched_models: string[];
};

type VehicleAlias = {
  canonical: string;
  label: string;
  type: string;
  aliases: string[];
};

const VEHICLE_ALIASES: VehicleAlias[] = [
  { canonical: "oroch", label: "Renault Oroch", type: "pickup", aliases: ["oroch", "duster oroch", "oroque", "oroqui", "oroki", "orochi", "orok", "orock", "oroc", "oroq", "orochh"] },
  { canonical: "duster", label: "Renault Duster", type: "suv", aliases: ["duster", "daster", "duster authentique", "duster dynamique"] },
  { canonical: "renegade", label: "Jeep Renegade", type: "suv", aliases: ["renegade", "renegad", "renegadee", "renagade", "renegued", "jeep renegade"] },
  { canonical: "onix", label: "Chevrolet Onix", type: "hatch", aliases: ["onix", "onix plus", "onix sedan", "onix hatch", "onis", "unix", "onixx"] },
  { canonical: "strada", label: "Fiat Strada", type: "pickup", aliases: ["strada", "strada cabine dupla", "strada cd", "estrada"] },
  { canonical: "toro", label: "Fiat Toro", type: "pickup", aliases: ["toro", "fiat toro", "tora"] },
  { canonical: "saveiro", label: "Volkswagen Saveiro", type: "pickup", aliases: ["saveiro", "savero", "saveiru"] },
  { canonical: "montana", label: "Chevrolet Montana", type: "pickup", aliases: ["montana", "chevrolet montana"] },
  { canonical: "hilux", label: "Toyota Hilux", type: "pickup", aliases: ["hilux", "hilux sw4"] },
  { canonical: "ranger", label: "Ford Ranger", type: "pickup", aliases: ["ranger", "ford ranger"] },
  { canonical: "s10", label: "Chevrolet S10", type: "pickup", aliases: ["s10", "s 10", "chevrolet s10"] },
  { canonical: "amarok", label: "Volkswagen Amarok", type: "pickup", aliases: ["amarok", "amaroc"] },
  { canonical: "hb20", label: "Hyundai HB20", type: "hatch", aliases: ["hb20", "hb 20", "hb20s"] },
  { canonical: "creta", label: "Hyundai Creta", type: "suv", aliases: ["creta", "cretta", "creta n line", "creta action"] },
  { canonical: "compass", label: "Jeep Compass", type: "suv", aliases: ["compass", "compas", "jeep compass"] },
  { canonical: "tracker", label: "Chevrolet Tracker", type: "suv", aliases: ["tracker", "traker", "chevrolet tracker"] },
  { canonical: "tcross", label: "Volkswagen T-Cross", type: "suv", aliases: ["t cross", "tcross", "t-cross", "volkswagen t cross", "vw t cross"] },
  { canonical: "asx", label: "Mitsubishi ASX", type: "suv", aliases: ["asx", "mitsubishi asx"] },
  { canonical: "fastback", label: "Fiat Fastback", type: "suv", aliases: ["fastback", "fast back", "fiat fastback"] },
  { canonical: "pulse", label: "Fiat Pulse", type: "suv", aliases: ["pulse", "fiat pulse"] },
  { canonical: "ecosport", label: "Ford Ecosport", type: "suv", aliases: ["ecosport", "eco sport", "ford ecosport"] },
  { canonical: "corolla", label: "Toyota Corolla", type: "sedan", aliases: ["corolla", "corola", "toyota corolla"] },
  { canonical: "civic", label: "Honda Civic", type: "sedan", aliases: ["civic", "civc", "honda civic"] },
  { canonical: "cruze", label: "Chevrolet Cruze", type: "sedan", aliases: ["cruze", "cruse", "chevrolet cruze"] },
  { canonical: "argo", label: "Fiat Argo", type: "hatch", aliases: ["argo", "fiat argo"] },
  { canonical: "mobi", label: "Fiat Mobi", type: "hatch", aliases: ["mobi", "fiat mobi"] },
  { canonical: "kwid", label: "Renault Kwid", type: "hatch", aliases: ["kwid", "quid", "renault kwid"] },
  { canonical: "gol", label: "Volkswagen Gol", type: "hatch", aliases: ["gol", "vw gol", "volkswagen gol"] },
  { canonical: "polo", label: "Volkswagen Polo", type: "hatch", aliases: ["polo", "vw polo", "volkswagen polo"] },
  { canonical: "virtus", label: "Volkswagen Virtus", type: "sedan", aliases: ["virtus", "vw virtus", "volkswagen virtus"] },
  { canonical: "kicks", label: "Nissan Kicks", type: "suv", aliases: ["kicks", "kick", "nissan kicks"] },
  { canonical: "city", label: "Honda City", type: "sedan", aliases: ["city", "honda city"] },
  { canonical: "fit", label: "Honda Fit", type: "hatch", aliases: ["fit", "honda fit"] },
  // Modelos comuns que faltavam na lista estatica (o stockSearch ja os referencia em
  // expansoes de marca). Sem alias, dependiam so do match dinamico/LLM. (Fix Antigravity #1.)
  { canonical: "spin", label: "Chevrolet Spin", type: "carro", aliases: ["spin", "chevrolet spin", "espin", "spim", "spinn"] },
  { canonical: "prisma", label: "Chevrolet Prisma", type: "sedan", aliases: ["prisma", "chevrolet prisma", "prizma", "prima"] },
  { canonical: "sandero", label: "Renault Sandero", type: "hatch", aliases: ["sandero", "renault sandero", "sandeiro", "sandeo", "sandera"] },
  { canonical: "yaris", label: "Toyota Yaris", type: "hatch", aliases: ["yaris", "toyota yaris", "iaris", "yariz"] },
  { canonical: "nivus", label: "Volkswagen Nivus", type: "suv", aliases: ["nivus", "volkswagen nivus", "vw nivus", "nivos", "nivuz", "nivius"] },
  { canonical: "fox", label: "Volkswagen Fox", type: "hatch", aliases: ["fox", "vw fox", "volkswagen fox"] },
  { canonical: "voyage", label: "Volkswagen Voyage", type: "sedan", aliases: ["voyage", "vw voyage", "volkswagen voyage", "voiage", "voiagi"] },
];

const KNOWN_BRANDS = [
  "chevrolet", "fiat", "jeep", "renault", "hyundai", "mitsubishi", "volkswagen", "vw", 
  "ford", "toyota", "honda", "citroen", "peugeot", "nissan", "chery", "byd", "gwm"
];

const WEAK_WORDS = new Set([
  "carro", "carros", "veiculo", "veiculos", "tem", "voces", "voce", "estoque",
  "disponivel", "preco", "valor", "anuncio", "instagram", "facebook", "esse",
  "essa", "este", "esta", "sobre", "quero", "queria", "saber", "mais", "de",
  "da", "do", "dos", "das", "um", "uma", "com", "sem", "para", "por", "ate",
  "automatico", "manual", "flex", "gasolina", "diesel", "aut", "mec", "fotos", 
  "foto", "detalhes", "modelo", "versao", "ano", "cor", "km"
]);

// Tokens que NUNCA sao modelo (cor/estado/segmento). Impede o match dinamico de
// confundir "prata"/"novo" como nome de modelo na deteccao por adjacencia de marca.
const NON_MODEL_WORDS = new Set([
  "preto", "preta", "branco", "branca", "prata", "cinza", "grafite", "vermelho", "vermelha",
  "azul", "verde", "dourado", "bege", "marrom", "amarelo", "laranja", "vinho",
  "novo", "nova", "seminovo", "seminova", "usado", "usada", "completo", "completa",
  "barato", "barata", "economico", "economica", "popular", "basico", "lindo", "bonito",
  "conservado", "conservada", "automatico", "manual", "flex",
]);

const REFERENCE_WORDS = /\b(esse|essa|este|esta|aquele|aquela|dele|dela|do\s+\d|da\s+\d|primeiro|primeira|segundo|segunda|terceiro|terceira|quarto|quarta|quinto|quinta|foto|fotos|imagem|imagens|painel|interior|banco|bancos|roda|rodas|traseira|frente|lateral)\b/;
const VEHICLE_WORDS = /\b(carro|carros|veiculo|veiculos|auto|automovel|suv|sedan|hatch|pickup|picape|caminhonete|camionete|moto|motos)\b/;
const AD_WORDS = /\b(anuncio|instagram|facebook|story|post|propaganda|campanha|link)\b/;

function normalizeText(value?: string | null): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_/]/g, " ")
    .replace(/[^\w\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function similarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length <= 3 || right.length <= 3) return 0;
  return 1 - levenshteinDistance(left, right) / Math.max(left.length, right.length);
}

function words(value: string) {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function matchAllVehiclesInText(text?: string | null) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const matchedModels = new Map<string, { vehicle: VehicleAlias; confidence: number; reason: string }>();

  // 1. Aliases pré-definidos
  for (const vehicle of VEHICLE_ALIASES) {
    for (const alias of vehicle.aliases) {
      const normalizedAlias = normalizeText(alias);
      if (!normalizedAlias) continue;
      const direct = new RegExp(`\\b${normalizedAlias.replace(/\s+/g, "\\s+")}\\b`).test(normalized);
      if (direct) {
        const confidence = normalizedAlias === vehicle.canonical ? 0.95 : 0.9;
        if (!matchedModels.has(vehicle.canonical) || confidence > matchedModels.get(vehicle.canonical)!.confidence) {
          matchedModels.set(vehicle.canonical, { vehicle, confidence, reason: `alias:${alias}` });
        }
      }
    }
  }

  // 2. Similaridade fuzzy de 1 token com os aliases
  const tokens = words(normalized);
  for (const vehicle of VEHICLE_ALIASES) {
    for (const alias of vehicle.aliases) {
      const aliasTokens = words(alias);
      if (aliasTokens.length !== 1) continue;
      for (const token of tokens) {
        const score = similarity(token, aliasTokens[0]);
        if (score >= 0.78) {
          const confidence = 0.68 + score * 0.22;
          if (!matchedModels.has(vehicle.canonical) || confidence > matchedModels.get(vehicle.canonical)!.confidence) {
            matchedModels.set(vehicle.canonical, { vehicle, confidence, reason: `fuzzy:${token}->${aliasTokens[0]}` });
          }
        }
      }
    }
  }

  // 3. Detecção dinâmica: MARCA conhecida + palavra de modelo ADJACENTE
  const dynTokens = normalized.split(/\s+/).filter(Boolean);
  const isModelCandidate = (tk: string) =>
    tk.length >= 3 && !WEAK_WORDS.has(tk) && !KNOWN_BRANDS.includes(tk) && !NON_MODEL_WORDS.has(tk);
  for (const brand of KNOWN_BRANDS) {
    const bi = dynTokens.indexOf(brand);
    if (bi === -1) continue;
    const forward = dynTokens.slice(bi + 1).find(isModelCandidate);
    const backward = dynTokens.slice(0, bi).reverse().find(isModelCandidate);
    const modelCandidate = forward || backward;
    if (modelCandidate) {
      const label = `${capitalize(brand)} ${capitalize(modelCandidate)}`;
      const canonical = modelCandidate.toLowerCase();
      if (!matchedModels.has(canonical)) {
        matchedModels.set(canonical, {
          vehicle: {
            canonical,
            label,
            type: inferVehicleType(label) || "carro",
            aliases: [modelCandidate],
          },
          confidence: 0.85,
          reason: `dynamic_brand_match:${brand}:${modelCandidate}`,
        });
      }
    }
  }

  return Array.from(matchedModels.values());
}

export function matchVehicleInText(text?: string | null) {
  const matches = matchAllVehiclesInText(text);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.confidence - a.confidence)[0];
}

function inferVehicleType(text?: string | null) {
  const normalized = normalizeText(text);
  if (/\b(moto|motos|motocicleta|scooter|biz|cg|fan|titan|bros|xre|pcx)\b/.test(normalized)) return "moto";
  if (/\b(picape|pickup|caminhonete|camionete|strada|toro|saveiro|montana|oroch|hilux|ranger|s10|amarok)\b/.test(normalized)) return "pickup";
  if (/\b(suv|renegade|compass|creta|kicks|hrv|tracker|duster|tcross|t cross|fastback|pulse|asx)\b/.test(normalized)) return "suv";
  if (/\b(sedan|corolla|civic|cruze|virtus|versa|logan)\b/.test(normalized)) return "sedan";
  if (/\b(hatch|onix|hb20|argo|kwid|mobi|gol|fox|sandero|polo)\b/.test(normalized)) return "hatch";
  if (VEHICLE_WORDS.test(normalized)) return "carro";
  return null;
}

function hasCurrentSignal(message?: string | null, enrichedMessage?: string | null) {
  const text = normalizeText([message, enrichedMessage].filter(Boolean).join(" "));
  return Boolean(matchVehicleInText(text) || VEHICLE_WORDS.test(text) || AD_WORDS.test(text));
}

function canUseMemoryForReference(message?: string | null) {
  const normalized = normalizeText(message);
  return REFERENCE_WORDS.test(normalized) && !matchVehicleInText(normalized);
}

function memoryVehicle(memory?: PedroV2LeadMemory | null) {
  const dynamicMemory = (memory || {}) as any;
  // ANCORA DE REFERENCIA ("dele", "qual a km", "e a cor"): usa o veiculo REALMENTE
  // apresentado/discutido com o lead, NAO o campo interesse.modelo_desejado — que
  // pode estar contaminado pelo carro de TROCA (ex.: lead diz "tenho um Spin pra
  // dar na troca" e a extracao grava Spin como interesse). O carro que o lead quer
  // e o que foi mostrado (veiculos_apresentados / ultima_foto), entao ele vem 1o.
  const apresentados = Array.isArray(dynamicMemory?.veiculos_apresentados) ? dynamicMemory.veiculos_apresentados : [];
  const presented = apresentados.length > 0
    ? (apresentados[0]?.label || apresentados[0]?.modelo ||
       [apresentados[0]?.marca, apresentados[0]?.modelo].filter(Boolean).join(" "))
    : null;
  return dynamicMemory?.ultima_foto?.veiculo_label ||
    presented ||
    dynamicMemory?.referencia?.ultimo_veiculo_label ||
    memory?.interesse?.modelo_desejado ||
    memory?.referencia?.veiculo_citado ||
    null;
}

export function resolvePedroVehicleTurn(input: {
  message: string;
  enriched_message?: string | null;
  memory?: PedroV2LeadMemory | null;
  ad_context?: any;
  media_context?: any;
}): PedroVehicleResolution {
  const message = input.message || "";
  const enriched = input.enriched_message || "";
  
  const allMatches = [
    ...matchAllVehiclesInText(message),
    ...matchAllVehiclesInText(enriched)
  ];
  
  // Deduplicate matches by canonical model to avoid duplicates
  const uniqueMatchesMap = new Map<string, typeof allMatches[0]>();
  for (const m of allMatches) {
    if (!uniqueMatchesMap.has(m.vehicle.canonical) || m.confidence > uniqueMatchesMap.get(m.vehicle.canonical)!.confidence) {
      uniqueMatchesMap.set(m.vehicle.canonical, m);
    }
  }
  const uniqueMatches = Array.from(uniqueMatchesMap.values());
  const has_multiple_vehicles = uniqueMatches.length > 1;
  const all_matched_models = uniqueMatches.map(m => m.vehicle.label);
  
  const messageMatch = uniqueMatches.sort((a, b) => b.confidence - a.confidence)[0] || null;
  const currentType = inferVehicleType(message) || inferVehicleType(enriched);
  const adVehicle = input.ad_context?.vehicle_query || null;
  const mediaVehicle = input.media_context?.vehicle_query || null;
  const memoryQuery = memoryVehicle(input.memory);
  const currentSignal = hasCurrentSignal(message, enriched);

  if (messageMatch) {
    return {
      has_current_vehicle_signal: true,
      query: messageMatch.vehicle.label,
      canonical_model: messageMatch.vehicle.canonical,
      vehicle_type: messageMatch.vehicle.type || currentType,
      confidence: messageMatch.confidence,
      source: "message",
      reason: messageMatch.reason,
      current_message_overrides_memory: true,
      used_memory: false,
      possible_new_topic: Boolean(memoryQuery && normalizeText(memoryQuery) !== normalizeText(messageMatch.vehicle.label)),
      has_multiple_vehicles,
      all_matched_models,
    };
  }

  if (adVehicle && Number(input.ad_context?.confidence || 0) >= 0.45) {
    const adMatch = matchVehicleInText(adVehicle);
    return {
      has_current_vehicle_signal: true,
      query: adVehicle,
      canonical_model: adMatch?.vehicle.canonical || null,
      vehicle_type: input.ad_context?.vehicle_type || adMatch?.vehicle.type || currentType,
      confidence: Number(input.ad_context?.confidence || 0),
      source: "ad_context",
      reason: "ad_or_link_vehicle_detected",
      current_message_overrides_memory: true,
      used_memory: false,
      possible_new_topic: Boolean(memoryQuery && normalizeText(memoryQuery) !== normalizeText(adVehicle)),
      has_multiple_vehicles,
      all_matched_models,
    };
  }

  if (mediaVehicle && Number(input.media_context?.confidence || 0) >= 0.45) {
    const mediaMatch = matchVehicleInText(mediaVehicle);
    return {
      has_current_vehicle_signal: true,
      query: mediaVehicle,
      canonical_model: mediaMatch?.vehicle.canonical || null,
      vehicle_type: input.media_context?.vehicle_type || mediaMatch?.vehicle.type || currentType,
      confidence: Number(input.media_context?.confidence || 0),
      source: "media_context",
      reason: "media_vehicle_detected",
      current_message_overrides_memory: true,
      used_memory: false,
      possible_new_topic: Boolean(memoryQuery && normalizeText(memoryQuery) !== normalizeText(mediaVehicle)),
      has_multiple_vehicles,
      all_matched_models,
    };
  }

  if (currentSignal && currentType) {
    return {
      has_current_vehicle_signal: true,
      query: currentType,
      canonical_model: null,
      vehicle_type: currentType,
      confidence: 0.62,
      source: "message",
      reason: "current_message_vehicle_type_detected",
      current_message_overrides_memory: true,
      used_memory: false,
      possible_new_topic: Boolean(memoryQuery),
      has_multiple_vehicles,
      all_matched_models,
    };
  }

  if (memoryQuery && canUseMemoryForReference(message)) {
    const memoryMatch = matchVehicleInText(memoryQuery);
    return {
      has_current_vehicle_signal: false,
      query: memoryQuery,
      canonical_model: memoryMatch?.vehicle.canonical || null,
      vehicle_type: input.memory?.interesse?.tipo_veiculo || memoryMatch?.vehicle.type || null,
      confidence: 0.58,
      source: "memory",
      reason: "reference_uses_current_vehicle_memory",
      current_message_overrides_memory: false,
      used_memory: true,
      possible_new_topic: false,
      has_multiple_vehicles,
      all_matched_models,
    };
  }

  return {
    has_current_vehicle_signal: false,
    query: null,
    canonical_model: null,
    vehicle_type: null,
    confidence: 0,
    source: "none",
    reason: "no_vehicle_signal",
    current_message_overrides_memory: false,
    used_memory: false,
    possible_new_topic: false,
    has_multiple_vehicles,
    all_matched_models,
  };
}
