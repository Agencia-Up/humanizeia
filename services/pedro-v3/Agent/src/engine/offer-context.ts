// ============================================================================
// offer-context.ts — F2.7.12 (P0). Captura DETERMINISTICA dos veiculos que a
// propria resposta renderizada mostrou, seja como lista (vehicle_offer_list)
// ou como foco singular aterrado (vehicle_ref/money_ref). Isso permite resolver
// referencias posteriores ("foto do 3", "fotos dele") sem parse de texto.
// PURO. Gravado pelo engine apos compor; o LLM nao participa.
// ============================================================================
import type { LastRenderedOfferContext, RenderedOfferItem } from "../domain/conversation-state.ts";
import type { Id, Iso, VehicleFact } from "../domain/types.ts";
import type { QueryResult } from "../domain/decision.ts";
import type { TurnOutput } from "./decision-engine.ts";
import { DEFAULT_VEHICLE_OFFER_LIST_MAX_ITEMS } from "./vehicle-offer-render.ts";

function vehicleItemsFromFacts(facts: QueryResult[]): VehicleFact[] {
  const out: VehicleFact[] = [];
  for (const f of facts) {
    if (!f.ok) continue;
    if (f.tool === "stock_search") out.push(...f.data.items);
    if (f.tool === "vehicle_details") out.push(f.data.vehicle);
  }
  return out;
}

// Devolve contexto estruturado somente quando o draft realmente mostrou um
// veiculo aterrado. Resultado de tool sozinho nunca escolhe/persiste um foco.
export function computeRenderedOfferContext(
  turnOutput: TurnOutput,
  turnId: Id,
  now: Iso,
  previous: LastRenderedOfferContext | null = null,
): LastRenderedOfferContext | null {
  // 1) handler deterministico (ex.: economy) ja forneceu os itens (na ordem)
  if (turnOutput.renderedOfferContext && turnOutput.renderedOfferContext.length > 0) {
    return { sourceTurnId: turnId, createdAt: now, items: [...turnOutput.renderedOfferContext] };
  }
  // 2) caminho do LLM: vehicle_offer_list (ordem renderizada) ou veiculos
  // efetivamente citados por vehicle_ref/money_ref, na ordem em que aparecem.
  //
  // A LLM pode responder naturalmente "tenho Ka e Fox" sem escolher o formato
  // visual de lista. Isso ainda mostrou dois veiculos reais ao lead e precisa
  // preservar as chaves para o proximo turno ("foto do Ka", "do segundo").
  // Capturar essa ordem nao decide a conversa nem interpreta texto comercial:
  // apenas espelha refs tipadas que o renderer ja validou contra fatos atuais.
  const parts = turnOutput.composed?.draft?.parts ?? [];
  const part = parts.find((p) => (p as { type?: string }).type === "vehicle_offer_list") as { vehicleKeys?: string[] } | undefined;
  // A memoria operacional precisa espelhar o que o renderer realmente mostrou no WhatsApp.
  // Se a LLM propuser 16 chaves mas a lista renderizada mostra 5, so essas 5 viram "apresentadas".
  let keys = Array.isArray(part?.vehicleKeys) ? part!.vehicleKeys.slice(0, DEFAULT_VEHICLE_OFFER_LIST_MAX_ITEMS) : [];
  const stock = vehicleItemsFromFacts(turnOutput.facts);
  if (keys.length === 0) {
    const referenced: string[] = [];
    const seen = new Set<string>();
    const pushCurrentFact = (key: string): void => {
      if (seen.has(key) || !stock.some((item) => item.vehicleKey === key)) return;
      seen.add(key);
      referenced.push(key);
    };
    for (const candidate of parts) {
      if (candidate.type === "vehicle_ref") pushCurrentFact(candidate.vehicleKey);
      if (candidate.type === "money_ref"
        && candidate.role === "vehicle_price"
        && candidate.source.kind === "vehicle_fact") {
        pushCurrentFact(candidate.source.vehicleKey);
      }
    }
    keys = referenced.slice(0, DEFAULT_VEHICLE_OFFER_LIST_MAX_ITEMS);
  }
  if (keys.length === 0) return null;
  // Referencias lembradas podem nomear um carro, mas nao criam um novo foco
  // factual. Sem vehicle_offer_list, cada chave capturada acima exige fato real
  // deste turno.
  if (!part && !keys.some((key) => stock.some((item) => item.vehicleKey === key))) return null;
  const items: RenderedOfferItem[] = keys.map((key, i) => {
    const v = stock.find((s) => s.vehicleKey === key);
    // Reapresentar uma lista para desambiguar foto/seleção não deve apagar a
    // identidade estruturada que o próprio agente exibiu no turno anterior.
    // O carry-over é estritamente pela mesma vehicleKey; texto livre e chaves
    // propostas pela LLM nunca criam metadados novos.
    const remembered = previous?.items.find((item) => item.vehicleKey === key);
    return {
      ordinal: i + 1,
      vehicleKey: key,
      marca: v?.marca ?? remembered?.marca ?? null,
      modelo: v?.modelo ?? remembered?.modelo ?? null,
      ano: v?.ano ?? remembered?.ano ?? null,
      preco: typeof v?.preco === "number" ? v.preco : remembered?.preco ?? null,
      cor: v?.cor ?? remembered?.cor ?? null,
      cambio: v?.cambio ?? remembered?.cambio ?? null,
      tipo: v?.tipo ?? remembered?.tipo ?? null,
    };
  });
  return { sourceTurnId: turnId, createdAt: now, items };
}
