// Pedro v3 pilot scope tests.
// Proves that only the owner's explicit tenant+agent pair can enter v3.

import {
  evaluatePedroV3PilotScope,
  normalizePilotMode,
  PEDRO_V3_PILOT_AGENT_ID,
  PEDRO_V3_PILOT_TENANT_ID,
} from "../src/domain/pilot-scope.ts";

let ok = 0;
let fail = 0;

function check(name: string, pass: boolean, detail = ""): void {
  if (pass) {
    ok += 1;
    console.log(`  OK  ${name}`);
  } else {
    fail += 1;
    console.error(`  RED ${name}${detail ? `: ${detail}` : ""}`);
  }
}

console.log("Pedro v3 pilot scope:");

check("modo shadow normaliza", normalizePilotMode("shadow") === "shadow");
check("modo active normaliza", normalizePilotMode("active") === "active");
check("modo desconhecido vira off", normalizePilotMode("prod") === "off");

{
  const decision = evaluatePedroV3PilotScope({
    tenantId: PEDRO_V3_PILOT_TENANT_ID,
    agentId: PEDRO_V3_PILOT_AGENT_ID,
    mode: "shadow",
  });
  check("tenant+agent exatos habilitam shadow", decision.enabled && decision.mode === "shadow", JSON.stringify(decision));
}

{
  const decision = evaluatePedroV3PilotScope({
    tenantId: PEDRO_V3_PILOT_TENANT_ID,
    agentId: PEDRO_V3_PILOT_AGENT_ID,
    mode: "active",
  });
  check("tenant+agent exatos habilitam active", decision.enabled && decision.mode === "active", JSON.stringify(decision));
}

{
  const decision = evaluatePedroV3PilotScope({
    tenantId: PEDRO_V3_PILOT_TENANT_ID,
    agentId: "agent-de-outro-cliente",
    mode: "active",
  });
  check("tenant certo com agent errado bloqueia", !decision.enabled && decision.reason === "not_pilot_identity", JSON.stringify(decision));
}

{
  const decision = evaluatePedroV3PilotScope({
    tenantId: "tenant-de-outro-cliente",
    agentId: PEDRO_V3_PILOT_AGENT_ID,
    mode: "active",
  });
  check("agent certo com tenant errado bloqueia", !decision.enabled && decision.reason === "not_pilot_identity", JSON.stringify(decision));
}

{
  const decision = evaluatePedroV3PilotScope({
    tenantId: PEDRO_V3_PILOT_TENANT_ID,
    agentId: PEDRO_V3_PILOT_AGENT_ID,
    mode: "off",
  });
  check("identidade piloto com mode off continua desligada", !decision.enabled && decision.reason === "pilot_disabled", JSON.stringify(decision));
}

if (fail > 0) {
  console.error(`=== PILOT SCOPE: ${ok} OK | ${fail} FALHA ===`);
  process.exit(1);
}

console.log(`=== PILOT SCOPE: ${ok} OK | 0 FALHA ===`);
