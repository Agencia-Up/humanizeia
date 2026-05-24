import { authorizeToolRequest, corsHeaders, createServiceClient, isPedroV2SendingEnabled, jsonResponse, parseJson } from "../_shared/pedro-v2/server.ts";
import { resolvePedroInstance, sendPedroMedia, sendPedroText } from "../_shared/pedro-v2/uazapiSender_20260524.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await authorizeToolRequest(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const body = await parseJson(req);
  const userId = auth.user_id || body.user_id;
  if (!userId) return jsonResponse({ ok: false, error: "user_id_required_for_internal_request" }, 400);

  if (!isPedroV2SendingEnabled()) {
    return jsonResponse({
      ok: true,
      dry_run: true,
      planned_send: {
        to: body.to || body.number || null,
        text: body.text || null,
        media: body.media || null,
      },
      message: "Pedro v2 sending is disabled. Set PEDRO_V2_SEND_ENABLED=true only during controlled tests.",
    });
  }

  const supabase = createServiceClient();
  const instance = body.instance || await resolvePedroInstance(supabase, {
    user_id: userId,
    agent_id: body.agent_id || null,
    instance_id: body.instance_id || null,
  });

  if (!instance) return jsonResponse({ ok: false, error: "wa_instance_not_found" }, 404);

  const to = body.to || body.number || body.remote_jid;
  const media = body.media || body.file || null;
  const text = String(body.text || body.caption || "").trim();
  const result = media
    ? await sendPedroMedia(instance, {
        to,
        file: typeof media === "string" ? media : media.file || media.url,
        type: body.media_type || media.type || "image",
        caption: text,
      })
    : await sendPedroText(instance, { to, text });

  return jsonResponse({ ok: result.ok, dry_run: false, result }, result.ok ? 200 : 502);
});
