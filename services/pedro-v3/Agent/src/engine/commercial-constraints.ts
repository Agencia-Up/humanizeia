// ============================================================================
// commercial-constraints.ts — P0 (LLM-first SDR): FILTRO DE ESTOQUE do turno + MERGE ao longo da conversa.
// Serve a três invariantes:
//   (1) FORÇA de tool: em llmFirst, se o lead deu constraint comercial suficiente e nenhuma stock_search rodou, o engine
//       NEGA o final e busca (nunca "qual modelo/tipo procura?" quando o lead já informou).
//   (2) MERGE conservador (F2.26): o lead refina a MESMA intenção em turnos separados ("Palio/Gol" -> "até 50 mil" ->
//       "que seja volks" -> "automático" -> "mais opções"). Cada dimensão do bloco ATUAL substitui a antiga; ausente
//       preserva. Um modelo novo "pelado" solta a marca antiga (nova direção). Só turno de BUSCA atualiza o ativo.
//   (3) ENRIQUECIMENTO: a chamada executada recebe o filtro ATIVO (mergeado); o valor explícito do cérebro sempre vence.
// Reusa computeTurnFrame (modelo/tipo/orçamento/câmbio) + detecção de MARCA por sinônimo (volks->volkswagen). PURO.
// ============================================================================
import { computeTurnFrame } from "./explicit-search.ts";
import { normalizeText } from "./catalog-utils.ts";
import type { ClaimExtractor, QueryInputMap, TurnInterpretation } from "../domain/decision.ts";
import type { FrameSignals } from "../domain/agent-brain.ts";
import type { ActiveSearchConstraints } from "../domain/conversation-state.ts";
import type { VehicleType } from "../domain/types.ts";
import { moneyByClause } from "./lead-extraction.ts";

// A forma dos constraints é a MESMA do estado persistido (ActiveSearchConstraints) — domínio é a fonte do tipo.
export type CommercialConstraints = ActiveSearchConstraints;

// Abreviações/apelidos BR inequívocos -> nome CANÔNICO do fabricante. Conservador (só o que não gera ambiguidade).
const BRAND_SYNONYMS: Readonly<Record<string, string>> = {
  volks: "volkswagen", vw: "volkswagen", wolks: "volkswagen", volkz: "volkswagen",
  chevy: "chevrolet", gm: "chevrolet",
  mercedes: "mercedes-benz", mercedez: "mercedes-benz", merc: "mercedes-benz",
};
// Fabricantes plenos reconhecidos direto no texto (complementa o que o catálogo do tenant já extrai via ClaimExtractor).
const KNOWN_BRANDS = [
  "volkswagen", "chevrolet", "fiat", "hyundai", "toyota", "honda", "renault", "nissan",
  "ford", "jeep", "peugeot", "citroen", "kia", "mitsubishi", "bmw", "audi", "mercedes-benz", "chery", "caoa",
];

// Canonicaliza uma marca crua ("volks"/"vw") para o nome pleno; senão devolve a original normalizada. PURO.
export function canonicalBrand(raw: string): string {
  const norm = normalizeText(raw);
  return BRAND_SYNONYMS[norm] ?? norm;
}

// Detecta a marca no bloco (sinônimo -> canônico; senão fabricante pleno). null se nenhuma. PURO.
export function detectBrand(block: string): string | null {
  const norm = normalizeText(block);
  for (const [syn, canonical] of Object.entries(BRAND_SYNONYMS)) {
    if (new RegExp(`\\b${syn}\\b`).test(norm)) return canonical;
  }
  for (const b of KNOWN_BRANDS) {
    if (new RegExp(`\\b${b.replace("-", "[- ]?")}\\b`).test(norm)) return b;
  }
  return null;
}

