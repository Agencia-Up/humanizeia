// ============================================================================
// vehicleMatch.ts — MOTOR DE MATCHING DE VEÍCULOS (B3, a "virada definitiva")
// ----------------------------------------------------------------------------
// PRINCÍPIO (anti-remendo): em vez de manter listas de typo à mão (flontie->frontier,
// disel->diesel, ...), casamos o termo do lead contra os MODELOS/MARCAS que ESTE lojista
// REALMENTE tem no estoque, por SIMILARIDADE (trigrama + distância de edição). O próprio
// inventário é o dicionário — generaliza pra qualquer typo de qualquer modelo de qualquer loja.
//
// O falso-positivo clássico (preta->Creta, entrada->Strada) é resolvido por um LÉXICO FINITO
// de palavras que NÃO são modelo (cores, pagamento, saudação, genéricas, atributos). Esse
// conjunto é estável e fechado — NÃO cresce a cada typo novo.
//
// Saída compatível com o rankVehicles legado: { vehicle, score, matchedTokens, relaxed }[].
// ============================================================================

export interface MatchVehicle {
  markName?: string | null;
  modelName?: string | null;
  versionName?: string | null;
  year?: number | null;
  km?: number | null;
  saleValue?: number | null;
  color?: string | null;
  fuelName?: string | null;
  transmissionName?: string | null;
  [k: string]: any;
}

export interface MatchFilters {
  query?: string | null;
  marca?: string | null;
  modelo?: string | null;
  versao?: string | null;
  tipo_veiculo?: string | null;
  body_type?: string | null;
  preco_max?: number | null;
  preco_min?: number | null;
  ano_min?: number | null;
  ano_max?: number | null;
  km_max?: number | null;
  stock_broad?: boolean;
  ad_context?: any;
  contexto_anuncio?: any;
  [k: string]: any;
}

export interface MatchResult {
  vehicle: MatchVehicle;
  score: number;
  matchedTokens: string[];
  relaxed: boolean;
}

// Limiar de similaridade pra considerar que um token do lead "é" um modelo do estoque.
// 0.72 pega flontie/frontier (0.75), unos/uno (0.75), frontie/frontier (0.875) sem deixar
// passar palavras distintas. Cores/pagamento nem chegam aqui (saem no léxico).
export const MODEL_SIM_THRESHOLD = 0.72;

// ── normalização canônica (acento/caixa/separadores). SEM aliases de typo. ──
// Pontos, hífens e tudo que não é letra/dígito viram espaço: "unos.200.13" => "unos 200 13".
export function normVehText(value?: string | null): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── LÉXICO FINITO de palavras que NÃO são modelo (estável, fechado) ──
const COLORS = [
  "preto", "preta", "branco", "branca", "prata", "prateado", "prateada", "cinza", "vermelho",
  "vermelha", "azul", "verde", "amarelo", "amarela", "dourado", "dourada", "bege", "marrom",
  "laranja", "vinho", "grafite", "fume", "perola",
];
const PAYMENT = [
  "entrada", "financiamento", "financiar", "financiado", "financiada", "parcela", "parcelas",
  "parcelado", "avista", "vista", "troca", "trocar", "quitacao", "sinal", "credito", "boleto",
  "pix", "dinheiro", "banco", "aprovado", "aprovacao", "score", "cpf", "simulacao", "consorcio",
];
const GREET_FILLER = [
  "bom", "boa", "dia", "tarde", "noite", "ola", "oi", "obrigado", "obrigada", "favor", "amigo",
  "amiga", "voce", "vcs", "gostei", "gostaria", "queria", "quero", "tenho", "tem", "ter", "sobre",
  "saber", "mais", "ver", "aqui", "esse", "essa", "isso", "aquele", "interesse", "informacao",
  "informacoes", "lindo", "linda", "lindos", "lindas", "maravilhoso", "maravilhosa", "valor", "preco",
];
const GENERIC = [
  "carro", "carros", "veiculo", "veiculos", "automovel", "automoveis", "auto", "autos", "outro",
  "outros", "outra", "outras", "algum", "alguns", "alguma", "algumas", "qualquer", "opcao",
  "opcoes", "modelo", "modelos", "disponivel", "disponiveis", "estoque", "novo", "novos", "usado",
  "usados", "seminovo", "seminovos",
];
// Atributos (combustível/câmbio/carroceria/specs). Carroceria fica aqui (vira filtro de TIPO,
// não de modelo). Atenção: NENHUM nome de modelo real pode entrar neste conjunto.
const ATTRIBUTES = [
  "flex", "gasolina", "alcool", "diesel", "disel", "automatico", "manual", "mecanico", "mec",
  "aut", "completo", "cambio", "motor", "porta", "portas", "valvulas", "turbo", "cabine", "dupla",
  "simples", "hatch", "sedan", "suv", "pickup", "picape", "caminhonete", "camionete", "utilitario",
  "moto", "motos", "motocicleta", "scooter",
];
export const NON_MODEL_WORDS = new Set<string>([
  ...COLORS, ...PAYMENT, ...GREET_FILLER, ...GENERIC, ...ATTRIBUTES,
]);

