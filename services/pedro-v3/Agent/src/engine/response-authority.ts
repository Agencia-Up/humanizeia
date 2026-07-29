/**
 * Defines the only hard-rejection boundary allowed after the LLM authors a
 * response. Conversation strategy belongs to the portal prompt and the LLM.
 * The active engine may reject only machine-verifiable structural/safety
 * contradictions; it must not grade natural language or sales conduct.
 */
export type ResponseAuthorityMode =
  | "legacy_strict"
  | "legacy_without_style"
  | "central_active";

export type ResponseAuthorityInput = ResponseAuthorityMode | boolean | undefined;

export type ResponseAuthorityProfile = Readonly<{
  mode: ResponseAuthorityMode;
  /** Greeting, question count, acknowledgements and other wording choices. */
  conversationalTextVeto: boolean;
  /** Funnel order, price-ceiling strategy and other commercial choices. */
  commercialPolicyVeto: boolean;
  /** Claims inferred by parsing prose after generation. */
  lexicalGroundingVeto: boolean;
  /** Invalid vehicle_ref, money_ref, offer-list keys and equivalent parts. */
  structuredGroundingVeto: true;
  /** Effects/tools that cannot execute or target a different resource. */
  executableEffectVeto: true;
  /** Internal keys, sensitive references and secrets in outgoing content. */
  sensitiveLeakVeto: true;
}>;

/**
 * Boolean compatibility is intentionally preserved for older isolated tests:
 * `true` was the old `skipStyleChecks` flag, not the full central-active
 * authority boundary. Production must pass the explicit `central_active` mode.
 */
export function normalizeResponseAuthority(input: ResponseAuthorityInput): ResponseAuthorityMode {
  if (input === "central_active" || input === "legacy_without_style" || input === "legacy_strict") return input;
  return input === true ? "legacy_without_style" : "legacy_strict";
}

export function responseAuthorityProfile(input: ResponseAuthorityInput): ResponseAuthorityProfile {
  const mode = normalizeResponseAuthority(input);
  if (mode === "central_active") {
    return {
      mode,
      conversationalTextVeto: false,
      commercialPolicyVeto: false,
      lexicalGroundingVeto: false,
      structuredGroundingVeto: true,
      executableEffectVeto: true,
      sensitiveLeakVeto: true,
    };
  }
  if (mode === "legacy_without_style") {
    return {
      mode,
      conversationalTextVeto: false,
      commercialPolicyVeto: true,
      lexicalGroundingVeto: true,
      structuredGroundingVeto: true,
      executableEffectVeto: true,
      sensitiveLeakVeto: true,
    };
  }
  return {
    mode,
    conversationalTextVeto: true,
    commercialPolicyVeto: true,
    lexicalGroundingVeto: true,
    structuredGroundingVeto: true,
    executableEffectVeto: true,
    sensitiveLeakVeto: true,
  };
}
