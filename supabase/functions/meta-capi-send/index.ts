import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }
    const userId = claimsData.claims.sub as string;

    const { pixel_id, events } = await req.json();

    if (!pixel_id || !events || !Array.isArray(events) || events.length === 0) {
      return new Response(
        JSON.stringify({ error: "pixel_id and events array are required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get pixel with access token
    const { data: pixel, error: pixelError } = await adminClient
      .from("meta_pixels")
      .select("*")
      .eq("id", pixel_id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (pixelError || !pixel) {
      return new Response(
        JSON.stringify({ error: "Pixel not found or inactive" }),
        { status: 404, headers: corsHeaders }
      );
    }

    const accessToken = pixel.access_token_encrypted;
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "Pixel access token not configured" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Create batch record
    const { data: batch, error: batchError } = await adminClient
      .from("meta_capi_batches")
      .insert({
        pixel_id: pixel.id,
        user_id: userId,
        batch_size: events.length,
        events_count: events.length,
        status: "processing",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (batchError) {
      return new Response(
        JSON.stringify({ error: "Failed to create batch" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Format events for Meta CAPI
    const formattedEvents = events.map((evt: any) => ({
      event_name: evt.event_name,
      event_time: Math.floor(new Date(evt.event_time || new Date()).getTime() / 1000),
      event_id: evt.event_id || crypto.randomUUID(),
      event_source_url: evt.event_source_url || undefined,
      action_source: evt.action_source || "website",
      user_data: {
        ...(evt.user_email_hash && { em: [evt.user_email_hash] }),
        ...(evt.user_phone_hash && { ph: [evt.user_phone_hash] }),
        ...(evt.user_external_id && { external_id: [evt.user_external_id] }),
        ...(evt.user_fbc && { fbc: evt.user_fbc }),
        ...(evt.user_fbp && { fbp: evt.user_fbp }),
        ...(evt.user_ip && { client_ip_address: evt.user_ip }),
        ...(evt.user_user_agent && { client_user_agent: evt.user_user_agent }),
        ...(evt.user_city && { ct: [evt.user_city] }),
        ...(evt.user_country && { country: [evt.user_country] }),
      },
      custom_data: {
        ...(evt.value && { value: evt.value }),
        ...(evt.currency && { currency: evt.currency }),
        ...(evt.content_name && { content_name: evt.content_name }),
        ...(evt.content_category && { content_category: evt.content_category }),
        ...(evt.content_ids && { content_ids: evt.content_ids }),
        ...(evt.content_type && { content_type: evt.content_type }),
        ...(evt.num_items && { num_items: evt.num_items }),
        ...(evt.order_id && { order_id: evt.order_id }),
        ...(evt.predicted_ltv && { predicted_ltv: evt.predicted_ltv }),
        ...evt.custom_data,
      },
    }));

    // Send to Meta CAPI
    const url = `${META_GRAPH_URL}/${pixel.pixel_id}/events`;
    const metaRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: formattedEvents,
        access_token: accessToken,
      }),
    });

    const metaData = await metaRes.json();

    let eventsSent = 0;
    let eventsFailed = 0;
    let status = "completed";

    if (metaData.error) {
      eventsFailed = events.length;
      status = "failed";
    } else {
      eventsSent = metaData.events_received || events.length;
      eventsFailed = events.length - eventsSent;
    }

    // Update batch
    await adminClient
      .from("meta_capi_batches")
      .update({
        status,
        events_sent: eventsSent,
        events_failed: eventsFailed,
        sent_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        meta_response: metaData,
        response_body: metaData,
        error_message: metaData.error?.message || null,
      })
      .eq("id", batch.id);

    // Update events status
    const eventIds = events.map((e: any) => e.id).filter(Boolean);
    if (eventIds.length > 0) {
      await adminClient
        .from("meta_capi_events")
        .update({
          status: status === "completed" ? "sent" : "failed",
          sent_at: new Date().toISOString(),
          batch_id: batch.id,
          response_code: metaRes.status,
          response_body: metaData,
          error_message: metaData.error?.message || null,
        })
        .in("id", eventIds);
    }

    // Update pixel stats
    await adminClient
      .from("meta_pixels")
      .update({
        last_event_at: new Date().toISOString(),
        events_total: (pixel.events_total || 0) + eventsSent,
      })
      .eq("id", pixel.id);

    return new Response(
      JSON.stringify({
        success: status === "completed",
        batch_id: batch.id,
        events_sent: eventsSent,
        events_failed: eventsFailed,
        meta_response: metaData,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
