import {
  buildPedroV3BridgeTurn,
  buildPedroV3DeliveryReceipt,
  classifyPedroV3BridgeResponse,
  conversationHasV3Routing,
  conversationHasV3State,
  shouldFallbackToPedroV2,
  shouldBridgePedroV3Identity,
} from "./pedroV3Bridge.ts";
import { matchesAnyInternalPhone } from "./contactIdentity.ts";
import { evaluatePostTransferAction, POST_TRANSFER_HOLD_MS, POST_TRANSFER_SILENCE_MS } from "./postTransferOwnership.ts";

type TestFn = () => void | Promise<void>;

const tests: Array<{ name: string; fn: TestFn }> = [];

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

type QueryResult = { data: unknown; error: unknown } | (() => never);

function fakeClient(result: QueryResult | Record<string, QueryResult>) {
  return {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          const tableResult =
            "data" in result || "error" in result || typeof result === "function"
              ? (result as QueryResult)
              : (result as Record<string, QueryResult>)[table] ?? { data: null, error: null };
          if (typeof tableResult === "function") tableResult();
          return tableResult;
        },
      };
      return query;
    },
  };
}

test("C-1: ingested=false is pre_ingest_failure", () => {
  const result = classifyPedroV3BridgeResponse(200, { ingested: false, status: "commit_failed" });
  assert(result.kind === "pre_ingest_failure", `expected pre_ingest_failure, got ${result.kind}`);
});

test("C-2: accepted turn does not become fallback", () => {
  const result = classifyPedroV3BridgeResponse(200, { ingested: true, status: "ok" });
  assert(result.kind === "accepted", `expected accepted, got ${result.kind}`);
});

test("C-3: duplicate/no_op accepted turn does not become fallback", () => {
  const result = classifyPedroV3BridgeResponse(200, { ingested: true, status: "duplicate", dispatched: 0 });
  assert(result.kind === "accepted", `expected accepted, got ${result.kind}`);
});

test("C-4: commit_failed after ingest but before dispatch can fallback", () => {
  const result = classifyPedroV3BridgeResponse(200, { ingested: true, status: "commit_failed", dispatched: 0 });
  assert(result.kind === "pre_ingest_failure", `expected pre_ingest_failure, got ${result.kind}`);
});

test("C-5: unknown response is uncertain", () => {
  const result = classifyPedroV3BridgeResponse(500, { status: "oops" });
  assert(result.kind === "uncertain", `expected uncertain, got ${result.kind}`);
});

test("S-1: accepted never falls back to v2", () => {
  const result = shouldFallbackToPedroV2({ classification: "accepted", hasV3Routing: false, hasV3State: false });
  assert(result.fallback === false, "accepted should not fallback");
});

test("S-2: uncertain never falls back to v2", () => {
  const result = shouldFallbackToPedroV2({ classification: "uncertain", hasV3Routing: false, hasV3State: false });
  assert(result.fallback === false, "uncertain should not fallback");
});

test("S-3: pre_ingest_failure falls back only before v3 ownership", () => {
  const result = shouldFallbackToPedroV2({ classification: "pre_ingest_failure", hasV3Routing: false, hasV3State: false });
  assert(result.fallback === true, "pre_ingest_failure without ownership should fallback");
});

test("S-3b: exclusive v3 scope never falls back before first ingestion", () => {
  const result = shouldFallbackToPedroV2({
    classification: "pre_ingest_failure",
    hasV3Routing: false,
    hasV3State: false,
    exclusiveOwnership: true,
  });
  assert(result.fallback === false, "exclusive scope must never invoke the v2 conversational agent");
  assert(result.reason === "v3_exclusive_scope_blocked_v2_fallback", `unexpected reason ${result.reason}`);
});

test("S-4: v3 routing blocks v2 fallback", () => {
  const result = shouldFallbackToPedroV2({ classification: "pre_ingest_failure", hasV3Routing: true, hasV3State: false });
  assert(result.fallback === false, "routing should block fallback");
  assert(result.reason === "v3_sticky_route_blocked_v2_fallback", `unexpected reason ${result.reason}`);
});

test("S-5: v3 state blocks v2 fallback even without routing", () => {
  const result = shouldFallbackToPedroV2({ classification: "pre_ingest_failure", hasV3Routing: false, hasV3State: true });
  assert(result.fallback === false, "state should block fallback");
  assert(result.reason === "v3_sticky_route_blocked_v2_fallback", `unexpected reason ${result.reason}`);
});

test("R-1: routing present returns true", async () => {
  const result = await conversationHasV3Routing(fakeClient({ data: { conversation_id: "c1" }, error: null }), "t1", "c1");
  assert(result === true, "routing row should be true");
});

test("R-2: routing absent returns false", async () => {
  const result = await conversationHasV3Routing(fakeClient({ data: null, error: null }), "t1", "c1");
  assert(result === false, "missing routing row should be false");
});