// F2.29: o lead pediu MOTO explicitamente? Só então o engine LIBERA moto na busca (default do estoque é EXCLUIR moto de
// lista de carro). Conservador: exige a palavra "moto/motocicleta/scooter/..." — não infere por modelo (evita falso
// positivo com carro). PURO.
const MOTORCYCLE_INTENT_RX = /\b(moto|motos|motocicleta|motocicletas|motoca|scooter|scooters|ciclomotor|triciclo|quadriciclo)\b/;
export function mentionsMotorcycle(block: string): boolean {
  return MOTORCYCLE_INTENT_RX.test(normalizeText(block));
}

// Propulsão é requisito de produto, não adjetivo de conversa: "sedan híbrido"
// não pode degradar para qualquer sedan. O motor de busca recebe somente a
// restrição afirmada; não inferimos híbrido por marca/modelo.
const HYBRID_INTENT_RX = /\b(?:hibrid[oa]s?|hybrid)\b/;
export function mentionsHybridPowertrain(block: string): boolean {
  return HYBRID_INTENT_RX.test(normalizeText(block));
}

// ── CORREÇÕES explícitas do lead (Invariante 2 / Evidence 1): remoções de constraint do filtro ATIVO. "esquece o
//    sedan", "não é sedan", "não quero sedan", "não precisa ser sedan", "Compass não é sedan", "tira o sedan". É EXTRAÇÃO
//    DE FATO (não é if-por-frase de RESPOSTA): mapeia o TIPO negado -> remoção; o engine aplica no merge. PURO. ──
const REMOVE_TYPE_RX = /\b(?:esquec\w*|tira|deixa\s+(?:o|a|de)|nao\s+(?:e|eh|quero|preciso|precisa\s+ser|to\s+querendo|to\s+atras\s+de))\b[^.?!]{0,24}?\b(suvs?|sedans?|hatch\w*|picapes?|pickups?)\b|\bnao\s+(?:e|eh)\s+(?:um[a]?\s+)?(suvs?|sedans?|hatch\w*|picapes?|pickups?)\b/g;
function typeWordToVehicle(word: string): VehicleType | null {
  if (/^suv/.test(word)) return "suv";
  if (/^sedan/.test(word)) return "sedan";
  if (/^hatch/.test(word)) return "hatch";
  if (/^picape|^pickup/.test(word)) return "pickup";
  return null;
}
export type CommercialCorrections = { readonly removedTypes: readonly VehicleType[] };
export function detectCorrections(block: string): CommercialCorrections {
  const norm = normalizeText(block);
  const removed = new Set<VehicleType>();
  REMOVE_TYPE_RX.lastIndex = 0;
  for (let m = REMOVE_TYPE_RX.exec(norm); m; m = REMOVE_TYPE_RX.exec(norm)) {
    const vt = typeWordToVehicle(m[1] ?? m[2] ?? "");
    if (vt) removed.add(vt);
  }
  return { removedTypes: [...removed] };
}

// ── Anos RÍGIDOS (F2.28): "13/14/15" -> [2013,2014,2015]; "2013 a 2015" -> range; "2015" -> [2015]. parseBudget já ignora
//    anos, e cilindrada ("1.6") não casa. PURO. Normalização LEVE (preserva "/" — o normalizeText do catálogo o troca por
//    espaço, quebrando "13/14/15"). ──
function detectYears(block: string): number[] {
  const norm = block.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const years = new Set<number>();
  const range = /\b(19|20)(\d{2})\s*(?:a|ate|-)\s*(19|20)(\d{2})\b/.exec(norm);
  if (range) { const a = Number(range[1] + range[2]), b = Number(range[3] + range[4]); if (a <= b && b - a <= 15) for (let y = a; y <= b; y++) years.add(y); }
  for (const grp of norm.match(/\b\d{2}(?:\s*\/\s*\d{2})+\b/g) ?? []) for (const d of grp.split("/")) { const n = Number(d.trim()); if (n >= 0 && n <= 99) years.add(2000 + n); }
  for (const y of norm.match(/\b(?:19|20)\d{2}\b/g) ?? []) { const n = Number(y); if (n >= 1990 && n <= 2035) years.add(n); }
  return [...years].sort((a, b) => a - b);
}

