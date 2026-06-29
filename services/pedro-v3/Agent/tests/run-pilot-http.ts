import {
  PilotHttpApp,
  PilotHttpConfigError,
  PilotTurnRuntimeError,
  type PilotReceiptPayload,
  type PilotReceiptRunner,
  type PilotTurnPayload,
  type PilotTurnRunner,
} from "../src/runtime/pilot-http-app.ts";
import type { PilotActiveTurnResult } from "../src/engine/pilot-active-root.ts";
import {
  SupabaseServiceGateway,
  SupabaseServiceGatewayError,
  type GatewayHttpTransport,
} from "../src/runtime/supabase-service-gateway.ts";
import {
  PEDRO_V3_PILOT_AGENT_ID,
  PEDRO_V3_PILOT_TENANT_ID,
} from "../src/domain/pilot-scope.ts";

let ok = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`OK  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

async function expectError(name: string, fn: () => unknown | Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    check(name, false, "nao lancou");
  } catch (error) {
    check(name, error instanceof Error && error.message === code, error instanceof Error ? error.message : String(error));
  }
}

const SECRET = "bridge-secret-with-more-than-thirty-two-characters";
const BASE_PAYLOAD: PilotTurnPayload = {
  tenantId: PEDRO_V3_PILOT_TENANT_ID,
  agentId: PEDRO_V3_PILOT_AGENT_ID,
  conversationId: "conv:5512999999999",
  turnId: "turn:message-1",
  eventId: "event:message-1",
  workerId: "edge:worker-1",
  to: "5512999999999",
  messageText: "Boa noite, procuro um SUV ate 80 mil",
  receivedAt: "2026-06-28T12:00:00.000Z",
  leadId: null,
};

function committed(status: "committed" | "commit_failed" | "no_op" = "committed"): PilotActiveTurnResult {
  const engine = status === "commit_failed"
    ? {
        status: "commit_failed" as const,
        turnId: BASE_PAYLOAD.turnId,
        claimedEventIds: [BASE_PAYLOAD.eventId],
        reason: "decision mutations rejected: Bearer secret-token at https://example.test/path sk-testsecret",
      }
    : { status } as never;
  return {
    status,
    inserted: true,
    engine,
    outboxBeforeDispatch: [],
    outboxAfterDispatch: [],
    dispatched: status === "committed" ? 1 : 0,
  };
}

function duplicate(): PilotActiveTurnResult {
  return { status: "duplicate", inserted: false, turnId: BASE_PAYLOAD.turnId, dispatched: 0 };
}

class FakeRunner implements PilotTurnRunner {
  readonly calls: PilotTurnPayload[] = [];
  result: PilotActiveTurnResult = committed();
  error: Error | null = null;

  async run(payload: PilotTurnPayload): Promise<PilotActiveTurnResult> {
    this.calls.push(payload);
    if (this.error) throw this.error;
    return this.result;
  }
}

class FakeReceiptRunner implements PilotReceiptRunner {
  readonly calls: PilotReceiptPayload[] = [];
  result = { status: "applied" as const, effectId: "turn-1:message" };
  error: Error | null = null;

  async applyReceipt(payload: PilotReceiptPayload) {
    this.calls.push(payload);
    if (this.error) throw this.error;
    return this.result;
  }
}
function request(payload: Record<string, unknown> = BASE_PAYLOAD): {
  method: string;
  pathname: string;
  authorization: string;
  contentType: string;
  bodyText: string;
} {
  return {
    method: "POST",
    pathname: "/v1/pilot/turn",
    authorization: `Bearer ${SECRET}`,
    contentType: "application/json",
    bodyText: JSON.stringify(payload),
  };
}

function receiptRequest(payload: Record<string, unknown> = {
  tenantId: PEDRO_V3_PILOT_TENANT_ID,
  agentId: PEDRO_V3_PILOT_AGENT_ID,
  providerMessageId: "3EB0ABC123",
  status: "Delivered",
  occurredAt: "2026-06-28T12:00:05.000Z",
}) {
  return {
    method: "POST",
    pathname: "/v1/pilot/receipt",
    authorization: `Bearer ${SECRET}`,
    contentType: "application/json",
    bodyText: JSON.stringify(payload),
  };
}
function parsed(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

console.log("F2.6G pilot HTTP service:");

await expectError(
  "segredo curto falha fechado",
  () => new PilotHttpApp("short", new FakeRunner()),
  new PilotHttpConfigError("BRIDGE_SECRET_INVALID").message,
);

{
  const app = new PilotHttpApp(SECRET, new FakeRunner());
  const health = await app.handle({ method: "GET", pathname: "/health" });
  check("health nao exige segredo e nao executa turno", health.status === 200 && parsed(health.body).mode === "pilot");
}

{
  const runner = new FakeRunner();
  const app = new PilotHttpApp(SECRET, runner);
  const response = await app.handle({ ...request(), authorization: "Bearer wrong" });
  check("auth invalida bloqueia antes do runner", response.status === 401 && parsed(response.body).ingested === false && runner.calls.length === 0);
}

{
  const runner = new FakeRunner();
  const app = new PilotHttpApp(SECRET, runner);
  const response = await app.handle(request({ ...BASE_PAYLOAD, agentId: "agent-outro" }));
  check("escopo fora do piloto bloqueia antes do runner", response.status === 403 && parsed(response.body).ingested === false && runner.calls.length === 0);
}

{
  const runner = new FakeRunner();
  const app = new PilotHttpApp(SECRET, runner);
  const malformed = await app.handle({ ...request(), bodyText: "{" });
  const media = await app.handle({ ...request(), contentType: "text/plain" });
  const phone = await app.handle(request({ ...BASE_PAYLOAD, to: "123" }));
  check("payload, content-type e telefone invalidos falham pre-ingestao", [malformed, media, phone].every((item) => parsed(item.body).ingested === false) && runner.calls.length === 0);
}

{
  const runner = new FakeRunner();
  const app = new PilotHttpApp(SECRET, runner);
  const response = await app.handle(request());
  const body = parsed(response.body);
  check("turno committed confirma ingestao e um dispatch", response.status === 200 && body.ingested === true && body.dispatched === 1 && runner.calls.length === 1);
  check("payload normaliza receivedAt sem alterar identidade", runner.calls[0]?.receivedAt === BASE_PAYLOAD.receivedAt && runner.calls[0]?.eventId === BASE_PAYLOAD.eventId);
}

{
  const runner = new FakeRunner();
  runner.result = duplicate();
  const app = new PilotHttpApp(SECRET, runner);
  const response = await app.handle(request());
  check("duplicado e tratado como ja ingerido para impedir fallback v2", response.status === 200 && parsed(response.body).status === "duplicate" && parsed(response.body).ingested === true);
}

{
  const runner = new FakeRunner();
  runner.result = committed("commit_failed");
  const app = new PilotHttpApp(SECRET, runner);
  const response = await app.handle(request());
  const body = parsed(response.body);
  check("commit_failed expõe motivo sanitizado para diagnostico", response.status === 503 && body.ingested === true && body.reason === "decision mutations rejected: Bearer [redacted] at [url] [redacted]", response.body);
}

{
  const runner = new FakeRunner();
  runner.error = new PilotTurnRuntimeError("PILOT_BOOTSTRAP_FAILED", false);
  const app = new PilotHttpApp(SECRET, runner);
  const before = await app.handle(request());
  runner.error = new PilotTurnRuntimeError("PILOT_TURN_FAILED", true);
  const after = await app.handle(request());
  check("erro tipado preserva fronteira pre e pos ingestao", parsed(before.body).ingested === false && parsed(after.body).ingested === true);
}

{
  const runner = new FakeRunner();
  runner.error = new Error("secret internal detail");
  const app = new PilotHttpApp(SECRET, runner);
  const response = await app.handle(request());
  check("erro desconhecido e incerto e nao vaza detalhe", response.status === 500 && parsed(response.body).ingested === "unknown" && !response.body.includes("secret internal detail"));
}

{
  const app = new PilotHttpApp(SECRET, new FakeRunner());
  const response = await app.handle(receiptRequest());
  check("receipt sem runner falha fechado", response.status === 503 && parsed(response.body).error === "receipt_runner_unavailable");
}

{
  const receiptRunner = new FakeReceiptRunner();
  const app = new PilotHttpApp(SECRET, new FakeRunner(), receiptRunner);
  const invalidStatus = await app.handle(receiptRequest({
    tenantId: PEDRO_V3_PILOT_TENANT_ID,
    agentId: PEDRO_V3_PILOT_AGENT_ID,
    providerMessageId: "3EB0ABC123",
    status: "Sent",
    occurredAt: "2026-06-28T12:00:05.000Z",
  }));
  const crossTenant = await app.handle(receiptRequest({
    tenantId: "outro-tenant",
    agentId: PEDRO_V3_PILOT_AGENT_ID,
    providerMessageId: "3EB0ABC123",
    status: "Delivered",
    occurredAt: "2026-06-28T12:00:05.000Z",
  }));
  check("receipt aceita somente delivered/read", invalidStatus.status === 400 && receiptRunner.calls.length === 0);
  check("receipt cross-tenant falha antes do runner", crossTenant.status === 403 && receiptRunner.calls.length === 0);

  const delivered = await app.handle(receiptRequest());
  check("receipt delivered autenticado chama runner", delivered.status === 200 && parsed(delivered.body).status === "applied" && receiptRunner.calls.length === 1);
  check("receipt normaliza status e timestamp", receiptRunner.calls[0]?.status === "delivered" && receiptRunner.calls[0]?.occurredAt === "2026-06-28T12:00:05.000Z");

  receiptRunner.error = new Error("database secret detail");
  const failedReceipt = await app.handle(receiptRequest());
  check("erro de receipt e sanitizado", failedReceipt.status === 503 && !failedReceipt.body.includes("database secret detail"));
}
class StalledBodyTransport implements GatewayHttpTransport {
  async fetch(_url: string, _init: RequestInit): Promise<Response> {
    return new Response(new ReadableStream<Uint8Array>({ start() { /* never closes */ } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}

class StaticTransport implements GatewayHttpTransport {
  constructor(private readonly response: Response) {}
  async fetch(): Promise<Response> { return this.response; }
}

function gateway(transport: GatewayHttpTransport, timeoutMs = 100): SupabaseServiceGateway {
  return new SupabaseServiceGateway({
    url: "https://project.supabase.co",
    serviceRoleKey: "service-role-secret",
    allowedHosts: ["project.supabase.co"],
    timeoutMs,
    maxResponseBytes: 64,
  }, transport);
}

await expectError(
  "gateway cobre timeout do corpo completo",
  () => gateway(new StalledBodyTransport(), 10).selectMany("v3_inbox", { tenant_id: "tenant" }),
  new SupabaseServiceGatewayError("TIMEOUT").message,
);

await expectError(
  "gateway bloqueia RPC fora da allowlist",
  () => gateway(new StaticTransport(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))).rpc("drop_everything", {}),
  new SupabaseServiceGatewayError("OPERATION_NOT_ALLOWED").message,
);

await expectError(
  "gateway bloqueia resposta acima do limite",
  () => gateway(new StaticTransport(new Response(JSON.stringify({ value: "x".repeat(100) }), { status: 200, headers: { "content-type": "application/json" } }))).rpc("v3_ingest_inbox", {}),
  new SupabaseServiceGatewayError("RESPONSE_TOO_LARGE").message,
);

{
  const value = gateway(new StaticTransport(new Response("true", { status: 200, headers: { "content-type": "application/json" } })));
  check("gateway nao expoe service role na serializacao", !JSON.stringify(value).includes("service-role-secret"));
}

console.log(`\n=== PILOT HTTP: ${ok} OK | ${failed} FALHA ===`);
if (failed > 0) process.exit(1);
