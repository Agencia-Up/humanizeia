import { rankVehiclesV2 } from "./vehicleMatch.ts";
import { fetchRevendaMaisVehicles } from "./revendaMaisStock.ts";

const BNDV_API_URL = "https://api-estoque.azurewebsites.net/graphql";
const DEFAULT_LIMIT = 24;

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
  // Categoria crua da fonte (AUTOMOVEL/MOTO/...). Quando presente (ex.: feed RevendaMais),
  // e sinal AUTORITATIVO de moto. BNDV nao manda -> cai no detector por texto (conservador).
  category?: string | null;
};

export type PedroStockSearchInput = {
  user_id: string;
  query?: string;
  filters?: Record<string, any>;
  limit?: number;
  // Override de dry-run: forca a fonte RevendaMais com esta URL de feed (teste isolado,
  // sem precisar da integracao gravada). Em prod a fonte vem de platform_integrations.
  stock_feed_url?: string | null;
  // Loja vende motos? (capacidade por agente, wa_ai_agents.sells_motorcycles). Default
  // (false/undefined) = car-only -> motos sao removidas do pool ANTES do rank.
  sells_motorcycles?: boolean;
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
    .replace(/\bflontie\b/g, "frontier")
    .replace(/\bfrontie\b/g, "frontier")
    .replace(/\bfronteir\b/g, "frontier")
    .replace(/\bfrontere\b/g, "frontier")
    .replace(/\bdisel\b/g, "diesel")
    .replace(/\boroque\b/g, "oroch")
    .replace(/\boroqui\b/g, "oroch")
    .replace(/\boroki\b/g, "oroch")
    .replace(/\borock\b/g, "oroch")
    .replace(/\boroc\b/g, "oroch")
    .replace(/\bauthen\.?\b/g, "authentique")
    .replace(/\bauthent\.?\b/g, "authentique")
    .replace(/\bauth\b/g, "authentique")
    .replace(/\bh rv\b/g, "hrv")
    .replace(/\bt\s*cross\b/g, "tcross")
    .replace(/\bonix\s+plus\b/g, "onix sedan plus")
    .trim();

  return normalized;
}

const KNOWN_BRANDS = [
  "chevrolet", "fiat", "jeep", "renault", "hyundai", "mitsubishi", "volkswagen", "vw", 
  "ford", "toyota", "honda", "citroen", "peugeot", "nissan", "chery", "byd", "gwm", "mini"
];

const WEAK_WORDS = new Set([
  "carro", "carros", "veiculo", "veiculos", "tem", "voces", "voce", "estoque", "repasse", "repasses",
  "disponivel", "preco", "valor", "anuncio", "instagram", "facebook", "esse",
  "essa", "este", "esta", "sobre", "quero", "queria", "saber", "mais", "de",
  "da", "do", "dos", "das", "um", "uma", "com", "sem", "para", "por", "ate",
  "automatico", "manual", "flex", "gasolina", "diesel", "aut", "mec",
  // CRITERIOS DE PRECO/SEGMENTO (nao sao modelo): "mais economico/barato/popular"
  // = carro mais EM CONTA. Tratados como criterio -> a busca cai no caminho amplo
  // e ordena por PRECO CRESCENTE (mais baratos primeiro). "popular" tambem vira
  // hatch no inferVehicleSubcategory (que le a query crua). Sem isso, viravam
  // termo de modelo (score negativo) e a busca retornava 0 ("nao temos").
  "economico", "economica", "economicos", "economicas", "economico(a)",
  "barato", "barata", "baratos", "baratas", "baratinho", "baratinha",
  "popular", "populares", "basico", "basica", "simples", "conta", "em",
  "barateza", "acessivel", "acessivel", "baixo", "baixa", "custo", "beneficio",
  // conversa/negociacao: nunca sao modelo
  "entrada", "entradas", "pagamento", "financiamento", "financiar", "parcela", "parcelas",
  "troca", "trocar", "tambem", "interessa", "interesse", "informacao", "informacoes",
  "cidade", "loja", "endereco", "qual", "outro", "outra", "opcao", "opcoes",
  // TIPO moto: e palavra de TIPO (tratada em inferRequestedVehicleType), NUNCA modelo. Como WEAK,
  // numa busca "moto"/"quero uma moto" o hasSearch fica false -> cai no early-return que devolve os
  // veiculos do TIPO pedido (as motos) sem exigir score>0 (a moto nao tem bonus de body_type como o
  // SUV, entao no caminho de scoring ela zerava e sumia: "nao temos moto" tendo moto no estoque).
  "moto", "motos", "motocicleta", "motocicletas", "scooter",
]);

