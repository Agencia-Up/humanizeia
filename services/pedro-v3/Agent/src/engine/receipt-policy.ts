// Compatibility export. The policy lives in domain so persistence adapters and
// engines use exactly the same receipt/dependency rules.
export {
  isCriticalForConversationState,
  isEffectSatisfiedForDependency,
  requiredReceiptFor,
} from "../domain/effect-policy.ts";