// Palavras de TIPO/carroceria (pra filtro de categoria, separadas do modelo).
const BODY_WORDS: Record<string, "hatch" | "sedan" | "suv" | "pickup"> = {
  hatch: "hatch", sedan: "sedan", suv: "suv", utilitario: "suv",
  pickup: "pickup", picape: "pickup", caminhonete: "pickup", camionete: "pickup",
};
const MOTO_WORDS = new Set(["moto", "motos", "motocicleta", "scooter"]);

// ── similaridade ──
function trigrams(s: string): Set<string> {
  const t = ` ${s} `;
  const g = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
  return g;
}
function diceSim(a: string, b: string): number {
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const g of Array.from(ta)) if (tb.has(g)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur.slice();
  }
  return prev[b.length];
}
function levRatio(a: string, b: string): number {
  if (a === b) return 1;
  const m = Math.max(a.length, b.length);
  return m ? 1 - levenshtein(a, b) / m : 0;
}
// Similaridade combinada: melhor dos dois sinais (edição pega troca/inserção; trigrama pega
// transposição/embaralhamento). Pra tokens curtos (<3) ou numéricos, só conta igualdade exata.
export function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return 0; // números: só exato (não confundir 200/207)
  return Math.max(levRatio(a, b), diceSim(a, b));
}

// ── tokens ──
function alphaTokens(s: string): string[] {
  return normVehText(s).split(" ").filter((t) => t && /[a-z]/.test(t));
}
function numberTokens(s: string): string[] {
  return normVehText(s).split(" ").filter((t) => /^\d{2,4}$/.test(t));
}

// Vocabulário de MODELOS/MARCAS reais do estoque (tokens alfabéticos, len>=3, fora do léxico).
function buildVocab(vehicles: MatchVehicle[]): Set<string> {
  const vocab = new Set<string>();
  for (const v of vehicles) {
    for (const tok of alphaTokens(`${v.markName || ""} ${v.modelName || ""} ${v.versionName || ""}`)) {
      if (tok.length >= 3 && !NON_MODEL_WORDS.has(tok)) vocab.add(tok);
    }
  }
  return vocab;
}

// Conjunto de MARCAS reais do estoque (tokens dos markName). Serve pra distinguir um token de
// MARCA ("nissan") de um token de MODELO ("frontier"): se o lead nomeou um modelo e o carro NÃO
// tem esse modelo, ele sai — mesmo casando a marca ("nissan frontier" não traz o Nissan Kicks).
function buildBrands(vehicles: MatchVehicle[]): Set<string> {
  const brands = new Set<string>();
  for (const v of vehicles) {
    for (const tok of alphaTokens(`${v.markName || ""}`)) {
      if (tok.length >= 3 && !NON_MODEL_WORDS.has(tok)) brands.add(tok);
    }
  }
  return brands;
}

// Um token do lead "é modelo" se for similar (>= limiar) a ALGUM token do vocabulário do estoque.
function isRealModelToken(token: string, vocab: Set<string>): boolean {
  if (vocab.has(token)) return true;
  for (const v of Array.from(vocab)) if (tokenSim(token, v) >= MODEL_SIM_THRESHOLD) return true;
  return false;
}

// Texto/filtros do lead -> tokens candidatos a modelo (alfabéticos, fora do léxico de não-modelo).
function queryModelTokens(filters: MatchFilters): string[] {
  const raw = [filters.query, filters.modelo, filters.marca, filters.versao]
    .filter(Boolean).join(" ");
  const out: string[] = [];
  for (const tok of alphaTokens(raw)) {
    if (tok.length >= 3 && !NON_MODEL_WORDS.has(tok)) out.push(tok);
  }
  return Array.from(new Set(out));
}