// TOKENS DE ATRIBUTO/RUIDO: descrevem cor, carroceria, estado de conservacao ou ANO —
// NUNCA o modelo. O bug (relatorio Antigravity #2): no scoreVehicle, qualquer token que
// nao casa com o cadastro levava -10. Adjetivos como "prata"/"completo"/"conservado"
// zeravam o carro CERTO (ex.: lead pede "onix prata completo" e o Onix do estoque e
// cinza -> -30 -> "nao temos"). Estes tokens NAO entram na penalidade de modelo; quando
// casam, ja pontuam positivo no loop de match; quando nao casam, sao neutros.
const ATTRIBUTE_NOISE_TOKENS = new Set([
  // cores
  "preto", "preta", "branco", "branca", "prata", "prateado", "prateada", "cinza", "grafite",
  "chumbo", "vermelho", "vermelha", "azul", "verde", "dourado", "dourada", "bege", "marrom",
  "amarelo", "amarela", "laranja", "vinho",
  // carroceria / categoria (inclui "moto" — palavra de TIPO, NUNCA modelo: sem isto "moto" no
  // query virava token de busca, não casava o label "Honda CB 500" e ZERAVA a moto -> "não temos
  // moto" sendo que tinha. O tipo moto já é tratado em inferRequestedVehicleType/passesRequested.)
  "hatch", "hatchback", "sedan", "suv", "picape", "pickup", "perua", "utilitario",
  "moto", "motos", "motocicleta", "motocicletas", "scooter",
  // estado / adjetivos de venda (ruido)
  "completo", "completa", "novo", "nova", "seminovo", "seminova", "semi", "usado", "usada",
  "conservado", "conservada", "impecavel", "lindo", "linda", "bonito", "bonita", "top",
  "revisado", "revisada", "repasse", "repasses", "unico", "particular", "inteiro", "inteira", "bem", "muito", "mto",
  // cambio / combustivel (reforco — ja em WEAK_WORDS, repetido por seguranca)
  "automatico", "automatica", "manual", "flex", "gasolina", "diesel", "turbo", "cvt",
]);

// Token de atributo/ruido OU ano (AAAA). O ano e tratado nos filtros numericos, nao
// deve penalizar o modelo no scoring textual.
function isAttributeOrNoiseToken(token: string): boolean {
  // "2008" e MODELO da Peugeot, NAO ano — nunca tratar como ruido, senao "Peugeot 2008" perde
  // o termo de modelo e a busca casa QUALQUER Peugeot (bug ANU-1). Demais modelos numericos
  // (208/308/3008/5008/500) nao casam o regex de ano abaixo.
  if (token === "2008") return false;
  return ATTRIBUTE_NOISE_TOKENS.has(token) || /^(?:19|20)\d{2}$/.test(token);
}

function getQueryTokens(searchText: string) {
  const norm = normalizeText(searchText);
  const originalTokens = norm
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !WEAK_WORDS.has(token));

  const expansions: string[] = [];
  if (/\b(onix|tracker|prisma|cruze|spin)\b/.test(norm)) expansions.push("chevrolet");
  if (/\b(argo|mobi|fastback|pulse|strada|toro)\b/.test(norm)) expansions.push("fiat");
  if (/\b(renegade|compass)\b/.test(norm)) expansions.push("jeep");
  if (/\b(duster|oroch|sandero|kwid)\b/.test(norm)) expansions.push("renault");
  if (/\b(creta|hb20)\b/.test(norm)) expansions.push("hyundai");
  if (/\basx\b/.test(norm)) expansions.push("mitsubishi");
  if (/\becosport\b/.test(norm)) expansions.push("ford");
  if (/\b(cooper|mini)\b/.test(norm)) expansions.push("mini");
  if (/\b(corolla|yaris)\b/.test(norm)) expansions.push("toyota");
  if (/\b(civic|city|fit)\b/.test(norm)) expansions.push("honda");
  if (/\b(kicks|frontier)\b/.test(norm)) expansions.push("nissan");
  if (/\b(polo|virtus|nivus|tcross|fox|gol|voyage)\b/.test(norm)) expansions.push("volkswagen vw");

  const expansionTokens = expansions
    .join(" ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !originalTokens.includes(token));

  return { originalTokens, expansionTokens };
}

