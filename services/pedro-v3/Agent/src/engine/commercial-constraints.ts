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
  if (frame.explicitTypes[0]) c.tipo = frame.explicitTypes[0];
  // Orçamento: computeTurnFrame cobre "50 mil"/dígitos; aqui completo o sufixo "k" ("até 50k" -> 50000).
  let precoMax = frame.budgetMax;
  if (precoMax == null) { const k = /\b(\d{1,3})\s*k\b/.exec(normalizeText(args.block)); if (k) precoMax = Number(k[1]) * 1000; }
  if (precoMax != null) c.precoMax = precoMax;
  if (frame.transmission) c.cambio = frame.transmission;
  if (args.signals.mentionsPopular === true) c.popular = true;
  return c;
}

// MERGE CONSERVADOR (F2.26): cada dimensão do bloco ATUAL (current) substitui a do filtro ATIVO; ausente preserva.
// Um MODELO novo "pelado" (sem marca no mesmo bloco) solta a marca antiga — é uma nova direção (ex.: depois de VW,
// "tem Onix?" troca o foco para Onix). "que seja volks" (marca sem modelo) ESTREITA sobre os modelos ativos. PURO.
export function mergeActiveConstraints(active: CommercialConstraints, current: CommercialConstraints): CommercialConstraints {
  const next: CommercialConstraints = { ...active };
  if (current.marca) next.marca = current.marca;
  if (current.modelos && current.modelos.length > 0) {
    next.modelos = [...current.modelos];
    if (!current.marca) delete next.marca;   // modelo novo pelado = nova direção -> descarta a marca antiga
  }
  if (current.tipo) next.tipo = current.tipo;
  if (current.precoMax != null) next.precoMax = current.precoMax;
  if (current.cambio) next.cambio = current.cambio;
  if (current.popular) next.popular = true;
  return next;
}

// Constraint suficiente para DISPARAR uma busca? Qualquer filtro comercial. PURO.
export function sufficientForStockSearch(c: CommercialConstraints): boolean {
  return c.marca != null || (c.modelos != null && c.modelos.length > 0) || c.tipo != null || c.precoMax != null || c.cambio != null || c.popular === true;
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
  if (c.popular) input.popular = true;
  return input;
}

// Rótulo humano curto do constraint (p/ recuperação honesta: "Não achei Volkswagen até 50 mil agora"). PURO.
export function describeConstraints(c: CommercialConstraints): string {
  const parts: string[] = [];
  if (c.marca) parts.push(c.marca.charAt(0).toUpperCase() + c.marca.slice(1));
  else if (c.modelos && c.modelos.length > 0) parts.push(c.modelos.join(" ou "));
  if (c.tipo) parts.push(c.tipo.toUpperCase());
  if (c.popular && parts.length === 0) parts.push("carro popular");
  if (c.precoMax != null) parts.push(`até R$ ${c.precoMax.toLocaleString("pt-BR")}`);
  if (c.cambio) parts.push(c.cambio === "automatic" ? "automático" : "manual");
  return parts.join(" ");
}
