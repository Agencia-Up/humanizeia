// Structured, read-only conversation context for the LLM turn frame.
// It projects facts already committed in state/memory; it never classifies the
// lead, chooses a tool, or authors a commercial response.
import type { ConversationContext, ConversationContextOfferItem, WorkingMemoryV1 } from "../domain/agent-brain.ts";
import type { ConversationState, RenderedOfferItem } from "../domain/conversation-state.ts";

function lastAgentMessage(state: ConversationState): string | null {
  const turns = state.recentTurns ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.role === "agent") return turns[index].text;
  }
  return null;
}

function offerItem(item: RenderedOfferItem): ConversationContextOfferItem {
  return {
    ordinal: item.ordinal,
    vehicleKey: item.vehicleKey,
    marca: item.marca ?? null,
    modelo: item.modelo ?? null,
    ano: item.ano ?? null,
    cor: item.cor ?? null,
    preco: item.preco ?? null,
    cambio: item.cambio ?? null,
    tipo: item.tipo ?? null,
  };
}

export function buildConversationContext(args: {
  readonly state: ConversationState;
  readonly workingMemory: WorkingMemoryV1;
}): ConversationContext {
  const offer = args.state.lastRenderedOfferContext;
  const selected = args.workingMemory.selectedVehicle;
  const pending = args.workingMemory.pendingAgentQuestion;
  const resolved = args.workingMemory.lastResolvedSlotAnswer;
  const summary = args.workingMemory.conversationSummary.trim();

  return {
    lastAgentMessage: lastAgentMessage(args.state),
    pendingAgentQuestion: pending ? { slot: pending.slot, sinceTurnId: pending.sinceTurnId } : null,
    selectedVehicle: selected ? { vehicleKey: selected.vehicleKey, label: selected.label } : null,
    lastVisibleOffer: offer && offer.items.length > 0
      ? { sourceTurnId: offer.sourceTurnId, items: offer.items.map(offerItem) }
      : null,
    lastResolvedSlotAnswer: resolved ? { slot: resolved.slot, turnId: resolved.turnId } : null,
    conversationSummary: summary.length > 0 ? summary : null,
  };
}
