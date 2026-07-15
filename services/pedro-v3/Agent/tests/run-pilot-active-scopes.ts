import { PilotHttpApp, type PilotTurnPayload, type PilotTurnRunner } from "../src/runtime/pilot-http-app.ts";
import type { PilotActiveTurnResult } from "../src/engine/pilot-active-root.ts";
import {
  PEDRO_V3_PILOT_AGENT_ID,
  PEDRO_V3_PILOT_TENANT_ID,
  parsePedroV3ActiveScopes,
} from "../src/domain/pilot-scope.ts";

const SECRET = "bridge-secret-with-more-than-thirty-two-characters";
const BRUNO_SCOPE = {
  tenantId: "f49fd48a-4386-4009-95f3-26a5100b84f7",
  agentId: "aee7e916-31b1-431c-ba6f-f38178fd4899",
} as const;

let ok = 0;
let failed = 0;
function check(name: string, pass: boolean): void {
  if (pass) { ok += 1; console.log(`  OK  ${name}`); }
  else { failed += 1; console.error(`  RED ${name}`); }
}

class CapturingRunner implements PilotTurnRunner {
  readonly calls: PilotTurnPayload[] = [];
  async run(payload: PilotTurnPayload): Promise<PilotActiveTurnResult> {
    this.calls.push(payload);
    return { status: "committed", inserted: true, engine: { status: "committed" } as never, outboxBeforeDispatch: [], outboxAfterDispatch: [], dispatched: 0 };
  }
}

function turn(scope: { tenantId: string; agentId: string }): PilotTurnPayload {
  return {
    ...scope,
    conversationId: "wa:scope-test",
    turnId: "turn:scope-test",
    eventId: "event:scope-test",
    workerId: "edge:test",
    to: "5512999999999",
    messageText: "Tem SUV?",
    receivedAt: "2026-07-14T12:00:00.000Z",
    leadId: null,
  };
}

function request(payload: PilotTurnPayload) {
  return {
    method: "POST",
    pathname: "/v1/pilot/turn",
    authorization: `Bearer ${SECRET}`,
    contentType: "application/json",
    bodyText: JSON.stringify(payload),
  };
}

console.log("Pedro v3 active scopes:");

const activeScopes = parsePedroV3ActiveScopes(JSON.stringify([
  { tenantId: PEDRO_V3_PILOT_TENANT_ID, agentId: PEDRO_V3_PILOT_AGENT_ID },
  BRUNO_SCOPE,
]));
const runner = new CapturingRunner();
const app = new PilotHttpApp(SECRET, runner, undefined, undefined, activeScopes);

const brunoAccepted = await app.handle(request(turn(BRUNO_SCOPE)));
check("escopo Bruno autorizado chega ao runner", brunoAccepted.status === 200 && runner.calls.length === 1 && runner.calls[0]?.agentId === BRUNO_SCOPE.agentId);

const crossedRejected = await app.handle(request(turn({ tenantId: BRUNO_SCOPE.tenantId, agentId: PEDRO_V3_PILOT_AGENT_ID })));
check("par cruzado Bruno/Douglas falha fechado", crossedRejected.status === 403 && runner.calls.length === 1);

const unknownRejected = await app.handle(request(turn({ tenantId: "5f2a9543-4d60-4623-9c3f-f3c35b3b44a8", agentId: BRUNO_SCOPE.agentId })));
check("tenant desconhecido falha fechado", unknownRejected.status === 403 && runner.calls.length === 1);

if (failed > 0) {
  console.error(`=== ACTIVE SCOPES: ${ok} OK | ${failed} FALHA ===`);
  process.exit(1);
}
console.log(`=== ACTIVE SCOPES: ${ok} OK | 0 FALHA ===`);
