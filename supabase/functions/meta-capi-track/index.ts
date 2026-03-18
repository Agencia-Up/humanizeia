import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Lightweight server-side tracking endpoint (no auth required for pixel tracking)
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pixel_id, event_name, event_source_url, user_data, custom_data, action_source } =
      await req.json();

    if (!pixel_id || !event_name) {
      return new Response(
        JSON.stringify({ error: "pixel_id and event_name are required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find the pixel by pixel_id (Meta's pixel ID string)
    const { data: pixel, error: pixelError } = await adminClient
      .from("meta_pixels")
      .select("*")
      .eq("pixel_id", pixel_id)
      .eq("is_active", true)
      .single();

    if (pixelError || !pixel) {
      return new Response(
        JSON.stringify({ error: "Pixel not found or inactive" }),
        { status: 404, headers: corsHeaders }
      );
    }

    // Get access token
    const { data: adAccount } = await adminClient
      .from("ad_accounts")
      .select("access_token_encrypted")
      .eq("user_id", pixel.user_id)
      .eq("platform", "meta")
      .eq("is_active", true)
      .limit(1)
      .single();

    const accessToken = pixel.access_token_encrypted || adAccount?.access_token_encrypted;
    if (!accessToken) {
      // Store event as pending for later retry
      await adminClient.from("meta_capi_events").insert({
        user_id: pixel.user_id,
        pixel_id: pixel.id,
        event_name,
        event_source_url,
        action_source: action_source || "website",
        user_data: user_data || {},
        custom_data: custom_data || {},
        status: "pending",
      });

      return new Response(
        JSON.stringify({ queued: true, message: "Event queued - no access token available" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send to Meta CAPI
    const META_GRAPH_URL = "https://graph.facebook.com/v21.0";
    const eventTime = Math.floor(Date.now() / 1000);

    const metaRes = await fetch(`${META_GRAPH_URL}/${pixel.pixel_id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            event_name,
            event_time: eventTime,
            event_source_url,
            action_source: action_source || "website",
            user_data: user_data || {},
            custom_data: custom_data || {},
          },
        ],
        access_token: accessToken,
      }),
    });

    const metaData = await metaRes.json();

    // Log event
    await adminClient.from("meta_capi_events").insert({
      user_id: pixel.user_id,
      pixel_id: pixel.id,
      event_name,
      event_time: new Date().toISOString(),
      event_source_url,
      action_source: action_source || "website",
      user_data: user_data || {},
      custom_data: custom_data || {},
      status: metaData.error ? "failed" : "sent",
      response_code: metaRes.status,
      response_body: metaData,
      error_message: metaData.error?.message || null,
      sent_at: new Date().toISOString(),
    });

    // Update pixel stats
    await adminClient
      .from("meta_pixels")
      .update({
        last_event_at: new Date().toISOString(),
        events_today: (pixel.events_today || 0) + 1,
        events_total: (pixel.events_total || 0) + 1,
      })
      .eq("id", pixel.id);

    return new Response(
      JSON.stringify({ success: !metaData.error, events_received: metaData.events_received }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