function searchTokens(value?: string | null) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !WEAK_WORDS.has(token));
}

function cleanVehiclePart(value?: string | number | null) {
  return String(value || "")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function removeDuplicatedModelFromVersion(model: string, version: string) {
  const normalizedModel = normalizeText(model);
  const normalizedVersion = normalizeText(version);
  if (!normalizedModel || !normalizedVersion.startsWith(normalizedModel)) return version;
  const modelWords = normalizedModel.split(/\s+/).filter(Boolean).length;
  const versionWords = version.split(/\s+/).filter(Boolean);
  return versionWords.slice(modelWords).join(" ").trim() || version;
}

function cleanVehicleLabel(vehicle: BndvVehicle) {
  const mark = cleanVehiclePart(vehicle.markName);
  const model = cleanVehiclePart(vehicle.modelName);
  const version = removeDuplicatedModelFromVersion(model, cleanVehiclePart(vehicle.versionName));
  return [mark, model, version].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
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

export function getVehicleSubcategory(vehicle: BndvVehicle): "hatch" | "sedan" | "suv" | "pickup" | "unknown" {
  const model = normalizeText(vehicle.modelName);
  const version = normalizeText(vehicle.versionName);
  const text = `${model} ${version}`;

  if (/\b(hilux|s10|ranger|amarok|toro|frontier|triton|l200|strada|saveiro|montana|oroch|maverick|ram|hoggar|courier|dakota|picape|pickup|caminhonete|camionete)\b/i.test(text)) {
    return "pickup";
  }
  // SUV/crossover — "corolla cross" e "c4 cactus" ANTES do sedan/hatch pra nao cair como corolla/c3.
  if (/\b(compass|renegade|creta|kicks|hrv|wrv|wr-v|cr-v|crv|tracker|tcross|t-cross|nivus|fastback|pulse|tiggo|sw4|ecosport|duster|asx|pajero|2008|3008|5008|corolla cross|aircross|c4 cactus|cactus|captur|territory|commander|taos|tiguan|rav4|kona|sportage|tucson|bronco|outlander|trailblazer|haval|song|forester|suv|utilitario)\b/i.test(text)) {
    return "suv";
  }
  if (/\b(plus|sedan|sedã|virtus|voyage|prisma|cronos|grand siena|logan|corolla|civic|city|sentra|versa|jetta|cruze|cobalt|classic|fluence|accord|altima|onix sedan|yaris sedan)\b/i.test(text)) {
    return "sedan";
  }
  if (/\b(hatch|hatchback|polo|argo|mobi|kwid|c3|gol|fox|sandero|up|fit|peugeot 208|208|207|mini|cooper|march|clio|celta|palio|uno|agile|punto|i30|golf|308|hb20|onix)\b/i.test(text)) {
    if (/\b(plus|sedan|sedã|hb20s)\b/i.test(text)) {
      return "sedan";
    }
    return "hatch";
  }
  return "unknown";
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

  const subcat = getVehicleSubcategory(vehicle);
  if (subcat === "pickup") {
    indexed += " picape caminhonete camionete pickup";
  } else if (subcat === "suv") {
    indexed += " suv utilitario";
  } else if (subcat === "sedan") {
    indexed += " sedan plus";
  } else if (subcat === "hatch") {
    indexed += " hatch popular";
  }
  return indexed;
}

function inferRequestedVehicleType(filters: Record<string, any>): "carro" | "moto" | "qualquer" {
  const explicit = normalizeText(filters?.tipo_veiculo || filters?.tipo || filters?.categoria);
  // NAO usa o blob cru do anuncio (ad_context/contexto_anuncio): o texto do Facebook
  // traz marca/modelo/versao de OUTROS carros do anuncio e virava ruido que filtrava
  // o estoque errado. O sinal do veiculo ja vem estruturado em tipo_veiculo/query/modelo.
  const searchText = normalizeText([
    explicit,
    filters?.query,
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

function inferVehicleSubcategory(filters: Record<string, any>): "hatch" | "sedan" | "suv" | "pickup" | "qualquer" {
  // NAO le filters.body_type aqui DE PROPOSITO: body_type (carroceria que o lead digitou)
  // e sinal de RANKING (scoreVehicle +40/-25), NUNCA de eliminacao. Esta funcao alimenta
  // passesRequestedVehicleType, que DESCARTA veiculos — e o lead nomeando "polo hatch" NAO
  // pode sumir com o Polo Sedan (fix v61). A categoria pura ("quero um sedan") ja e captada
  // por filters.query/tipo_veiculo abaixo, entao body_type aqui seria redundante e perigoso.
  const explicit = normalizeText(filters?.tipo_veiculo || filters?.tipo || filters?.categoria || filters?.subcategoria);
  // PRECEDENCIA do sinal estruturado: se o tipo do veiculo ja diz a subcategoria,
  // usa ele direto, antes de olhar texto livre. (Sem isso, o blob do anuncio com
  // "Sedan" ganhava do tipo_veiculo "hatch" e zerava a busca -> "nao temos".)
  if (/\b(suv|utilitario|utilitarios)\b/.test(explicit)) return "suv";
  if (/\b(sedan|sedans|seda|sedas|tres volumes|3 volumes)\b/.test(explicit)) return "sedan";
  if (/\b(hatch|hatches|hatchback|hatchbacks)\b/.test(explicit)) return "hatch";
  if (/\b(pickup|pickups|picape|picapes|caminhonete|caminhonetes|camionete|camionetes)\b/.test(explicit)) return "pickup";
  // BUG CRITICO corrigido: NAO usar o blob cru do anuncio (ad_context/contexto_anuncio).
  // O texto do Facebook costuma citar "Polo Sedan 1.6 2013 ... Polo Sedan 1.0 2018" e a
  // palavra "Sedan" fazia o agente exigir sedan e DESCARTAR os Polos hatch que existem no
  // estoque -> 0 resultados -> "nao temos" (sendo que tinha o carro). Usa so o texto limpo.
  const searchText = normalizeText([
    filters?.query,
    filters?.modelo,
    filters?.modelo_desejado,
  ].filter(Boolean).join(" "));

  if (/\b(suv|utilitario|utilitarios)\b/.test(searchText)) {
    return "suv";
  }
  if (/\b(sedan|sedans|plus|sedã|sedãs|tres volumes|3 volumes)\b/.test(searchText)) {
    return "sedan";
  }
  if (/\b(hatch|hatches|hatchback|hatchbacks|popular|populares)\b/.test(searchText)) {
    return "hatch";
  }
  if (/\b(pickup|pickups|picape|picapes|caminhonete|caminhonetes|camionete|camionetes)\b/.test(searchText)) {
    return "pickup";
  }
  return "qualquer";
}

function isLikelyMotorcycle(vehicle: BndvVehicle) {
  // 1) Sinal AUTORITATIVO: categoria da fonte (feed RevendaMais traz "MOTO"). Pega ex.: Honda
  //    CB 500F sem precisar arriscar o regex de texto (CB colide com nada de carro, mas o
  //    detector por texto e proposital-conservador).
  if (vehicle.category && /\bmoto/i.test(String(vehicle.category))) return true;
  // 2) Fallback por texto (fontes sem categoria, ex.: BNDV). SO marca + modelo. NUNCA a
  //    versao/trim: nomes de moto colidem com TRIMS de carro — ex.: Corolla Cross "XRE 2.0"
  //    batia com a moto Honda "XRE 300" e o Corolla virava "moto", sendo EXCLUIDO de buscas
  //    de carro. Uma moto de verdade traz o nome no modelName (Honda CG/Biz/XRE...).
  const text = normalizeText([vehicle.markName, vehicle.modelName].filter(Boolean).join(" "));
  return /\b(yamaha|kawasaki|shineray|harley|dafra|triumph|ducati|ktm|bajaj|haojue|biz|cg|fan|titan|bros|xre|pcx|nmax|fazer|factor|lander|ybr|twister|crosser|hornet|scooter)\b/.test(text);
}

export function passesRequestedVehicleType(vehicle: BndvVehicle, filters: Record<string, any>, hasModelQuery = false) {
  const requestedType = inferRequestedVehicleType(filters);
  if (requestedType === "moto") {
    return isLikelyMotorcycle(vehicle);
  }
  if (requestedType === "carro") {
    if (isLikelyMotorcycle(vehicle)) return false;
  }
  // MOTO só aparece quando a pessoa QUER moto (decisão do dono): em busca de TIPO moto
  // (requestedType="moto", acima) OU quando o lead NOMEIA a moto (hasModelQuery, ex.: "Honda CB 500").
  // Num browse GENÉRICO (qualquer, sem modelo) a moto NÃO entra — não se mistura a moto com os carros.
  if (requestedType === "qualquer" && !hasModelQuery && isLikelyMotorcycle(vehicle)) {
    return false;
  }

  // SUBCATEGORIA (hatch/sedan/suv/pickup) so e filtro RIGIDO em busca POR CATEGORIA.
  // BUG (lead "quero um polo 2013"): "polo" INFERE hatch (o modelo Polo e listado como
  // hatch), e esse filtro EXCLUIA o Polo SEDAN 2013 que existe no estoque -> "nao temos".
  // Quando o lead NOMEIA um MODELO, o match por modelo MANDA: o Polo Sedan tambem e um
  // "polo" que o lead quer. A categoria inferida vira so preferencia de ranking (scoreVehicle),
  // nunca exclui. So filtra de verdade quando NAO ha modelo especifico (busca por categoria).
  if (!hasModelQuery) {
    const requestedSubcat = inferVehicleSubcategory(filters);
    if (requestedSubcat !== "qualquer") {
      const vehicleSubcat = getVehicleSubcategory(vehicle);
      if (vehicleSubcat !== "unknown" && vehicleSubcat !== requestedSubcat) {
        return false;
      }
    }
  }

  return true;
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

// Texto usado SO para scoring/seleção de modelo. NAO inclui o blob cru do
// anuncio (ad_context/contexto_anuncio): esse texto do Facebook (icom, motors,
// story_fbid, numeros...) virava termos-ruido que a penalidade de -10/termo
// derrubava o score do carro certo a 0. O sinal do veiculo ja vem estruturado
// em query/marca/modelo/versao. Fallback para o texto completo se nao houver
// sinal estruturado (preserva comportamento antigo nesse caso).
function buildScoringText(filters: Record<string, any>) {
  const clean = normalizeText([
    filters?.query,
    filters?.marca,
    filters?.modelo,
    filters?.modelo_desejado,
    filters?.versao,
    filters?.cor,
    filters?.combustivel,
    filters?.cambio,
    filters?.ano_min && filters?.ano_min === filters?.ano_max ? String(filters.ano_min) : "",
  ].filter(Boolean).join(" "));
  return clean || buildSearchText(filters);
}

function detectDynamicModelTerms(filters: Record<string, any>): string[] {
  const searchText = buildScoringText(filters);
  if (!searchText) return [];
  const tokens = searchTokens(searchText);
  // Exclui marcas E atributos: o primeiro modelTerm vira o filtro estrito de modelo
  // (vehicleMatchesStrictModel). Sem isso, "prata onix" usava "prata" como modelo e
  // excluia o Onix que nao fosse prata. (Fix relatorio Antigravity #2.)
  return tokens.filter((token) => !KNOWN_BRANDS.includes(token) && !isAttributeOrNoiseToken(token));
}

function vehicleMatchesStrictModel(vehicle: BndvVehicle, modelTerms: string[]) {
  if (modelTerms.length === 0) return true;
  const indexed = buildIndexedText(vehicle);
  const primaryModelTerm = modelTerms[0];
  return indexed.includes(primaryModelTerm);
}

export function scoreVehicle(vehicle: BndvVehicle, filters: Record<string, any>) {
  const searchText = buildScoringText(filters);
  if (!searchText) return { score: 1, matchedTokens: [] as string[] };

  const { originalTokens, expansionTokens } = getQueryTokens(searchText);
  const indexed = buildIndexedText(vehicle);
  const indexedTokens = searchTokens(indexed);
  const matchedTokens: string[] = [];
  let score = 0;

  for (const token of originalTokens) {
    if (indexed.includes(token)) {
      matchedTokens.push(token);
      score += token.length <= 3 ? 5 : 10;
      continue;
    }
    if (indexedTokens.some((candidate) => tokenSimilarity(candidate, token) >= 0.84)) {
      matchedTokens.push(token);
      score += 4;
    }
  }

  for (const token of expansionTokens) {
    if (indexed.includes(token)) {
      score += 0.1;
      continue;
    }
    if (indexedTokens.some((candidate) => tokenSimilarity(candidate, token) >= 0.84)) {
      score += 0.05;
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

  // SO tokens de MODELO entram na penalidade -10 (discriminam o carro certo do errado).
  // Atributos (cor/carroceria/estado/ano) ficam de fora: ja pontuaram positivo acima se
  // casaram; aqui nao podem zerar o modelo correto. (Fix relatorio Antigravity #2.)
  const modelTerms = originalTokens.filter((token) => !KNOWN_BRANDS.includes(token) && !isAttributeOrNoiseToken(token));
  for (const term of modelTerms) {
    if (model.includes(term)) {
      score += 15;
    } else if (indexed.includes(term)) {
      score += 5;
    } else {
      score -= 10;
    }
  }
  // Atributo que CASA (cor/cambio/carroceria certos) = leve bonus de desempate, nunca penalidade.
  const attributeTerms = originalTokens.filter((token) => !KNOWN_BRANDS.includes(token) && isAttributeOrNoiseToken(token));
  for (const term of attributeTerms) {
    if (indexed.includes(term)) score += 3;
  }

  for (const modelToken of searchTokens(model)) {
    if (originalTokens.includes(modelToken)) score += 5;
  }

  // PREFERENCIA FORTE por CARROCERIA EXPLICITA (o lead DIGITOU 'hatch'/'sedan'/'suv'/
  // 'pickup'). filters.body_type so e preenchido (no orchestrator) quando o lead ESCREVEU
  // a palavra — carroceria so INFERIDA do modelo NUNCA chega aqui, entao 'quero um polo'
  // segue trazendo o Polo Sedan (fix v61 intacto). +40 sobe a carroceria pedida ao 1o
  // lugar; -25 empurra a outra pra baixo SEM eliminar (a outra ainda aparece, abaixo).
  const explicitBody = normalizeText(filters?.body_type || "");
  if (explicitBody && ["hatch", "sedan", "suv", "pickup"].includes(explicitBody)) {
    const vSub = getVehicleSubcategory(vehicle);
    if (vSub !== "unknown") {
      score += (vSub === explicitBody) ? 40 : -25;
    }
  }

  const requiredTokens = Math.min(2, originalTokens.length);
  if (originalTokens.length > 0 && matchedTokens.length < requiredTokens && score < 5) score = 0;
  return { score, matchedTokens };
}

function passesNumericFilters(vehicle: BndvVehicle, filters: Record<string, any>, relaxed = false, allowPriceless = false) {
  const price = Number(vehicle.saleValue || 0);
  // Carro sem preco (R$0 / null) e ERRO DE CADASTRO do lojista, NAO "veiculo invalido".
  // Quando o lead NOMEIA o modelo (allowPriceless=true), o carro NAO pode sumir so por
  // isso — caso real Cruze 2014 saleValue=0: o agente negava um carro que EXISTE = perda
  // de venda. Em busca por CATEGORIA (sem modelo) o R$0 segue escondido (ruido de cadastro).
  if (price <= 0 && !allowPriceless) return false;
  // Com TETO EXPLICITO e DURO, carro SEM preco tambem sai: nao da pra garantir que cabe no
  // orcamento e quase sempre esta MUITO acima (caso real "onix ate 30 mil" -> Onix 2020 "a
  // confirmar", valor real ~R$60k, aparecendo como unica opcao). So vale com hard_price_ceiling.
  if (price <= 0 && filters?.hard_price_ceiling && Number(filters?.preco_max) > 0) return false;
  // TETO DE PRECO EXPLICITO do lead ("ate 30 mil") e HARD: vale ATE no modo relaxed e ATE
  // p/ modelo nomeado. Sem isso, "tem onix ate 30 mil?" relaxava e mostrava Onix de R$64-76k
  // (mais que o dobro do orcamento) — constrangedor. Carro sem preco (R$0) nao da pra comparar,
  // entao nao e cortado aqui (segue o tratamento de allowPriceless acima).
  if (filters?.hard_price_ceiling && price > 0 && Number(filters?.preco_max) > 0 && price > Number(filters.preco_max)) {
    return false;
  }
  if (relaxed) return true;
  const year = Number(vehicle.year || 0);
  const mileage = Number(vehicle.km || 0);
  return (
    (!filters?.ano_min || year >= Number(filters.ano_min)) &&
    (!filters?.ano_max || year <= Number(filters.ano_max)) &&
    // teto de preco NAO se aplica a carro sem preco (nao da pra comparar valor inexistente).
    (!filters?.preco_max || price <= 0 || price <= Number(filters.preco_max)) &&
    // PISO de preco (faixa "de 60 a 80 mil"): o lead disse o MINIMO. Sem isso o motor mostrava
    // carros ABAIXO do piso (ex.: Kwid R$55.990 quando o lead pediu a partir de 60 mil) =
    // constrangedor. Mesma regra do preco_max: nao se aplica a carro sem preco.
    (!filters?.preco_min || price <= 0 || price >= Number(filters.preco_min)) &&
    (!filters?.km_max || mileage <= Number(filters.km_max))
  );
}

export function rankVehicles(vehicles: BndvVehicle[], filters: Record<string, any>) {
  // marca_required (Pilar B): marca pedida EXPLICITAMENTE ("so se for Honda") = filtro DURO.
  // Sem isso, o bonus de carroceria (body_type +40) mantem sedans de OUTRAS marcas ACIMA da
  // marca pedida e a busca mostra Chevrolet/Fiat ignorando a Honda que existe (lead 99627-7728).
  // Aplica em TODOS os caminhos (estrito e relaxado) zerando o pool fora da marca.
  const _marcaReq = (filters as any)?.marca_required ? normalizeText(String(filters.marca || "")) : "";
  const pool = !_marcaReq ? vehicles : vehicles.filter((v) => {
    const mk = normalizeText(String(v.markName || ""));
    return !!mk && (mk.includes(_marcaReq) || _marcaReq.includes(mk));
  });
  const modelTerms = detectDynamicModelTerms(filters);
  const hasModelQuery = modelTerms.length > 0;
  // Lead nomeou o modelo -> carro do modelo sem preco (erro de cadastro) NAO pode sumir.
  const allowPriceless = hasModelQuery;
  const typedVehicles = pool
    .filter((vehicle) => passesRequestedVehicleType(vehicle, filters, hasModelQuery))
    .filter((vehicle) => vehicleMatchesStrictModel(vehicle, modelTerms));
  const searchText = buildSearchText(filters);
  const hasSearch = searchTokens(searchText).length > 0 ||
    (!!filters.modelo && !WEAK_WORDS.has(normalizeText(filters.modelo))) ||
    (!!filters.marca && !WEAK_WORDS.has(normalizeText(filters.marca)));

  if (!hasSearch) {
    return typedVehicles
      .filter((vehicle) => passesNumericFilters(vehicle, filters, false, allowPriceless))
      .map((vehicle) => ({ vehicle, score: 1, matchedTokens: [] as string[], relaxed: false }));
  }

  const ranked = typedVehicles
    .map((vehicle) => ({ vehicle, ...scoreVehicle(vehicle, filters), relaxed: false }))
    .filter((item) => item.score > 0 && passesNumericFilters(item.vehicle, filters, false, allowPriceless))
    .sort((left, right) => right.score - left.score);

  if (ranked.length > 0) return ranked;
  if (modelTerms.length > 0) {
    // Modelo rigido encontrado, mas filtros numericos podem ter eliminado a unidade real.
    return typedVehicles
      .map((vehicle) => ({ vehicle, ...scoreVehicle(vehicle, filters), relaxed: true }))
      .filter((item) => item.score > 0 && passesNumericFilters(item.vehicle, filters, true, allowPriceless))
      .sort((left, right) => right.score - left.score);
  }

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
  const fotos = pictures.map((item: any) => item.url).filter(Boolean).slice(0, 24);
  return {
    marca: vehicle.markName || null,
    modelo: vehicle.modelName || null,
    versao: vehicle.versionName || null,
    ano: vehicle.year || null,
    km: vehicle.km || null,
    preco: Number(vehicle.saleValue) > 0 ? vehicle.saleValue : null,
    // Carro sem preco cadastrado (R$0/null) — sinaliza pro reply dizer "confirmar valor"
    // em vez de mostrar R$0 ou negar (o carro EXISTE).
    preco_a_confirmar: !(Number(vehicle.saleValue) > 0),
    cor: vehicle.color || null,
    combustivel: vehicle.fuelName || null,
    cambio: vehicle.transmissionName || null,
    label: cleanVehicleLabel(vehicle),
    principal_image: principalImage,
    fotos,
    images_count: pictures.length,
    match_score: rank.score,
    matched_tokens: rank.matchedTokens,
    relaxed_match: rank.relaxed,
  };
}

// Rank + sort + map compartilhado por TODAS as fontes de estoque (BNDV, RevendaMais...).
// Recebe veiculos JA no shape BndvVehicle e devolve o resultado padrao do searchPedroStock,
// para que grounding/preco/fotos/scoring funcionem IDENTICOS independente da fonte.
function rankSortMapStock(vehicles: BndvVehicle[], filters: Record<string, any>, input: PedroStockSearchInput) {
  // Capacidade por agente: loja car-only (default) NUNCA mostra moto, nem em busca ampla.
  // Loja que vende moto (sells_motorcycles=true) mantem as motos; a relevancia por tipo
  // ("tem moto?" vs "tem suv?") ja e tratada em passesRequestedVehicleType.
  const pool = input.sells_motorcycles === true
    ? vehicles
    : vehicles.filter((v) => !isLikelyMotorcycle(v));
  // B3 sombra: motor de matching novo so via override de dry-run (match_engine='v2'); prod = legado.
  const useNewMatch = String((input as any).match_engine || "").toLowerCase() === "v2";
  const rankedRaw = useNewMatch ? rankVehiclesV2(pool as any, filters) : rankVehicles(pool, filters);
  const ranked = (rankedRaw as Array<{ vehicle: any; score: number; matchedTokens: string[]; relaxed: boolean }>).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    // Carro sem preco (R$0/null) vai pro FIM do desempate (Infinity), nunca pro topo.
    const leftPrice = Number(left.vehicle.saleValue) > 0 ? Number(left.vehicle.saleValue) : Number.POSITIVE_INFINITY;
    const rightPrice = Number(right.vehicle.saleValue) > 0 ? Number(right.vehicle.saleValue) : Number.POSITIVE_INFINITY;
    if (leftPrice !== rightPrice) return leftPrice - rightPrice;
    return Number(right.vehicle.year || 0) - Number(left.vehicle.year || 0);
  });
  const limit = Math.max(1, Math.min(Number(input.limit || DEFAULT_LIMIT), 30));
  const items = ranked.slice(0, limit).map((rank) => toPedroVehicle(rank.vehicle, rank));
  return {
    success: true,
    total: ranked.length,
    items,
    filters_used: filters,
    match_engine_used: useNewMatch ? "v2" : "legacy",
    response_guidance: ranked.length > 0
      ? "Ha candidatos compativeis no estoque. Se nao for exato, apresente como opcao proxima e confirme o detalhe."
      : "Nenhum candidato compativel encontrado mesmo com busca ampla. Nao invente disponibilidade.",
  };
}

// Filtros normalizados (query + limpeza de palavras fracas). Compartilhado entre fontes.
function buildStockSearchFilters(input: PedroStockSearchInput): Record<string, any> {
  const filters: Record<string, any> = {
    ...(input.filters || {}),
    query: input.query || input.filters?.query || input.filters?.modelo || "",
  };
  if (filters.modelo && WEAK_WORDS.has(normalizeText(filters.modelo))) filters.modelo = undefined;
  if (filters.marca && WEAK_WORDS.has(normalizeText(filters.marca))) filters.marca = undefined;
  return filters;
}

export async function searchPedroStock(supabase: any, input: PedroStockSearchInput) {
  const filters = buildStockSearchFilters(input);

  // ── FONTE DE ESTOQUE POR CLIENTE ───────────────────────────────────────────
  // RevendaMais (feed JSON da loja) quando configurada p/ o cliente OU via override de
  // dry-run (input.stock_feed_url). Senao, BNDV (GraphQL, default). Em prod a fonte vem
  // de platform_integrations (platform='revendamais', feed_url nas credenciais).
  let revendaFeedUrl: string | null = (input.stock_feed_url || "").toString().trim() || null;
  if (!revendaFeedUrl) {
    const { data: rm } = await supabase
      .from("platform_integrations")
      .select("api_key_encrypted, is_active")
      .eq("user_id", input.user_id)
      .eq("platform", "revendamais")
      .maybeSingle();
    if (rm?.is_active) {
      const cred = parseCredentials(rm.api_key_encrypted) as Record<string, any>;
      revendaFeedUrl = String(cred.feed_url || cred.url || cred.api_token || "").trim() || null;
    }
  }
  if (revendaFeedUrl) {
    let vehicles: BndvVehicle[];
    try {
      vehicles = await fetchRevendaMaisVehicles(revendaFeedUrl) as unknown as BndvVehicle[];
    } catch (err) {
      return { success: false, total: 0, items: [], error: `RevendaMais: ${String((err as any)?.message || err)}` };
    }
    return rankSortMapStock(vehicles, filters, input);
  }

  // ── BNDV (default) ──────────────────────────────────────────────────────────
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
  return rankSortMapStock(vehicles, filters, input);
}
