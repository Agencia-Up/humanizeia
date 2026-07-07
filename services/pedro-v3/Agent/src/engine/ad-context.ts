// ============================================================================
// ad-context.ts — F2.32 (CTWA / Facebook Ads). O anúncio Click-to-WhatsApp é CONTEXTO da conversa (não resposta do
// lead). Este módulo é PURO: resolve o VEÍCULO do anúncio a partir do TEXTO (greeting/title/body) ATERRADO no catálogo
// (reusa detectCommercialConstraints — nunca inventa), e detecta quando o turno atual REFERE-SE ao anúncio ("esse ainda
// tem?", "vi o anúncio") ou é uma saudação curta de entrada. NÃO faz visão (Layer 2 = follow-up). O turno atual e as
// correções do lead SEMPRE vencem o anúncio — isso é imposto no engine; aqui só extraímos os FATOS.
// ============================================================================
import { detectCommercialConstraints, sufficientForStockSearch, canonicalBrand, type CommercialConstraints } from "./commercial-constraints.ts";
import { buildFrameSignals } from "./turn-frame-builder.ts";
import { normalizeText } from "./catalog-utils.ts";
import { VEHICLE_TAXONOMY } from "../adapters/read/vehicle-taxonomy.ts";
import type { AdContext } from "../domain/conversation-state.ts";
import type { ClaimExtractor, TurnInterpretation } from "../domain/decision.ts";
import type { VehicleType } from "../domain/types.ts";

// Taxonomia de MERCADO ordenada por modelo mais LONGO primeiro (casa "Onix Plus" antes de "Onix", "Corolla Cross" antes
// de "Corolla"). Permite resolver o veículo do anúncio MESMO fora do estoque da loja (ex.: anúncio de Kicks numa loja
// sem Kicks -> busca+honestidade+alternativas). PURO.
const MARKET_BY_LEN = [...VEHICLE_TAXONOMY].sort((a, b) => b.model.length - a.model.length);
export function resolveAdVehicleFromMarket(text: string): { marca: string; modelo: string; tipo: VehicleType } | null {
  const n = normalizeText(text);
  if (!n) return null;
  for (const entry of MARKET_BY_LEN) {
    const model = normalizeText(entry.model);
    if (model.length < 2) continue;
    const rx = new RegExp(`\\b${model.replace(/\s+/g, "\\s+")}\\b`);
    if (rx.test(n)) return { marca: canonicalBrand(entry.brand), modelo: entry.model, tipo: entry.type };
  }
  return null;
}

// Texto do anúncio p/ resolução do veículo. Greeting PRIMEIRO (o mais autoritativo — costuma nomear o carro exato:
// "Quer saber mais sobre a Ranger XLT TD 3.2 2016?"), depois title/body.
export function adText(ad: AdContext | null | undefined): string {
  if (!ad) return "";
  return [ad.greeting, ad.title, ad.body].map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean).join(". ");
}

// Extrai o VEÍCULO do anúncio como CommercialConstraints ATERRADAS no catálogo (marca/modelo/tipo/preço/câmbio/popular).
// ⚠️ DROPA o ANO: o ano do anúncio é dica FRACA (data da arte, não do carro — lição do v2). O catálogo é a verdade do
// ano; o anúncio busca por modelo/tipo/preço e a recuperação honesta cobre "não tenho exatamente esse ano". PURO.
export function extractAdVehicleConstraints(
  ad: AdContext | null | undefined,
  claimExtractor: ClaimExtractor,
  interpretation?: TurnInterpretation | null,
): CommercialConstraints {
  const text = adText(ad);
  if (!text) return {};
  const interp = interpretation ?? ({ relation: "ambiguous" } as TurnInterpretation);
  const signals = buildFrameSignals(text, interp);
  const fromCatalog = detectCommercialConstraints({ block: text, signals, claimExtractor, interpretation: interp });
  const market = resolveAdVehicleFromMarket(text);
  // BASE = mercado (marca/modelo/tipo — cobre veículo FORA de estoque, ex.: Kicks); o CATÁLOGO REFINA/confirma (modelo em
  // estoque, marca, tipo, preço, câmbio, popular). Assim um anúncio de carro que a loja NÃO tem ainda resolve o veículo
  // (busca -> honesto + alternativas). ANO sempre DROPADO (dica fraca — data da arte, não do carro).
  const c: CommercialConstraints = {};
  if (market) { c.marca = market.marca; c.modelos = [market.modelo]; c.tipo = market.tipo; }
  if (fromCatalog.marca) c.marca = fromCatalog.marca;
  if (fromCatalog.modelos && fromCatalog.modelos.length > 0) c.modelos = fromCatalog.modelos;
  if (fromCatalog.tipo) c.tipo = fromCatalog.tipo;
  if (fromCatalog.precoMax != null) c.precoMax = fromCatalog.precoMax;
  if (fromCatalog.cambio) c.cambio = fromCatalog.cambio;
  if (fromCatalog.popular === true) c.popular = true;
  return c;
}

