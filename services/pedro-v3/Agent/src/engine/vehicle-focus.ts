// ============================================================================
// vehicle-focus.ts — invalidação CENTRAL do selectedVehicleFocus (P0-2 Codex). Uma ÚNICA regra, chamada
// no conversation-engine após o turno: QUALQUER nova intenção comercial de busca (explicit-search, baratos,
// populares, broad e query proposta pelo LLM) LIMPA o foco anterior; se a lista renderizada tem EXATAMENTE
// 1 veículo -> seleciona o vehicleKey; múltiplos/nenhum -> selected permanece null. NÃO se copia por handler.
// ============================================================================
import type { RenderedOfferItem } from "../domain/conversation-state.ts";
import type { DecisionMutation, TurnInterpretation } from "../domain/decision.ts";
import type { Id } from "../domain/types.ts";

// P0 (Codex 2026-07-01): decide se o turno executou uma BUSCA/direção comercial REALMENTE NOVA — o ÚNICO
// gatilho que invalida o selectedVehicleFocus. É baseado na AÇÃO do turno, NÃO em palavras do lead:
//   • pedido de FOTO ou de DETALHE (preço/câmbio/cor/ano/km) do carro atual  -> NÃO é busca nova (preserva);
//   • uma NOVA lista de oferta foi renderizada (>=1 item)                     -> busca nova (invalida);
//   • uma busca explícita nova NÃO encontrou nada (kind "none")               -> busca nova (invalida).
// Assim "manda foto do Onix" / "e o câmbio dele?" NUNCA limpam o foco só por citarem/─referirem um modelo.
export function isNewSearchTurn(args: {
  isPhotoIntent: boolean;
  relation: TurnInterpretation["relation"];
  renderedItemCount: number;
  explicitSearchKind: string | null;
}): boolean {
  const isPhotoOrDetailTurn = args.isPhotoIntent || args.relation === "asks_vehicle_detail";
  if (isPhotoOrDetailTurn) return false;
  const newSearchNoResult = args.explicitSearchKind === "none";
  return args.renderedItemCount > 0 || newSearchNoResult;
}

export function focusInvalidationMutations(
  isNewCommercialIntent: boolean,
  renderedItems: readonly RenderedOfferItem[],
  turnId: Id,
): DecisionMutation[] {
  if (!isNewCommercialIntent) return [];
  const muts: DecisionMutation[] = [{ op: "clear_vehicle_focus", sourceTurnId: turnId }];
  if (renderedItems.length === 1) {
    const v = renderedItems[0];
    const label = [v.marca, v.modelo, v.ano].filter(Boolean).join(" ").trim();
    muts.push({ op: "select_vehicle_focus", vehicle: { kind: "vehicle", key: v.vehicleKey, label }, sourceTurnId: turnId });
  }
  return muts;
}
