// ============================================================================
// offer-context.ts — F2.7.12 (P0). Captura DETERMINISTICA da ultima lista renderizada
// (vehicle_offer_list) -> LastRenderedOfferContext, para resolver referencia ORDINAL
// ("foto do 3") de forma estruturada (sem parse de texto, sem depender do delivered).
// PURO. Gravado pelo engine apos compor; o LLM nao participa.
// ============================================================================
import type { LastRenderedOfferContext, RenderedOfferItem } from "../domain/conversation-state.ts";
import type { Id, Iso, VehicleFact } from "../domain/types.ts";
import type { QueryResult } from "../domain/decision.ts";
import type { TurnOutput } from "./decision-engine.ts";

function stockItemsFromFacts(facts: QueryResult[]): VehicleFact[] {
  const out: VehicleFact[] = [];
  for (const f of facts) if (f.ok && f.tool === "stock_search") out.push(...f.data.items);
  return out;
}

// Devolve a lista estruturada SE este turno renderizou uma oferta; senao null (preserva a anterior).
export function computeRenderedOfferContext(turnOutput: TurnOutput, turnId: Id, now: Iso): LastRenderedOfferContext | null {
  // 1) handler deterministico (ex.: economy) ja forneceu os itens (na ordem)
  if (turnOutput.renderedOfferContext && turnOutput.renderedOfferContext.length > 0) {
    return { sourceTurnId: turnId, createdAt: now, items: [...turnOutput.renderedOfferContext] };
  }
  // 2) caminho do LLM: parte vehicle_offer_list (chaves na ORDEM renderizada) + detalhes nos fatos
  const parts = turnOutput.composed?.draft?.parts ?? [];
  const part = parts.find((p) => (p as { type?: string }).type === "vehicle_offer_list") as { vehicleKeys?: string[] } | undefined;
  const keys = Array.isArray(part?.vehicleKeys) ? part!.vehicleKeys : [];
  if (keys.length === 0) return null;
  const stock = stockItemsFromFacts(turnOutput.facts);
  const items: RenderedOfferItem[] = keys.map((key, i) => {
    const v = stock.find((s) => s.vehicleKey === key);
    return { ordinal: i + 1, vehicleKey: key, marca: v?.marca ?? null, modelo: v?.modelo ?? null, ano: v?.ano ?? null, preco: typeof v?.preco === "number" ? v.preco : null };
  });
  return { sourceTurnId: turnId, createdAt: now, items };
}
