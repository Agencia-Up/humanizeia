import { buildPedroV3BridgeTurn, buildPedroV3DeliveryReceipt } from "./pedroV3Bridge.ts";
import {
  evaluatePedroV3PilotAgent,
  isPedroV3ExclusiveScope,
  parsePedroV3ActiveScopes,
} from "./pedroV3PilotGate.ts";

const DOUGLAS = { tenantId: "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0", agentId: "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185" };
const BRUNO = { tenantId: "f49fd48a-4386-4009-95f3-26a5100b84f7", agentId: "aee7e916-31b1-431c-ba6f-f38178fd4899" };
const AVANT = { tenantId: "7e23b020-0377-4120-a6a4-502701d62208", agentId: "03421f26-f4e3-48f1-a791-24fc438e9b3d" };

let ok = 0;
let failed = 0;
function check(name: string, pass: boolean): void {
  if (pass) { ok += 1; console.log(`  OK  ${name}`); }
  else { failed += 1; console.error(`  RED ${name}`); }
}

function payload(messageId: string, text: string) {
  return {
    EventType: "messages",
    message: {
      messageid: messageId,
      sender_pn: "5512988887777@s.whatsapp.net",
      chatid: "5512988887777@s.whatsapp.net",
      text,
    },
  };
}

console.log("Pedro v3 edge active scopes:");
const scopes = parsePedroV3ActiveScopes(JSON.stringify([DOUGLAS, BRUNO, AVANT]));

const agentDecision = evaluatePedroV3PilotAgent({ id: BRUNO.agentId, user_id: BRUNO.tenantId }, null, "active", scopes);
check("gate Edge aceita Bruno somente pela allowlist", agentDecision.enabled && agentDecision.mode === "active");

const avantDecision = evaluatePedroV3PilotAgent({ id: AVANT.agentId, user_id: AVANT.tenantId }, null, "active", scopes);
check("gate Edge aceita Avant/Manu pela allowlist", avantDecision.enabled && avantDecision.mode === "active");
check("workers v2 bloqueiam Avant/Manu quando o escopo v3 esta active", isPedroV3ExclusiveScope({
  ...AVANT,
  mode: "active",
  activeScopes: scopes,
}));

const crossDecision = evaluatePedroV3PilotAgent({ id: DOUGLAS.agentId, user_id: BRUNO.tenantId }, null, "active", scopes);
check("gate Edge rejeita tenant Bruno com agente Douglas", !crossDecision.enabled);

check("workers v2 bloqueiam Bruno quando o escopo v3 esta active", isPedroV3ExclusiveScope({
  ...BRUNO,
  mode: "active",
  activeScopes: scopes,
}));

check("workers v2 nao bloqueiam Bruno quando o v3 esta shadow", !isPedroV3ExclusiveScope({
  ...BRUNO,
  mode: "shadow",
  activeScopes: scopes,
}));

check("workers v2 nao bloqueiam identidade cruzada", !isPedroV3ExclusiveScope({
  tenantId: BRUNO.tenantId,
  agentId: DOUGLAS.agentId,
  mode: "active",
  activeScopes: scopes,
}));

const brunoTurn = await buildPedroV3BridgeTurn({ payload: payload("wamid.bruno.1", "Tem HB20?"), ...BRUNO, build: "test", activeScopes: scopes });
check("bridge mantém tenant e agent Bruno no turno", brunoTurn.ok && brunoTurn.turn.tenantId === BRUNO.tenantId && brunoTurn.turn.agentId === BRUNO.agentId);

const crossTurn = await buildPedroV3BridgeTurn({ payload: payload("wamid.bruno.2", "Tem HB20?"), tenantId: BRUNO.tenantId, agentId: DOUGLAS.agentId, build: "test", activeScopes: scopes });
check("bridge fecha turno de identidade cruzada", !crossTurn.ok && crossTurn.reason === "not_pilot_identity");

const receipt = buildPedroV3DeliveryReceipt({
  payload: { EventType: "messages_update", message: { messageid: "wamid.bruno.receipt", status: "delivered" } },
  ...BRUNO,
  activeScopes: scopes,
});
check("receipt entrega identidade Bruno ao runtime", receipt.ok && receipt.receipt.tenantId === BRUNO.tenantId && receipt.receipt.agentId === BRUNO.agentId);

if (failed > 0) {
  console.error(`=== EDGE ACTIVE SCOPES: ${ok} OK | ${failed} FALHA ===`);
  process.exit(1);
}
console.log(`=== EDGE ACTIVE SCOPES: ${ok} OK | 0 FALHA ===`);
