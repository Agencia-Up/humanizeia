import { authorizeToolRequest, createServiceClient, corsHeaders, isPedroV2MutationEnabled, jsonResponse, parseJson } from "../_shared/pedro-v2/server.ts";
import { confirmSellerAck } from "../_shared/pedro-v2/transferRouter.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await authorizeToolRequest(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const body = await parseJson(req);
  if (!body.user_id || !body.seller_phone) {
    return jsonResponse({ ok: false, error: "user_id_and_seller_phone_required" }, 400);
  }

  const commit = body.commit === true && isPedroV2MutationEnabled();
  const supabase = createServiceClient();
  const result = await confirmSellerAck(supabase, {
    user_id: body.user_id,
    agent_id: body.agent_id || null,
    seller_phone: body.seller_phone,
    commit,
  });

  return jsonResponse({ ok: true, commit, result });
});