test("R-3: routing error fail-closes true", async () => {
  const result = await conversationHasV3Routing(fakeClient({ data: null, error: { message: "db" } }), "t1", "c1");
  assert(result === true, "routing error should fail-close true");
});

test("R-4: routing exception fail-closes true", async () => {
  const result = await conversationHasV3Routing(fakeClient(() => {
    throw new Error("boom");
  }), "t1", "c1");
  assert(result === true, "routing exception should fail-close true");
});

test("R-5: state present returns true", async () => {
  const result = await conversationHasV3State(fakeClient({ data: { conversation_id: "c1" }, error: null }), "t1", "c1");
  assert(result === true, "state row should be true");
});

test("R-6: state absent returns false", async () => {
  const result = await conversationHasV3State(fakeClient({ data: null, error: null }), "t1", "c1");
  assert(result === false, "missing state row should be false");
});

test("R-7: state error fail-closes true", async () => {
  const result = await conversationHasV3State(fakeClient({ data: null, error: { message: "db" } }), "t1", "c1");
  assert(result === true, "state error should fail-close true");
});

test("M-1: routed v3 conversation blocks v2 when phone turn is pre-ingest failure", () => {
  const classification = classifyPedroV3BridgeResponse(200, { ingested: false, status: "commit_failed" }).kind;
  const result = shouldFallbackToPedroV2({ classification, hasV3Routing: true, hasV3State: true });
  assert(result.fallback === false, "routed v3 conversation should not fallback to v2");
});

test("M-2: commit_failed with v3 ownership blocks v2", () => {
  const classification = classifyPedroV3BridgeResponse(200, { ingested: true, status: "commit_failed", dispatched: 0 }).kind;
  const result = shouldFallbackToPedroV2({ classification, hasV3Routing: true, hasV3State: true });
  assert(result.fallback === false, "owned v3 conversation should not fallback after commit_failed");
});

test("M-3: no routing and no state may fallback before v3 owns the conversation", () => {
  const classification = classifyPedroV3BridgeResponse(200, { ingested: false, status: "commit_failed" }).kind;
  const result = shouldFallbackToPedroV2({ classification, hasV3Routing: false, hasV3State: false });
  assert(result.fallback === true, "conversation with no v3 ownership may fallback");
});

test("M-3b: active cutover keeps v2 disabled even without persisted v3 state", () => {
  const classification = classifyPedroV3BridgeResponse(200, { ingested: false, status: "commit_failed" }).kind;
  const result = shouldFallbackToPedroV2({
    classification,
    hasV3Routing: false,
    hasV3State: false,
    exclusiveOwnership: true,
  });
  assert(result.fallback === false, "exclusive cutover must fail closed to v3");
});

test("M-4: state-only v3 ownership blocks v2 fallback", async () => {
  const client = fakeClient({
    v3_conversation_routing: { data: null, error: null },
    v3_conversation_state: { data: { conversation_id: "c1" }, error: null },
  });
  const hasRouting = await conversationHasV3Routing(client, "t1", "c1");
  const hasState = await conversationHasV3State(client, "t1", "c1");
  const classification = classifyPedroV3BridgeResponse(200, { ingested: false, status: "commit_failed" }).kind;
  const result = shouldFallbackToPedroV2({ classification, hasV3Routing: hasRouting, hasV3State: hasState });
  assert(hasRouting === false, "routing should be absent");
  assert(hasState === true, "state should be present");
  assert(result.fallback === false, "state-only ownership should block fallback");
});

test("HF-1: seller identity never enters Pedro v3", () => {
  assert(shouldBridgePedroV3Identity("seller") === false, "seller must stay in v2 ack flow");
});

test("HF-2: lead identity still enters Pedro v3", () => {
  assert(shouldBridgePedroV3Identity("lead") === true, "lead must stay routed to v3");
});

test("HF-3: unknown identity does not silently drop the lead", () => {
  assert(shouldBridgePedroV3Identity("unknown") === true, "unknown should remain on guarded v3 path");
});

test("HF-4: another connected agent line never enters Pedro v3", () => {
  assert(shouldBridgePedroV3Identity("internal") === false, "connected AI line must never become a lead");
});

test("HF-5: tenant manager never enters Pedro v3", () => {
  assert(shouldBridgePedroV3Identity("manager") === false, "manager must never become a lead");
});

test("HF-6: phone normalization identifies another connected agent line", () => {
  assert(matchesAnyInternalPhone("551231972498", ["+55 12 3197-2498"]), "formatted internal number must match");
});

