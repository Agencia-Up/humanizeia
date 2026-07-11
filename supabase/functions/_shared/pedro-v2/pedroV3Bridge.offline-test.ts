import {
  classifyPedroV3BridgeResponse,
  conversationHasV3Routing,
  conversationHasV3State,
  shouldFallbackToPedroV2,
  shouldBridgePedroV3Identity,
} from "./pedroV3Bridge.ts";

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
