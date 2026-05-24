import { authorizeToolRequest, createServiceClient, corsHeaders, jsonResponse, parseJson } from "../_shared/pedro-v2/server.ts";
import { chooseSellerForPedroTransfer } from "../_shared/pedro-v2/transferRouter.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await authorizeToolRequest(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const body = await parseJson(req);
  if (!body.user_id || !body.agent_id || !body.remote_jid) {
    return jsonResponse({ ok: false, error: "user_id_agent_id_remote_jid_required" }, 400);
  }

  const supabase = createServiceClient();
  const selection = await chooseSellerForPedroTransfer(supabase, {
    user_id: body.user_id,
    agent_id: body.agent_id,
    remote_jid: body.remote_jid,
    lead_id: body.lead_id || null,
  });

  return jsonResponse({
    ok: true,
    dry_run: true,
    selection,
    message: "Pedro v2 transfer router returns a seller plan only. Commit/send stays disabled until the full v2 rollout is approved.",
  });
});

