import { authorizeToolRequest, corsHeaders, jsonResponse, parseJson } from "../_shared/pedro-v2/server.ts";
import { routePedroIntent } from "../_shared/pedro-v2/intentRouter.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await authorizeToolRequest(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const body = await parseJson(req);
  const result = routePedroIntent({
    message: body.message || body.text || "",
    current_memory: body.current_memory || null,
  });

  return jsonResponse({ ok: true, result });
});

