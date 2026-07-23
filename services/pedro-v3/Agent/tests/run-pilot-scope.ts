// Pedro v3 rollout tests.
// Proves the global rollout. Legacy mode values must not disable v3.

import {
  evaluatePedroV3PilotScope,
  parsePedroV3ActiveScopes,
  normalizePilotMode,
  PEDRO_V3_PILOT_AGENT_ID,
  PEDRO_V3_PILOT_TENANT_ID,
} from "../src/domain/pilot-scope.ts";

const BRUNO_SCOPE = {
  tenantId: "f49fd48a-4386-4009-95f3-26a5100b84f7",
  agentId: "aee7e916-31b1-431c-ba6f-f38178fd4899",
} as const;

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
  const scopes = parsePedroV3ActiveScopes(JSON.stringify([
    { tenantId: PEDRO_V3_PILOT_TENANT_ID, agentId: PEDRO_V3_PILOT_AGENT_ID },
    BRUNO_SCOPE,
  ]));
  check("allowlist explicita preserva dois pares tenant+agent", scopes.length === 2 && scopes[1]?.tenantId === BRUNO_SCOPE.tenantId);
  const decision = evaluatePedroV3PilotScope({ ...BRUNO_SCOPE, mode: "active", activeScopes: scopes });
  check("Bruno entra no v3 no rollout global", decision.enabled && decision.mode === "active", JSON.stringify(decision));
  const crossed = evaluatePedroV3PilotScope({ tenantId: BRUNO_SCOPE.tenantId, agentId: PEDRO_V3_PILOT_AGENT_ID, mode: "active", activeScopes: scopes });
  check("identidades fora da lista antiga tambem entram no rollout global", crossed.enabled, JSON.stringify(crossed));
}

{
  check("parser legado continua estavel sem exigir a variavel", parsePedroV3ActiveScopes(undefined).length === 1);
  for (const value of ["{", "[]", JSON.stringify([{ tenantId: BRUNO_SCOPE.tenantId, agentId: "invalido" }])]) {
    let rejected = false;
    try { parsePedroV3ActiveScopes(value); } catch { rejected = true; }
    check("allowlist malformada falha fechada", rejected);
  }
}

{
  const decision = evaluatePedroV3PilotScope({
    tenantId: PEDRO_V3_PILOT_TENANT_ID,
    agentId: PEDRO_V3_PILOT_AGENT_ID,
    mode: "shadow",
  });
  check("tenant+agent exatos ignoram shadow legado e ficam active", decision.enabled && decision.mode === "active", JSON.stringify(decision));
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
  check("tenant certo com outro agent entra no rollout global", decision.enabled, JSON.stringify(decision));
}

{
  const decision = evaluatePedroV3PilotScope({
    tenantId: "tenant-de-outro-cliente",
    agentId: PEDRO_V3_PILOT_AGENT_ID,
    mode: "active",
  });
  check("agent certo com outro tenant entra no rollout global", decision.enabled, JSON.stringify(decision));
}

{
  const decision = evaluatePedroV3PilotScope({
    tenantId: "tenant-novo",
    agentId: "agent-novo",
  });
  check("modo ausente ativa o v3 global", decision.enabled && decision.mode === "active", JSON.stringify(decision));
}

{
  const decision = evaluatePedroV3PilotScope({
    tenantId: PEDRO_V3_PILOT_TENANT_ID,
    agentId: PEDRO_V3_PILOT_AGENT_ID,
    mode: "off",
  });
  check("identidade piloto com mode off legado continua no v3", decision.enabled && decision.mode === "active", JSON.stringify(decision));
}

if (fail > 0) {
  console.error(`=== PILOT SCOPE: ${ok} OK | ${fail} FALHA ===`);
  process.exit(1);
}

console.log(`=== PILOT SCOPE: ${ok} OK | 0 FALHA ===`);