// Extrai os constraints comerciais do BLOCO ATUAL. PURO.
export function detectCommercialConstraints(args: {
  readonly block: string;
  readonly signals: FrameSignals;
  readonly claimExtractor: ClaimExtractor;
  readonly interpretation?: TurnInterpretation | null;
}): CommercialConstraints {
  const frame = computeTurnFrame({ leadMessage: args.block, claimExtractor: args.claimExtractor, interpretation: args.interpretation ?? null });
  const c: CommercialConstraints = {};
  const rawBrand = frame.explicitBrands[0] ?? detectBrand(args.block);
  if (rawBrand) c.marca = canonicalBrand(rawBrand);
  if (frame.explicitModels.length > 0) c.modelos = [...frame.explicitModels];
  // Um TIPO NEGADO no bloco ("não é sedan", "esquece o sedan") NÃO vira tipo do turno (senão o merge re-injetaria o
  // sedan que o lead acabou de remover). A remoção é aplicada no merge via detectCorrections.
  const removedTypes = detectCorrections(args.block).removedTypes;
  const tipoCandidate = frame.explicitTypes.find((t) => !removedTypes.includes(t));   // 1º tipo NÃO-negado ("não quero suv, quero hatch" -> hatch)
  if (tipoCandidate) c.tipo = tipoCandidate;
  // Orçamento: computeTurnFrame cobre "50 mil"/dígitos; aqui completo o sufixo "k" ("até 50k" -> 50000).
  let precoMax = frame.budgetMax;
  if (precoMax == null) { const k = /\b(\d{1,3})\s*k\b/.exec(normalizeText(args.block)); if (k) precoMax = Number(k[1]) * 1000; }
  // A mesma quantia nao pode ser simultaneamente ENTRADA/PARCELA e teto de
  // estoque. O parser financeiro por clausula e a autoridade semantica do
  // valor; detectores comerciais apenas enriquecem a tool quando o valor e
  // realmente budget. Preserva frases mistas ("SUV ate 90 mil, parcela 1800").
  if (precoMax != null) {
    const roles = moneyByClause(args.block, true);
    const financiallyLabeled = roles.some((item) => item.value === precoMax && (item.role === "entrada" || item.role === "parcela"));
    const explicitlyBudgeted = roles.some((item) => item.value === precoMax && item.role === "budget");
    if (financiallyLabeled && !explicitlyBudgeted) precoMax = null;
  }
  if (precoMax != null) c.precoMax = precoMax;
  if (frame.transmission) c.cambio = frame.transmission;
  if (mentionsHybridPowertrain(args.block)) c.hibrido = true;
  if (args.signals.mentionsPopular === true) c.popular = true;
  const anos = detectYears(args.block);
  if (anos.length > 0) c.anos = anos;
  return c;
}

// ── P0-B (audit Codex smoke CTWA): intenção de SIMILARIDADE. Depois de um anúncio/oferta SEM match exato, o lead pede
//    ALTERNATIVAS: "algo parecido", "opções semelhantes", "outras parecidas", "algo do tipo". Nesse turno, o filtro deve
//    RELAXAR modelo/marca (do anúncio) e manter só as dimensões SEGURAS de similaridade: tipo/categoria + precoMax +
//    popular (câmbio só se o LEAD pediu neste turno). Sem isso, "algo parecido" continua preso no modelo do anúncio
//    (bug real: "tem algo parecido até 100 mil?" seguia buscando modelo=Ranger). PURO. ──
const SIMILARITY_RX = /\bparecid[oa]s?\b|\bsemelhante[s]?\b|\bsimilar(?:es)?\b|\balgo\s+(?:do\s+)?(?:tipo|assim)\b|\bnesse\s+estilo\b|\bnessa\s+linha\b|\bde\s+mesmo\s+estilo\b|\bque\s+seja\s+parecid|\boutr[oa]s?\s+(?:parecid|semelhant|similar)/;
export function detectSimilarityIntent(block: string): boolean {
  return SIMILARITY_RX.test(normalizeText(block));
}
// Relaxa um filtro para SIMILARIDADE: mantém tipo/precoMax/popular; DROPA marca/modelos/anos; câmbio só se keepCambio
// (o lead pediu câmbio no turno atual). PURO.
export function relaxToSimilar(c: CommercialConstraints, keepCambio: boolean): CommercialConstraints {
  const out: CommercialConstraints = {};
  if (c.tipo) out.tipo = c.tipo;
  if (c.precoMax != null) out.precoMax = c.precoMax;
  if (c.popular === true) out.popular = true;
  if (keepCambio && c.cambio) out.cambio = c.cambio;
  if (c.hibrido === true) out.hibrido = true;
  return out;
}