function requestedType(filters: MatchFilters): { kind: "carro" | "moto" | "qualquer"; body: string | null } {
  const text = normVehText([filters.tipo_veiculo, filters.body_type, filters.query, filters.modelo].filter(Boolean).join(" "));
  let body: string | null = null;
  let moto = false;
  for (const w of text.split(" ")) {
    if (BODY_WORDS[w]) body = BODY_WORDS[w];
    if (MOTO_WORDS.has(w)) moto = true;
  }
  return { kind: moto ? "moto" : (body || /\b(carro|sedan|hatch|suv|pickup|picape)\b/.test(text) ? "carro" : "qualquer"), body };
}

function vehicleBody(v: MatchVehicle): "hatch" | "sedan" | "suv" | "pickup" | "unknown" {
  const t = normVehText(`${v.modelName || ""} ${v.versionName || ""}`);
  if (/\b(hilux|s10|ranger|amarok|toro|frontier|triton|l200|strada|saveiro|montana|oroch|maverick|ram|f150|silverado|d20|f1000|gladiator)\b/.test(t)) return "pickup";
  if (/\b(compass|renegade|creta|kicks|hrv|corolla cross|tracker|tcross|t cross|nivus|fastback|pulse|tiggo|sw4|equinox|commander|taos|ecosport|duster|kardian|outlander|pajero|asx|xc60|xc40|2008)\b/.test(t)) return "suv";
  if (/\b(corolla|civic|cruze|jetta|virtus|cronos|versa|hb20s|logan|city|sentra|cerato|fusion|onix sedan|onix plus)\b/.test(t)) return "sedan";
  if (/\b(onix|hb20|polo|argo|208|207|yaris|mobi|kwid|c3|gol|fox|sandero|up|fiesta|march|cooper)\b/.test(t)) return "hatch";
  return "unknown";
}
function isMoto(v: MatchVehicle): boolean {
  const t = normVehText(`${v.markName || ""} ${v.modelName || ""} ${v.versionName || ""}`);
  return /\b(yamaha|kawasaki|shineray|harley|davidson|dafra|triumph|ducati|ktm|haojue|biz|cg|fan|titan|bros|xre|pcx|nmax|fazer|factor|ybr|twister|hornet|cb300|cbr|crypton)\b/.test(t);
}

function passesNumeric(v: MatchVehicle, f: MatchFilters, relaxed: boolean, allowPriceless: boolean): boolean {
  const price = Number(v.saleValue || 0);
  if (price <= 0 && !allowPriceless) return false; // R$0 = erro de cadastro; some só em busca por categoria
  if (relaxed) return true;
  const year = Number(v.year || 0);
  const km = Number(v.km || 0);
  return (
    (!f.ano_min || year >= Number(f.ano_min)) &&
    (!f.ano_max || year <= Number(f.ano_max)) &&
    (!f.preco_max || price <= 0 || price <= Number(f.preco_max)) &&
    (!f.preco_min || price <= 0 || price >= Number(f.preco_min)) &&
    (!f.km_max || km <= Number(f.km_max))
  );
}

// Pontua 1 veículo contra os tokens de MODELO e de MARCA reais do lead.
// Retorna score=0 (descartado) quando o lead nomeou um modelo específico e ESTE carro não o tem.
function scoreVehicle(
  v: MatchVehicle,
  filters: MatchFilters,
  modelTokens: string[],
  brandTokens: string[],
  queryNums: string[],
): { score: number; matched: string[] } {
  const vTokens = alphaTokens(`${v.markName || ""} ${v.modelName || ""} ${v.versionName || ""}`);
  const vBrandTokens = alphaTokens(`${v.markName || ""}`);
  const vNums = numberTokens(`${v.modelName || ""} ${v.versionName || ""} ${v.year || ""}`);
  const matched: string[] = [];
  let score = 0;

  // MODELO: se o lead nomeou modelo(s), ESTE carro precisa casar pelo menos um — senão sai.
  let modelHits = 0;
  for (const qt of modelTokens) {
    let best = 0;
    for (const vt of vTokens) best = Math.max(best, tokenSim(qt, vt));
    if (best >= MODEL_SIM_THRESHOLD) {
      score += best >= 0.999 ? 15 : Math.round(10 * best);
      matched.push(qt);
      modelHits++;
    }
  }
  if (modelTokens.length > 0 && modelHits === 0) return { score: 0, matched: [] };

  // MARCA: casou = bônus; lead pediu marca e o carro é de OUTRA marca = penalidade forte.
  for (const bt of brandTokens) {
    let best = 0;
    for (const vt of vBrandTokens) best = Math.max(best, tokenSim(bt, vt));
    if (best >= MODEL_SIM_THRESHOLD) {
      score += 5;
      matched.push(bt);
    } else {
      score -= 12;
    }
  }
  for (const qn of queryNums) {
    if (vNums.includes(qn)) {
      score += 5;
      matched.push(qn);
    }
  }
  // preferência forte por carroceria EXPLÍCITA digitada pelo lead (+40 sobe / -25 desce, sem eliminar)
  const body = normVehText(filters.body_type || "");
  if (["hatch", "sedan", "suv", "pickup"].includes(body)) {
    const vb = vehicleBody(v);
    if (vb !== "unknown") score += vb === body ? 40 : -25;
  }
  return { score, matched };
}

