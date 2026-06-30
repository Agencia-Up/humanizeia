// ============================================================================
// popularity-intent.ts — F2.7.10 (revisado p/ DOMINIO BR). Duas intencoes distintas:
//
//  - ECONOMY ("carro popular" no Brasil = ENTRADA/economico, NAO ranking): "populares",
//    "carros/modelos populares", "mais populares" -> busca ESTOQUE economico real (reusa a
//    via da F2.7.9: stock_search broad -> 5 mais em conta -> vehicle_offer_list), com nota do
//    criterio. Ancorado nos fatos; nunca terminal-safe; nao inventa ranking.
//
//  - RANKING (sem fonte factual): "mais vendidos/procurados", "o que mais sai", "best sellers",
//    "campeoes de venda" -> resposta HONESTA, sem inventar lista/ranking.
//
// Sem if por frase: deteccao por classe de termo. Curto-circuita o LLM (deterministico).
// ============================================================================
import type { ProposedDecision } from "../domain/decision.ts";
import type { Id, VehicleFact } from "../domain/types.ts";
import type { QueryRunner, TurnOutput } from "./decision-engine.ts";
import { finalize } from "./finalizer.ts";
import { normalizeText } from "./catalog-utils.ts";
import { renderVehicleOfferList } from "./vehicle-offer-render.ts";

// "popular(es)" = segmento de entrada/economico (domínio BR de usados).
const POPULAR_ECONOMY = /\bpopular(?:es)?\b/;
// Ranking REAL de vendas/procura: so com termos explicitos (sem dado real -> honesto).
const POPULARITY_RANKING = /\bmais\s+vendid\w*|\bmais\s+procurad\w*|\bmais\s+sa[ei]\w*|\bque\s+mais\s+sa[ei]\w*|\bbest\s?sellers?\b|\bcampe\w+\s+de\s+venda/;

export function detectPopularEconomyIntent(leadMessage: string): boolean {
  return POPULAR_ECONOMY.test(normalizeText(leadMessage));
}
export function detectPopularityRankingIntent(leadMessage: string): boolean {
  return POPULARITY_RANKING.test(normalizeText(leadMessage));
}

// ── RANKING: sem fonte real -> honesto, sem inventar ──
export function resolvePopularityRankingIntent(args: { readonly leadMessage: string }): { readonly kind: "honest" } | null {
  return detectPopularityRankingIntent(args.leadMessage) ? { kind: "honest" } : null;
}
const HONEST_RANKING =
  "Não tenho um ranking real de vendas por aqui, então não vou inventar. Mas posso te mostrar as opções mais em conta, " +
  "as automáticas, os SUVs ou dentro de uma faixa de valor. Quer que eu filtre por algum desses?";
export function buildPopularityRankingTurnOutput(turnId: Id): TurnOutput {
  return textTurn(turnId, HONEST_RANKING, "popularity_ranking_no_data", "Sem ranking real de vendas — honesto, sem inventar.");
}

// ── ECONOMY ("populares") -> oferta REAL do estoque economico (5 mais em conta), ancorada nos fatos ──
export type PopularEconomyResult =
  | { readonly kind: "offer"; readonly vehicles: VehicleFact[] }
  | { readonly kind: "none" };

export async function resolvePopularEconomyOffer(args: { readonly runQuery: QueryRunner }): Promise<PopularEconomyResult> {
  const res = await args.runQuery({ tool: "stock_search", input: { broad: true } });
  const items = res.ok && res.tool === "stock_search" ? res.data.items : [];
  const priced = items.filter((v) => typeof v.preco === "number" && v.preco > 0).slice().sort((a, b) => a.preco - b.preco);
  const vehicles = (priced.length > 0 ? priced : items).slice(0, 5); // 5 mais em conta (fonte ja ordena, reforcamos)
  return vehicles.length > 0 ? { kind: "offer", vehicles } : { kind: "none" };
}

const ECONOMY_NOTE = "Quando você fala em populares, vou considerar as opções mais de entrada e econômicas. Separei algumas do nosso estoque:";
export function buildPopularEconomyTurnOutput(result: PopularEconomyResult, turnId: Id): TurnOutput {
  if (result.kind === "none") {
    return textTurn(turnId, "No momento não tenho opções de entrada no estoque, mas posso te avisar assim que chegar algo. Quer?", "popular_economy_no_stock", "Sem estoque economico — honesto, sem inventar.");
  }
  const vehicles = result.vehicles.slice(0, 5);
  const text = `${ECONOMY_NOTE}\n\n${renderVehicleOfferList(vehicles, { maxItems: 5 })}`;
  const out = textTurn(turnId, text, "popular_economy_offer", "Populares = entrada/economicos; oferta ancorada no estoque real.");
  // F2.7.12: fornece a lista ESTRUTURADA (ordinal -> vehicleKey) p/ resolver "foto do N" depois.
  const items = vehicles.map((v, i) => ({ ordinal: i + 1, vehicleKey: v.vehicleKey, marca: v.marca ?? null, modelo: v.modelo ?? null, ano: v.ano ?? null }));
  return { ...out, renderedOfferContext: items };
}

// TurnOutput deterministico so com send_message (mesmo padrao do buildPhotoTurnOutput). Texto JA pronto.
function textTurn(turnId: Id, text: string, reasonCode: string, reasonSummary: string): TurnOutput {
  const proposal: ProposedDecision = {
    proposedAction: "reply",
    facts: [],
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }],
    responsePlan: { guidance: text },
    reasonCode, reasonSummary, confidence: 1,
  };
  const decision = finalize(turnId, proposal, [{ policyId: "POL-POPULARITY", outcome: "allow" }], []);
  return {
    decision,
    composed: { draft: { parts: [{ type: "text", content: text }] }, text },
    facts: [],
    loopExhausted: false,
    terminalSafe: false,
    steps: 0,
  };
}