test("PT-1: first 30 minutes are silent", () => {
  const nowMs = Date.parse("2026-07-15T12:20:00.000Z");
  const result = evaluatePostTransferAction({
    transferCreatedAt: new Date(nowMs - POST_TRANSFER_SILENCE_MS + 1).toISOString(),
    transferStatus: "pending",
    nowMs,
  });
  assert(result.action === "silence", `expected silence, got ${result.action}`);
  assert(!result.notifyLead && !result.notifySeller, "silence must notify nobody");
});

test("PT-2: after 30 minutes both notices are due once", () => {
  const nowMs = Date.parse("2026-07-15T13:00:00.000Z");
  const result = evaluatePostTransferAction({
    transferCreatedAt: new Date(nowMs - POST_TRANSFER_SILENCE_MS).toISOString(),
    transferStatus: "confirmed",
    nowMs,
  });
  assert(result.action === "notice_once", `expected notice_once, got ${result.action}`);
  assert(result.notifyLead && result.notifySeller, "lead and seller notices must both be due");
});

test("PT-3: notices already recorded keep the conversation held without duplicates", () => {
  const nowMs = Date.parse("2026-07-15T14:00:00.000Z");
  const transferCreatedAt = new Date(nowMs - 60 * 60_000).toISOString();
  const noticedAt = new Date(nowMs - 10 * 60_000).toISOString();
  const result = evaluatePostTransferAction({
    transferCreatedAt,
    transferStatus: "confirmed",
    leadNoticeAt: noticedAt,
    sellerNoticeAt: noticedAt,
    nowMs,
  });
  assert(result.action === "hold", `expected hold, got ${result.action}`);
  assert(!result.notifyLead && !result.notifySeller, "recorded notices must not repeat");
});

test("PT-4: after 24 hours the LLM may serve the lead again", () => {
  const nowMs = Date.parse("2026-07-15T14:00:00.000Z");
  const result = evaluatePostTransferAction({
    transferCreatedAt: new Date(nowMs - POST_TRANSFER_HOLD_MS).toISOString(),
    transferStatus: "confirmed",
    nowMs,
  });
  assert(result.action === "continue", `expected continue, got ${result.action}`);
});

test("PT-5: failed transfer never captures the conversation", () => {
  const nowMs = Date.parse("2026-07-15T14:00:00.000Z");
  const result = evaluatePostTransferAction({
    transferCreatedAt: new Date(nowMs - 60_000).toISOString(),
    transferStatus: "failed",
    nowMs,
  });
  assert(result.action === "continue", `expected continue, got ${result.action}`);
});

// ── MISSÃO PII (P0-D): entrega NUMÉRICA edge→v3 com payloads uazapi realistas. Causa-raiz do incidente
//    2026-07-11: mensagens com run de 11 dígitos sumiam (CHECK do inbox rejeitava o INSERT no serviço).
//    O BRIDGE nunca pode descartar/alterar texto numérico — a sanitização é do INGEST (serviço). Aqui
//    provamos: texto numérico passa ÍNTEGRO, ids distintos nunca colidem, mesmo id dedupa, e o bridge
//    não loga conteúdo de mensagem (nenhum console.* com o texto). CPF SINTÉTICO 111.444.777-35. ────────────
const PILOT_TENANT = "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0";
const PILOT_AGENT = "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185";
function uazapiTextPayload(id: string, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    EventType: "messages",
    message: {
      messageid: id,
      sender_pn: "5512988887777@s.whatsapp.net",
      chatid: "5512988887777@s.whatsapp.net",
      text,
      pushName: "Douglas Aloan",
      messageTimestamp: 1_783_784_230,
      ...extra,
    },
  };
}

test("PII-1: texto com 11 dígitos (CPF sintético) atravessa o bridge ÍNTEGRO", async () => {
  const built = await buildPedroV3BridgeTurn({ payload: uazapiTextPayload("wamid.pii1", "11144477735"), tenantId: PILOT_TENANT, agentId: PILOT_AGENT, build: "test" });
  assert(built.ok, "bridge must forward numeric-only message");
  if (built.ok) assert(built.turn.messageText === "11144477735", "bridge must not mutate/drop the numeric text");
});

test("PII-2: data DD/MM/AAAA atravessa o bridge ÍNTEGRA", async () => {
  const built = await buildPedroV3BridgeTurn({ payload: uazapiTextPayload("wamid.pii2", "01/10/1997"), tenantId: PILOT_TENANT, agentId: PILOT_AGENT, build: "test" });
  assert(built.ok && built.turn.messageText === "01/10/1997", "bridge must forward the date verbatim");
});

test("PII-3: CPF e data em mensagens separadas geram eventIds DISTINTOS (nunca dedupam entre si)", async () => {
  const a = await buildPedroV3BridgeTurn({ payload: uazapiTextPayload("wamid.pii3a", "11144477735"), tenantId: PILOT_TENANT, agentId: PILOT_AGENT, build: "test" });
  const b = await buildPedroV3BridgeTurn({ payload: uazapiTextPayload("wamid.pii3b", "01/10/1997"), tenantId: PILOT_TENANT, agentId: PILOT_AGENT, build: "test" });
  assert(a.ok && b.ok, "both messages must build");
  if (a.ok && b.ok) {
    assert(a.turn.eventId !== b.turn.eventId, "distinct message ids must never share an eventId");
    assert(a.turn.conversationId === b.turn.conversationId, "same contact must share the conversation");
  }
});

