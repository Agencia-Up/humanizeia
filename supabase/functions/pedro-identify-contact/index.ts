import { authorizeToolRequest, createServiceClient, corsHeaders, jsonResponse, parseJson } from "../_shared/pedro-v2/server.ts";
import { identifyPedroContact } from "../_shared/pedro-v2/contactIdentity.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await authorizeToolRequest(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const body = await parseJson(req);
  if (!body.user_id || !body.remote_jid) {
    return jsonResponse({ ok: false, error: "user_id_and_remote_jid_required" }, 400);
  }

  const supabase = createServiceClient();
  const identity = await identifyPedroContact(supabase, {
    user_id: body.user_id,
    agent_id: body.agent_id || null,
    remote_jid: body.remote_jid,
  });

  return jsonResponse({ ok: true, identity });
});

