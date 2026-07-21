// F2.71 — políticas do cliente são declaração grounded da LLM, não roteamento da engine.
import { validateTurnUnderstanding } from "../src/engine/turn-understanding.ts";
import type { TurnUnderstanding } from "../src/domain/agent-brain.ts";

let ok = 0;
let fail = 0;
function check(label: string, condition: boolean): void {
  if (condition) { ok++; console.log(`  OK  ${label}`); }
  else { fail++; console.error(`  RED ${label}`); }
}

const policies = [{
  id: "sem_entrada",
  enabled: true,
  name: "Sem entrada",
  domain: "financial",
  when: "o lead informa que não possui entrada",
  action: "disqualify",
  responseGuidance: "encerre cordialmente conforme o prompt da empresa",
  evidenceRequirement: "fala literal do lead sobre não possuir entrada",
  priority: 10,
}];

const base = (policyDecision?: TurnUnderstanding["policyDecision"]): TurnUnderstanding => ({
  primaryIntent: "financing",
  requestedCapabilities: [],
  subject: "budget",
  subjectValue: null,
  subjectSource: "current_turn",
  evidence: [{ capability: undefined, quote: "não tenho entrada" }],
  isTopicChange: false,
  answeredLeadQuestions: [],
  policyDecision,
});

const valid = validateTurnUnderstanding(
  base({ policyId: "sem_entrada", action: "disqualify", evidence: "não tenho entrada" }),
  "Eu não tenho entrada",
  true,
  { tenantPolicies: policies },
);
check("declaração válida é trusted", valid.trusted && (valid.semanticIssues?.length ?? 0) === 0);

const wrongAction = validateTurnUnderstanding(
  base({ policyId: "sem_entrada", action: "continue", evidence: "não tenho entrada" }),
  "Eu não tenho entrada",
  true,
  { tenantPolicies: policies },
);
check("ação divergente é rejeitada sem decidir outra ação", !wrongAction.trusted && (wrongAction.semanticIssues ?? []).some((issue) => issue.includes("ação declarada")));

const inventedEvidence = validateTurnUnderstanding(
  base({ policyId: "sem_entrada", action: "disqualify", evidence: "moro em outro estado" }),
  "Eu não tenho entrada",
  true,
  { tenantPolicies: policies },
);
check("evidência inventada é rejeitada", !inventedEvidence.trusted && (inventedEvidence.semanticIssues ?? []).some((issue) => issue.includes("não aparece literalmente")));

const noPolicy = validateTurnUnderstanding(base(), "Eu não tenho entrada", true);
check("ausência de declaração mantém compatibilidade", noPolicy.trusted && (noPolicy.semanticIssues?.length ?? 0) === 0);

console.log(`F2.71: ${ok} OK | ${fail} FALHA`);
if (fail > 0) process.exit(1);
