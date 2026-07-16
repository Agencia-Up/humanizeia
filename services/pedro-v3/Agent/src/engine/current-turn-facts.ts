// Read-only projection of facts deterministically extracted from the current
// inbound block. This is context for the LLM, never an alternate conductor.
import type { CurrentTurnFact, CurrentTurnFacts } from "../domain/agent-brain.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type { DecisionMutation } from "../domain/decision.ts";
import { normalizeText } from "./catalog-utils.ts";
import { inferredQuestionSlot, lastAgentQuestionText } from "./lead-extraction.ts";

function project(mutation: DecisionMutation): CurrentTurnFact | null {
  if (mutation.op === "decline_slot") return { slot: mutation.slot, kind: "declined" };
  if (mutation.op === "set_slot_ref") return { slot: mutation.slot, kind: "sensitive_ref" };
  if (mutation.op !== "set_slot") return null;
  return { slot: mutation.slot, kind: "value", value: mutation.value };
}

export function buildCurrentTurnFacts(args: {
  readonly state: ConversationState;
  readonly extracted: readonly DecisionMutation[];
  readonly block?: string;
}): CurrentTurnFacts {
  const expected = inferredQuestionSlot(args.state);
  const seen = new Set<string>();
  const extracted: CurrentTurnFact[] = [];
  for (const mutation of args.extracted) {
    const fact = project(mutation);
    if (!fact || seen.has(fact.slot)) continue;
    seen.add(fact.slot);
    extracted.push(fact);
  }
  const offerItems = args.state.lastRenderedOfferContext?.items ?? [];
  const normalizedBlock = normalizeText(args.block ?? "");
  type ReferenceField = "marca" | "modelo" | "ano" | "cor";
  const fields: readonly ReferenceField[] = ["marca", "modelo", "ano", "cor"];
  const occurs = (value: string): boolean => value.length > 1
    && new RegExp(`(^|\\s)${value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?=\\s|$)`).test(normalizedBlock);
  const mentioned = [...new Map(
    offerItems.flatMap((item) => fields.map((field) => ({
      field,
      value: normalizeText(item[field] == null ? "" : String(item[field])),
    })))
      .filter((reference) => occurs(reference.value))
      .map((reference) => [`${reference.field}:${reference.value}`, reference] as const),
  ).values()];
  const candidates = mentioned.length === 0
    ? []
    : offerItems.filter((item) => mentioned.every((reference) =>
      normalizeText(item[reference.field] == null ? "" : String(item[reference.field])) === reference.value,
    ));
  const offerReference = candidates.length > 0
    ? {
      status: candidates.length === 1 ? "unique" as const : "ambiguous" as const,
      candidateVehicleKeys: candidates.map((item) => item.vehicleKey),
      matchedBy: [...new Set(mentioned.map((reference) => reference.field))],
    }
    : null;
  return {
    expectedAnswer: {
      slot: expected,
      lastAgentQuestion: expected == null ? null : lastAgentQuestionText(args.state),
    },
    extracted,
    offerReference,
  };
}