// F2.29 (invariante 3): quando NÃO há filtro ativo persistido, deriva o escopo MÍNIMO da última oferta renderizada —
// SOMENTE se HOMOGÊNEA (todos os itens do MESMO tipo aterrado). Mista (SUV+sedan+hatch) ou algum sem tipo -> null (não
// inventa escopo). Deriva só o TIPO (a oferta não carrega o precoMax/marca da busca original de forma confiável). PURO.
export function deriveScopeFromHomogeneousOffer(items: ReadonlyArray<{ readonly tipo?: VehicleType | null }>): CommercialConstraints | null {
  if (!items || items.length === 0) return null;
  const types = items
    .map((it) => it.tipo)
    .filter((t): t is VehicleType => t === "suv" || t === "sedan" || t === "hatch" || t === "pickup");
  if (types.length !== items.length) return null;      // algum item sem tipo aterrado -> não confiável
  const first = types[0];
  if (!types.every((t) => t === first)) return null;   // tipos mistos -> não deriva
  return { tipo: first };
}

// MERGE CONSERVADOR (F2.26 + F2.27): cada dimensão do bloco ATUAL (current) substitui a do filtro ATIVO; ausente preserva.
// Invariantes (audit Codex — Evidence 1/6):
//  - (Inv.2) CORREÇÃO explícita ("esquece sedan", "não é sedan") remove o TIPO do filtro ativo.
//  - (Inv.1) MODELO específico novo é MAIS específico que categoria: solta o TIPO antigo (Compass ≠ sedan) E a marca
//    antiga (modelo pelado = nova direção; "tem Onix?" após VW troca o foco).
//  - TIPO novo é uma nova CATEGORIA: solta os MODELOS antigos (Evidence 6: "queria SUV" limpa o modelo anterior).
//  - "que seja volks" (marca sem modelo) ESTREITA sobre os modelos ativos (mantém modelos, adiciona marca). PURO.
export function mergeActiveConstraints(active: CommercialConstraints, current: CommercialConstraints, corrections?: CommercialCorrections): CommercialConstraints {
  const next: CommercialConstraints = { ...active };
  if (corrections?.removedTypes.length && next.tipo && corrections.removedTypes.includes(next.tipo)) delete next.tipo;
  if (current.marca) next.marca = current.marca;
  if (current.modelos && current.modelos.length > 0) {
    next.modelos = [...current.modelos];
    if (!current.marca) delete next.marca;   // modelo novo pelado = nova direção -> descarta a marca antiga
    if (!current.tipo) delete next.tipo;      // modelo específico supera tipo antigo (Compass não fica preso em sedan)
    if (!current.anos?.length) delete next.anos;   // modelo novo = nova direção -> descarta os anos rígidos antigos
  }
  if (current.tipo) {
    next.tipo = current.tipo;
    if (!current.modelos || current.modelos.length === 0) delete next.modelos;   // tipo novo = nova categoria, limpa modelo
    if (!current.marca && (!current.modelos || current.modelos.length === 0)) delete next.marca; // tipo amplo = nova direção, limpa marca stale
  }
  if (current.precoMax != null) next.precoMax = current.precoMax;
  if (current.cambio) next.cambio = current.cambio;
  if (current.hibrido === true) next.hibrido = true;
  if (current.popular) next.popular = true;
  if (current.anos && current.anos.length > 0) next.anos = [...current.anos];   // anos novos substituem os antigos (rígido)
  return next;
}

