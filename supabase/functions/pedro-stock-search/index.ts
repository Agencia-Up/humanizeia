import { authorizeToolRequest, corsHeaders, createServiceClient, jsonResponse, parseJson } from "../_shared/pedro-v2/server.ts";
import { routePedroIntent } from "../_shared/pedro-v2/intentRouter.ts";
import { searchPedroStock } from "../_shared/pedro-v2/stockSearch.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await authorizeToolRequest(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const body = await parseJson(req);
  const userId = auth.user_id || body.user_id;
  if (!userId) return jsonResponse({ ok: false, error: "user_id_required_for_internal_request" }, 400);

  const routed = routePedroIntent({
    message: body.query || body.message || body.text || "",
    current_memory: body.current_memory || null,
  });
  const filters = {
    ...body.filters,
    ...routed.extracted?.interesse,
    query: body.query || body.message || body.text || body.filters?.query || routed.extracted?.interesse?.modelo_desejado || "",
    ad_context: body.ad_context || body.filters?.ad_context || body.current_memory?.referencia?.texto_referencia || "",
  };

  const result = await searchPedroStock(createServiceClient(), {
    user_id: userId,
    query: filters.query,
    filters,
    limit: body.limit || body.limite || 8,
  });

  return jsonResponse({
    ok: result.success,
    dry_run: false,
    intent: routed,
    ...result,
  });
});
