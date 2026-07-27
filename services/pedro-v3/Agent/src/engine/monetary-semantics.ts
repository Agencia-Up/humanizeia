import type { TurnMonetaryMention, TurnUnderstanding } from "../domain/agent-brain.ts";
import { MONETARY_ROLES } from "../domain/agent-brain.ts";
import type { QueryInputMap } from "../domain/decision.ts";
import type { CommercialConstraints } from "./commercial-constraints.ts";
import { normalizeText } from "./catalog-utils.ts";
import { leadStatedMoneyValues } from "./lead-extraction.ts";

export type ValidatedMonetarySemantics = {
  /** true only when every amount in the current block has valid, literal metadata. */
  readonly authoritative: boolean;
  readonly mentions: readonly TurnMonetaryMention[];
  readonly blockValues: readonly number[];
  readonly searchBudget: number | null;
};

function sameMoney(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.round(a) === Math.round(b);
}

function literalQuoteInBlock(block: string, quote: string): boolean {
  const normalizedBlock = normalizeText(block);
  const normalizedQuote = normalizeText(quote).trim();
  return normalizedQuote.length >= 2 && normalizedBlock.includes(normalizedQuote);
}

/**
 * Validates the LLM's semantic role for money without classifying it again.
 * Invalid/incomplete metadata is non-authoritative; it never makes the whole
 * turn untrusted and never authorizes a stock ceiling by itself.
 */
export function validateMonetarySemantics(
  block: string,
  understanding: TurnUnderstanding | null | undefined,
): ValidatedMonetarySemantics {
  const blockValues = leadStatedMoneyValues(block);
  const declared = understanding?.monetaryMentions;
  if (declared == null) return { authoritative: false, mentions: [], blockValues, searchBudget: null };

  const valid = declared.filter((mention) => {
    if (!Number.isFinite(mention.value)
      || mention.value < 0
      || !(MONETARY_ROLES as readonly string[]).includes(mention.role)
      || !literalQuoteInBlock(block, mention.quote)) return false;
    const quoteValues = leadStatedMoneyValues(mention.quote);
    return quoteValues.some((value) => sameMoney(value, mention.value))
      && blockValues.some((value) => sameMoney(value, mention.value));
  });
  const coversAllBlockValues = blockValues.every((value) => valid.some((mention) => sameMoney(mention.value, value)));
  const authoritative = valid.length === declared.length && coversAllBlockValues;
  const searchBudgets = authoritative
    ? valid.filter((mention) => mention.role === "search_budget").map((mention) => mention.value)
    : [];
  return {
    authoritative,
    mentions: valid,
    blockValues,
    searchBudget: searchBudgets.length > 0 ? Math.max(...searchBudgets) : null,
  };
}

/**
 * Applies the CURRENT block's monetary meaning to a constraint set. An offer,
 * down payment, installment or any other non-budget amount cannot become a
 * stock ceiling. A previous ceiling is left untouched unless it is the same
 * literal amount being reclassified by the current block.
 */
export function applyMonetarySemanticsToCurrentConstraints(
  constraints: CommercialConstraints,
  block: string,
  understanding: TurnUnderstanding | null | undefined,
): CommercialConstraints {
  const semantics = validateMonetarySemantics(block, understanding);
  if (semantics.blockValues.length === 0) return constraints;
  if (semantics.authoritative && semantics.searchBudget != null) return { ...constraints, precoMax: semantics.searchBudget };
  // `undefined` exists only for legacy/scripted brains created before this
  // contract. Real adapters always normalize the field to an array. For a
  // current production decision, incomplete/invalid semantics must never
  // fall back to the lexical parser and silently hide inventory.
  if (understanding?.monetaryMentions == null) return constraints;
  if (constraints.precoMax == null || !semantics.blockValues.some((value) => sameMoney(value, constraints.precoMax!))) return constraints;
  const { precoMax: _notABudget, ...rest } = constraints;
  return rest;
}

/**
 * Prevents a model from reintroducing the current negotiation amount directly
 * in a stock_search call after it classified that amount as non-budget. The
 * engine still enriches the call with valid active/ad constraints afterwards.
 */
export function sanitizeStockSearchInputMoney(
  input: QueryInputMap["stock_search"],
  block: string,
  understanding: TurnUnderstanding | null | undefined,
): QueryInputMap["stock_search"] {
  const semantics = validateMonetarySemantics(block, understanding);
  if (semantics.blockValues.length === 0) return input;
  if (semantics.authoritative && semantics.searchBudget != null) return { ...input, precoMax: semantics.searchBudget };
  if (understanding?.monetaryMentions == null) return input;
  if (input.precoMax == null) return input;
  // A direct tool call is a fresh decision for this block. Once production
  // metadata says that none of its literal amounts is a search budget, no
  // price ceiling proposed by that same decision is authorized. A legitimate
  // persisted/ad ceiling is added later by `enrichStockSearchCall` from the
  // independently validated active scope.
  const { precoMax: _notABudget, ...rest } = input;
  return rest;
}
