import {
  SupabaseServiceGateway,
  type GatewayHttpTransport,
} from "../src/runtime/supabase-service-gateway.ts";
import { DatabaseAutomationExecutionGate } from "../src/runtime/database-automation-execution-gate.ts";
import type { V3DatabaseGateway, DatabaseRow, DatabaseFilters } from "../src/domain/database-gateway.ts";
import type { JsonValue } from "../src/domain/types.ts";

let ok = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { ok += 1; console.log(`OK  ${name}`); }
  else { failed += 1; console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`); }
}

function captureTransport(cap: { url?: string }, body = "[]"): GatewayHttpTransport {
  return {
    async fetch(url: string): Promise<Response> {
      cap.url = url;
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

function gw(cap: { url?: string }, body = "[]"): SupabaseServiceGateway {
  return new SupabaseServiceGateway(
    { url: "https://proj.supabase.co", serviceRoleKey: "service-role-key", allowedHosts: ["proj.supabase.co"] },
    captureTransport(cap, body),
  );
}

async function main(): Promise<void> {
  // BUG F2.6N: event_id "uazapi:<hash>" (com ":") era DOUBLE-ENCODED no filtro PostgREST -> get() = null.
  const cap1: { url?: string } = {};
  await gw(cap1).selectOne("v3_inbox", {
    tenant_id: "11111111-1111-1111-1111-111111111111",
    event_id: "uazapi:abc123def",
  });
  check("event_id com ':' encoda UMA vez (uazapi%3A...)", !!cap1.url && cap1.url.includes("uazapi%3Aabc123def"), cap1.url);
  check("event_id NAO faz double-encoding (sem %253A)", !!cap1.url && !cap1.url.includes("%253A"), cap1.url);
  check("uuid do tenant intacto no filtro", !!cap1.url && cap1.url.includes("11111111-1111-1111-1111-111111111111"));

  // conversation_id "wa:<hash>" tambem tem ":".
  const cap2: { url?: string } = {};
  await gw(cap2).selectMany("v3_inbox", { conversation_id: "wa:8ed13714" }, { limit: 1 });
  check("conversation_id com ':' single-encoded", !!cap2.url && cap2.url.includes("wa%3A8ed13714") && !cap2.url.includes("wa%253A"), cap2.url);

  // valor simples (status) sem caractere especial segue intacto e decodificavel.
  const cap3: { url?: string } = {};
  await gw(cap3).selectMany("v3_inbox", { status: "pending" }, { limit: 1 });
  check("valor simples (pending) intacto", !!cap3.url && cap3.url.includes("status=eq.pending"), cap3.url);

  // F2.6O: HTTP_FAILURE inclui metodo + rota + status (diagnostico), sem query/segredo.
  const failGw = new SupabaseServiceGateway(
    { url: "https://proj.supabase.co", serviceRoleKey: "service-role-key", allowedHosts: ["proj.supabase.co"] },
    { async fetch(): Promise<Response> { return new Response("boom", { status: 400, headers: { "content-type": "application/json" } }); } },
  );
  let httpErr: unknown = null;
  try { await failGw.rpc("v3_commit_turn", { x: 1 }); } catch (e) { httpErr = e; }
  const msg = httpErr instanceof Error ? httpErr.message : String(httpErr);
  check("HTTP_FAILURE inclui status+rota+metodo", /HTTP_FAILURE/.test(msg) && /\b400\b/.test(msg) && /rpc\/v3_commit_turn/.test(msg) && /POST/.test(msg), msg);
  check("HTTP_FAILURE nao vaza service-role-key", !msg.includes("service-role-key"), msg);

  // F2.7.6: as RPCs novas do debounce DEVEM estar no allowlist do gateway. Regressao real:
  // eu esqueci de allowlistar -> toda ingestao virava OPERATION_NOT_ALLOWED -> bridge caia no v2.
  // R13-D/1 (audit Codex): a RPC de WM outcome DEVE estar no allowlist (senao a promocao accepted-safe vira
  // OPERATION_NOT_ALLOWED e a lembranca de foto nunca persiste). Este teste FALHA se a entrada for removida.
  for (const rpc of ["v3_upsert_conversation_routing", "v3_find_settled_conversations", "v3_commit_working_memory_outcome", "is_ai_automation_allowed_v2"]) {
    const cap: { url?: string } = {};
    await gw(cap).rpc(rpc, { p_tenant_id: "11111111-1111-1111-1111-111111111111" });
    check(`RPC '${rpc}' no allowlist (chega no transport, nao bloqueia)`, !!cap.url && cap.url.includes(`rpc/${rpc}`), cap.url);
  }
  // E o allowlist AINDA bloqueia RPC desconhecida (fail-closed).
  let blocked: unknown = null;
  try { await gw({}).rpc("v3_not_a_real_rpc", {}); } catch (e) { blocked = e; }
  check("allowlist bloqueia RPC desconhecida (OPERATION_NOT_ALLOWED)", blocked instanceof Error && /OPERATION_NOT_ALLOWED/.test(blocked.message), String(blocked));

  // A decisao de pausa usa tenant+agente+lead+acao do turno. Nao pode consultar apenas um flag local
  // nem perder o lead na passagem para o runtime.
  const rpcCalls: Array<{ name: string; args: DatabaseRow }> = [];
  const fakeDatabase: V3DatabaseGateway = {
    async rpc<T extends JsonValue>(name: string, args: DatabaseRow): Promise<T> {
      rpcCalls.push({ name, args });
      return { allowed: false, reason: "lead_paused" } as unknown as T;
    },
    async selectOne(_table: string, _filters: DatabaseFilters): Promise<DatabaseRow | null> { return null; },
    async selectMany(_table: string, _filters: DatabaseFilters): Promise<DatabaseRow[]> { return []; },
    async count(_table: string, _filters: DatabaseFilters): Promise<number> { return 0; },
  };
  const automationGate = new DatabaseAutomationExecutionGate(fakeDatabase);
  const pauseDecision = await automationGate.decide({
    ref: { tenantId: "tenant-1", agentId: "agent-1" },
    leadId: "lead-1",
    conversationId: "wa:conversation-1",
    actionKind: "effect_dispatch",
  });
  check("autoridade central preserva decisao de pausa", pauseDecision.allowed === false && pauseDecision.reason === "lead_paused", JSON.stringify(pauseDecision));
  check("autoridade central envia identidade e acao completas", rpcCalls.length === 1
    && rpcCalls[0]?.name === "is_ai_automation_allowed_v2"
    && rpcCalls[0]?.args.p_tenant === "tenant-1"
    && rpcCalls[0]?.args.p_agent_id === "agent-1"
    && rpcCalls[0]?.args.p_lead_id === "lead-1"
    && rpcCalls[0]?.args.p_v3_conversation_id === "wa:conversation-1"
    && rpcCalls[0]?.args.p_action_kind === "effect_dispatch"
    && rpcCalls[0]?.args.p_origin === "ai", JSON.stringify(rpcCalls));

  console.log(`=== GATEWAY FILTER: ${ok} OK | ${failed} FALHA ===`);
  if (failed > 0) process.exit(1);
}

void main();
