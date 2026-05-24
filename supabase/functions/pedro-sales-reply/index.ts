import { authorizeToolRequest, corsHeaders, jsonResponse, parseJson } from "../_shared/pedro-v2/server.ts";
import { generatePedroSalesReply } from "../_shared/pedro-v2/replyGenerator.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await authorizeToolRequest(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const body = await parseJson(req);
  const reply = generatePedroSalesReply({
    memory: body.memory || body.current_memory || null,
    intent: body.intent || null,
    stock_result: body.stock_result || null,
    message: body.message || body.text || "",
  });

  return jsonResponse({
    ok: reply.ok,
    dry_run: true,
    reply,
  });
});