test("PII-4: mesmo message id gera o MESMO eventId (dedupe legítimo preservado)", async () => {
  const a = await buildPedroV3BridgeTurn({ payload: uazapiTextPayload("wamid.pii4", "CPF 111.444.777-35 data: 01/10/1997"), tenantId: PILOT_TENANT, agentId: PILOT_AGENT, build: "test" });
  const b = await buildPedroV3BridgeTurn({ payload: uazapiTextPayload("wamid.pii4", "CPF 111.444.777-35 data: 01/10/1997"), tenantId: PILOT_TENANT, agentId: PILOT_AGENT, build: "test" });
  assert(a.ok && b.ok && a.turn.eventId === b.turn.eventId, "retry of the same message must dedupe by eventId");
});

test("PII-5: messages_update NÃO vira turno de mensagem (é receipt)", () => {
  const receipt = buildPedroV3DeliveryReceipt({
    payload: { EventType: "messages_update", message: { messageid: "wamid.pii5", status: "delivered" } },
    tenantId: PILOT_TENANT, agentId: PILOT_AGENT,
  });
  assert(receipt.ok, "delivery update must be classified as receipt");
});

test("PII-6: bridge não imprime conteúdo de mensagem em log", async () => {
  const logged: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a: unknown[]) => { logged.push(a.join(" ")); };
  console.warn = console.log; console.error = console.log;
  try {
    await buildPedroV3BridgeTurn({ payload: uazapiTextPayload("wamid.pii6", "11144477735"), tenantId: PILOT_TENANT, agentId: PILOT_AGENT, build: "test" });
  } finally {
    console.log = orig.log; console.warn = orig.warn; console.error = orig.error;
  }
  assert(!logged.some((l) => l.includes("11144477735")), "bridge must never log message content");
});

test("MEDIA-1: audio sem texto entra no v3 com contexto", async () => {
  const payload = uazapiTextPayload("wamid.media1", "");
  delete (payload.message as Record<string, unknown>).text;
  (payload.message as Record<string, unknown>).messageType = "audio";
  const built = await buildPedroV3BridgeTurn({
    payload, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, build: "test",
    mediaContext: {
      kind: "audio", text: "procuro um Corolla automatico", summary: null,
      vehicleQuery: "Toyota Corolla", vehicleType: "sedan", confidence: 0.9, transcriptionAvailable: true,
    },
  });
  assert(built.ok, "media context must make the bridge turn ingestible");
  if (built.ok) {
    assert(built.turn.messageText.includes("Corolla"), "transcript must be visible to the v3 brain");
    assert(built.turn.mediaContext?.kind === "audio", "media metadata must cross the bridge");
  }
});

test("MEDIA-2: image without OCR reaches v3 honestly", async () => {
  const payload = uazapiTextPayload("wamid.media2", "");
  delete (payload.message as Record<string, unknown>).text;
  (payload.message as Record<string, unknown>).messageType = "image";
  const built = await buildPedroV3BridgeTurn({
    payload, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, build: "test",
    mediaContext: { kind: "image", text: null, summary: null, vehicleQuery: null, vehicleType: null, confidence: 0, transcriptionAvailable: null },
  });
  assert(built.ok, "image marker must not be rejected as text_unsupported");
  if (built.ok) assert(built.turn.messageText.includes("image"), "brain must receive an honest image marker");
});

test("MEDIA-3: caption and extracted media context reach the brain together", async () => {
  const payload = uazapiTextPayload("wamid.media3", "quero saber se esse carro esta disponivel");
  (payload.message as Record<string, unknown>).messageType = "image";
  const built = await buildPedroV3BridgeTurn({
    payload, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, build: "test",
    mediaContext: { kind: "image", text: "foto de um Toyota Corolla", summary: null, vehicleQuery: "Toyota Corolla", vehicleType: "sedan", confidence: 0.8, transcriptionAvailable: null },
  });
  assert(built.ok, "captioned media must build a turn");
  if (built.ok) {
    assert(built.turn.messageText.includes("esse carro esta disponivel"), "caption must remain primary context");
    assert(built.turn.messageText.includes("Toyota Corolla"), "extracted media context must enrich the caption");
  }
});

async function main(): Promise<void> {
  let passed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
    } catch (error) {
      console.error(`FAIL ${item.name}`);
      console.error(error);
      process.exit(1);
    }
  }
  console.log(`INC1 bridge: ${passed} OK`);
}

void main();