// Constraint suficiente para DISPARAR uma busca? Qualquer filtro comercial. PURO.
export function sufficientForStockSearch(c: CommercialConstraints): boolean {
  return c.marca != null || (c.modelos != null && c.modelos.length > 0) || c.tipo != null || c.precoMax != null || c.cambio != null || c.hibrido === true || c.popular === true;
}

// Constraints -> input de stock_search (marca canonicalizada; modelos[] -> modelo + broad quando há mais de um). PURO.
export function constraintsToStockInput(c: CommercialConstraints): QueryInputMap["stock_search"] {
  const input: QueryInputMap["stock_search"] = {};
  if (c.marca) input.marca = canonicalBrand(c.marca);
  if (c.modelos && c.modelos.length > 0) {
    input.modelo = c.modelos.join(" ");
    if (c.modelos.length > 1) input.broad = true;   // "palio gol" -> qualquer token bate (Palio OU Gol)
  }
  if (c.tipo) input.tipo = c.tipo;
  if (c.precoMax != null) input.precoMax = c.precoMax;
  if (c.cambio) input.cambio = c.cambio;
  if (c.hibrido === true) input.hibrido = true;
  if (c.popular) input.popular = true;
  if (c.anos && c.anos.length > 0) input.anos = [...c.anos];
  return input;
}

// F2.29 (P0 audit Codex): ESCOPO comercial da busca EXECUTADA (filtersUsed) — o que foi REALMENTE buscado/ofertado. É a
// FONTE DE VERDADE do activeSearchConstraints (não só o texto do lead): quando o cérebro busca {tipo:"sedan"} e lista, o
// próximo "tem outros?" precisa herdar tipo=sedan. Ignora excludeKeys/broad (não são escopo). PURO.
export function activeConstraintsFromStockInput(input: Record<string, unknown> | null | undefined): CommercialConstraints {
  const c: CommercialConstraints = {};
  if (!input) return c;
  const marca = typeof input.marca === "string" ? input.marca : "";
  if (marca) c.marca = canonicalBrand(marca);
  const modelo = typeof input.modelo === "string" ? input.modelo.trim() : "";
  if (modelo) c.modelos = modelo.split(/\s+/).filter(Boolean);
  const tipo = typeof input.tipo === "string" ? input.tipo : "";
  if (tipo === "suv" || tipo === "sedan" || tipo === "hatch" || tipo === "pickup") c.tipo = tipo;
  if (typeof input.precoMax === "number" && input.precoMax > 0) c.precoMax = input.precoMax;
  const cambio = typeof input.cambio === "string" ? input.cambio : "";
  if (cambio === "automatic" || cambio === "manual") c.cambio = cambio;
  if (input.hibrido === true) c.hibrido = true;
  if (Array.isArray(input.anos)) { const anos = input.anos.filter((y): y is number => typeof y === "number" && y >= 1990 && y <= 2035); if (anos.length > 0) c.anos = anos; }
  if (input.popular === true) c.popular = true;
  return c;
}

// Rótulo humano curto do constraint (p/ recuperação honesta: "Não achei Volkswagen até 50 mil agora"). PURO.
export function describeConstraints(c: CommercialConstraints): string {
  const parts: string[] = [];
  if (c.marca) parts.push(c.marca.charAt(0).toUpperCase() + c.marca.slice(1));
  else if (c.modelos && c.modelos.length > 0) parts.push(c.modelos.join(" ou "));
  if (c.tipo) parts.push(c.tipo.toUpperCase());
  if (c.anos && c.anos.length > 0) parts.push(c.anos.join("/"));
  if (c.popular && parts.length === 0) parts.push("carro popular");
  if (c.precoMax != null) parts.push(`até R$ ${c.precoMax.toLocaleString("pt-BR")}`);
  if (c.cambio) parts.push(c.cambio === "automatic" ? "automático" : "manual");
  if (c.hibrido) parts.push("híbrido");
  return parts.join(" ");
}