// ============================================================================
// ENTRADA PRINCIPAL — substitui rankVehicles. Mesma saída.
// ============================================================================
export function rankVehiclesV2(vehicles: MatchVehicle[], filters: MatchFilters): MatchResult[] {
  const vocab = buildVocab(vehicles);
  const brands = buildBrands(vehicles);
  const qTokens = queryModelTokens(filters);
  // Só os tokens do lead que REALMENTE são modelo/marca no estoque contam (resto é ruído/genérico).
  const realTokens = qTokens.filter((t) => isRealModelToken(t, vocab));
  const brandToks = realTokens.filter((t) => brands.has(t));
  const modelToks = realTokens.filter((t) => !brands.has(t));
  const queryNums = numberTokens([filters.query, filters.modelo, filters.versao].filter(Boolean).join(" "));
  const hasModelIntent = realTokens.length > 0;
  const allowPriceless = hasModelIntent;

  // filtro de TIPO (carro/moto)
  const type = requestedType(filters);
  const typed = vehicles.filter((v) => {
    if (type.kind === "qualquer") return true;
    const moto = isMoto(v);
    return type.kind === "moto" ? moto : !moto;
  });

  // BUSCA AMPLA / sem modelo: devolve tudo que passa tipo + numérico (preço/ano/km).
  if (!hasModelIntent) {
    let pool = typed.filter((v) => passesNumeric(v, filters, false, allowPriceless));
    // Pedido de CATEGORIA sem modelo (ex.: "quero uma picape"/"um suv"): mostra SÓ os daquela
    // carroceria (cai pra todos se não houver nenhum). Filtrar por carroceria só é seguro aqui,
    // SEM modelo nomeado — não afeta "quero um polo" (que tem modelo e nem entra neste ramo).
    if (type.body) {
      const ofBody = pool.filter((v) => vehicleBody(v) === type.body);
      if (ofBody.length > 0) pool = ofBody;
    }
    return pool
      .map((v) => ({ vehicle: v, score: 1, matchedTokens: [] as string[], relaxed: false }))
      .sort((a, b) => Number(a.vehicle.saleValue || 0) - Number(b.vehicle.saleValue || 0));
  }

  // BUSCA POR MODELO: pontua, filtra score>0 + numérico, ordena por score.
  const ranked = typed
    .map((v) => {
      const s = scoreVehicle(v, filters, modelToks, brandToks, queryNums);
      return { vehicle: v, score: s.score, matchedTokens: s.matched, relaxed: false };
    })
    .filter((r) => r.score > 0 && passesNumeric(r.vehicle, filters, false, allowPriceless))
    .sort((a, b) => b.score - a.score);
  if (ranked.length > 0) return ranked;

  // RELAXADO: o modelo casou mas o filtro numérico (ex.: teto de preço do anúncio) eliminou a
  // unidade real -> devolve mesmo assim, marcando relaxed (o reply confirma os detalhes).
  return typed
    .map((v) => {
      const s = scoreVehicle(v, filters, modelToks, brandToks, queryNums);
      return { vehicle: v, score: s.score, matchedTokens: s.matched, relaxed: true };
    })
    .filter((r) => r.score > 0 && passesNumeric(r.vehicle, filters, true, allowPriceless))
    .sort((a, b) => b.score - a.score);
}
