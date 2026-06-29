import {
  SupabaseServiceGateway,
  type GatewayHttpTransport,
} from "../src/runtime/supabase-service-gateway.ts";

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

  console.log(`=== GATEWAY FILTER: ${ok} OK | ${failed} FALHA ===`);
  if (failed > 0) process.exit(1);
}

void main();
