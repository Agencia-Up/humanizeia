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
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders,
      });
    }
    const userId = userData.user.id;

    const { pixel_id, events } = await req.json();

    if (!pixel_id || !events?.length) {
      return new Response(
        JSON.stringify({ error: "pixel_id and events[] are required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Get pixel config
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    // Get access token from ad_accounts
    const { data: adAccount } = await adminClient
      .from("ad_accounts")
      .select("access_token_encrypted")
      .eq("user_id", userId)
      .eq("platform", "meta")
      .eq("is_active", true)
      .limit(1)
      .single();

    const accessToken = pixel.access_token_encrypted || adAccount?.access_token_encrypted;
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "No access token found. Connect Meta account first." }),
        { status: 401, headers: corsHeaders }
      );
    }

    // Send events to Meta Conversions API
    const capiPayload = {
      data: events.map((evt: any) => ({
        event_name: evt.event_name,
        event_time: Math.floor(new Date(evt.event_time || Date.now()).getTime() / 1000),
        event_source_url: evt.event_source_url,
        action_source: evt.action_source || "website",
        user_data: evt.user_data || {},
        custom_data: evt.custom_data || {},
      })),
      access_token: accessToken,
    };

    const metaRes = await fetch(
      `${META_GRAPH_URL}/${pixel.pixel_id}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(capiPayload),
      }
    );

    const metaData = await metaRes.json();

    // Log each event in database
    const eventRecords = events.map((evt: any) => ({
      user_id: userId,
      pixel_id: pixel.id,
      event_name: evt.event_name,
      event_time: evt.event_time || new Date().toISOString(),
      event_source_url: evt.event_source_url,
      action_source: evt.action_source || "website",
      user_data: evt.user_data || {},
      custom_data: evt.custom_data || {},
      status: metaData.error ? "failed" : "sent",
      response_code: metaRes.status,
      response_body: metaData,
      error_message: metaData.error?.message || null,
      sent_at: new Date().toISOString(),
    }));

    await adminClient.from("meta_capi_events").insert(eventRecords);

    // Update pixel stats
    await adminClient
      .from("meta_pixels")
      .update({
        last_event_at: new Date().toISOString(),
        events_today: (pixel.events_today || 0) + events.length,
        events_total: (pixel.events_total || 0) + events.length,
      })
      .eq("id", pixel.id);

    if (metaData.error) {
      return new Response(
        JSON.stringify({ error: metaData.error.message, details: metaData }),
        { status: 400, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        events_received: metaData.events_received,
        messages: metaData.messages,
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