// ── Fix A (audit CTWA — condução SDR): CASCATA DE RELAXAMENTO para a busca EXATA que voltou 0. Dado o filtro que zerou,
//    produz filtros relaxados EM ORDEM (do mais próximo ao mais amplo), cada um rotulado pelo que foi afrouxado. O engine
//    roda cada passo até achar itens REAIS; a recuperação NOMEIA o filtro original + a alternativa (nunca inventa). Ordem:
//    (1) mesmo TIPO na faixa [dropa modelo/marca, mantém tipo+preço] = alternativas que CABEM no orçamento;
//    (2) mesmo MODELO/marca SEM teto [dropa preço] = o carro pedido, um pouco acima; (3) mesma MARCA na faixa;
//    (4) só o TIPO (sem teto); (5) só a FAIXA. Pula passos sem a dimensão. Dedup + nunca re-propõe o filtro que zerou. PURO. ──
export type RelaxKind = "same_type_in_range" | "drop_ceiling" | "same_brand_in_range" | "same_type" | "in_range";
export type RelaxedSearch = { readonly kind: RelaxKind; readonly constraints: CommercialConstraints };
export function relaxSearchCascade(zeroed: CommercialConstraints, tipoHint?: VehicleType | null): RelaxedSearch[] {
  const tipo = zeroed.tipo ?? tipoHint ?? null;
  const hasModelOrBrand = (zeroed.modelos != null && zeroed.modelos.length > 0) || zeroed.marca != null;
  // A relaxação afrouxa PREÇO e amplia MODELO->tipo/marca, mas PRESERVA câmbio e ano RÍGIDOS do lead (F2.28: "EcoSport 2019
  // manual" nunca vira 2020 automático). Se o único filtro a afrouxar for câmbio/ano, a cascata fica vazia -> honesto.
  const keep = (base: CommercialConstraints): CommercialConstraints => {
    const c: CommercialConstraints = { ...base };
    if (zeroed.cambio) c.cambio = zeroed.cambio;
    if (zeroed.hibrido) c.hibrido = true;
    if (zeroed.anos && zeroed.anos.length > 0) c.anos = [...zeroed.anos];
    return c;
  };
  const steps: RelaxedSearch[] = [];
  if (tipo && zeroed.precoMax != null) steps.push({ kind: "same_type_in_range", constraints: keep({ tipo, precoMax: zeroed.precoMax }) });
  if (zeroed.precoMax != null && hasModelOrBrand) {
    const dc: CommercialConstraints = {};
    if (zeroed.marca) dc.marca = zeroed.marca;
    if (zeroed.modelos && zeroed.modelos.length > 0) dc.modelos = [...zeroed.modelos];
    if (zeroed.tipo) dc.tipo = zeroed.tipo;
    steps.push({ kind: "drop_ceiling", constraints: keep(dc) });
  }
  if (zeroed.marca && zeroed.precoMax != null) steps.push({ kind: "same_brand_in_range", constraints: keep({ marca: zeroed.marca, precoMax: zeroed.precoMax }) });
  if (tipo) steps.push({ kind: "same_type", constraints: keep({ tipo }) });
  if (zeroed.precoMax != null) steps.push({ kind: "in_range", constraints: keep({ precoMax: zeroed.precoMax }) });
  const sig = (c: CommercialConstraints): string => JSON.stringify(constraintsToStockInput(c));
  const seen = new Set<string>([sig(zeroed)]);   // nunca re-propõe o filtro que já zerou
  return steps.filter((s) => { const k = sig(s.constraints); if (seen.has(k)) return false; seen.add(k); return true; });
}