// P0-A (audit Codex smoke): anos do texto do anúncio (só 4 dígitos plausíveis). Dica que, ATERRADA num veículo EXATO do
// estoque, vira a IDENTIDADE de referência do anúncio (marca/modelo/ano). PURO.
function adYears(text: string): number[] {
  const out: number[] = [];
  for (const m of normalizeText(text).match(/\b(?:19|20)\d{2}\b/g) ?? []) { const n = Number(m); if (n >= 1990 && n <= 2035) out.push(n); }
  return out;
}
// Resolve a REFERÊNCIA EXATA do anúncio: o veículo (dentre os JÁ APRESENTADOS) que casa modelo + ANO do anúncio. Só com
// match ÚNICO (grounding máximo). Sem modelo+ano no anúncio, ou 0/>1 matches -> null. Alimenta a foto pronominal. PURO.
export function resolveAdReferenceKey(
  ad: AdContext | null | undefined,
  offeredItems: ReadonlyArray<{ readonly vehicleKey: string; readonly modelo?: string | null; readonly ano?: number | null }>,
): string | null {
  if (!ad || offeredItems.length === 0) return null;
  const text = adText(ad);
  const model = resolveAdVehicleFromMarket(text)?.modelo ?? null;
  const years = adYears(text);
  if (!model || years.length === 0) return null;
  const year = years[years.length - 1];
  const nModel = normalizeText(model);
  const matches = offeredItems.filter((it) => it.ano === year && typeof it.modelo === "string" && normalizeText(it.modelo) === nModel);
  return matches.length === 1 ? matches[0].vehicleKey : null;
}

// TRUE se o anúncio tem um VEÍCULO resolvível (marca/modelo/tipo/preço). Anúncio institucional (só "encontre o carro
// ideal…") -> false -> contexto LEVE, não força busca.
export function adHasVehicle(constraints: CommercialConstraints): boolean {
  return sufficientForStockSearch(constraints);
}

// O turno ATUAL refere-se ao anúncio? "esse ainda tem?", "tem esse (carro)?", "vi o anúncio", "do anúncio", "ainda está
// disponível?", "esse aí". Conservador — pega o dêitico "esse/este" ligado a carro/disponibilidade + menções ao anúncio.
const REFERS_AD_RX = /\btem\s+esse\b|\besse\s+(?:ainda|carro|veiculo|modelo|ai|mesmo)\b|\beste\s+(?:ainda|carro|veiculo|modelo)\b|\bvi\s+o\s+anuncio\b|\b(?:do|no|pelo)\s+anuncio\b|\banuncio\b|\bainda\s+(?:tem|ta|esta|disponivel|dispon[ií]vel)\b|\besse\s+ainda\b|\bainda\s+tem\s+esse\b|\bquero\s+esse\b|\bgostei\s+desse\b/;
export function refersToAd(block: string): boolean {
  return REFERS_AD_RX.test(normalizeText(block));
}

// O turno atual é SÓ uma saudação de entrada (oi/olá/boa tarde/bom dia…), sem conteúdo comercial? Quando vem de um
// anúncio COM veículo, uma saudação curta deve puxar o veículo do anúncio (o lead entrou pelo anúncio daquele carro).
const BARE_GREETING_RX = /^(?:oi+|ola+|opa+|eae+|e\s*ai|blz|beleza|bo(?:m|a)\s+(?:dia|tarde|noite)|boa|bom|hello|hi|menu)[\s!.,]*$/;
export function isBareGreeting(block: string): boolean {
  return BARE_GREETING_RX.test(normalizeText(block));
}

// Sanitiza um AdContext cru vindo do bridge/ingest (clamp de tamanho, tipos, sem blobs). Retorna null se não houver
// NADA de anúncio (sem adId, sem texto, sem url). PURO.
export function sanitizeAdContext(raw: unknown, capturedAtTurn: number): AdContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const adId = str(r.adId, 128);
  const source = str(r.source, 64);
  const sourceUrl = str(r.sourceUrl, 512);
  const title = str(r.title, 400);
  const body = str(r.body, 1000);
  const greeting = str(r.greeting, 400);
  const imageUrls = Array.isArray(r.imageUrls)
    ? r.imageUrls.filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, 3).map((u) => u.slice(0, 512))
    : [];
  if (!adId && !title && !body && !greeting && !sourceUrl) return null;
  return { adId, source, sourceUrl, title, body, greeting, imageUrls, capturedAtTurn };
}
