import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const body = await req.json();
    const {
      pixel_id,
      event_name,
      event_source_url,
      action_source = "website",
      user_email_hash,
      user_phone_hash,
      user_external_id,
      user_fbc,
      user_fbp,
      user_ip,
      user_user_agent,
      user_city,
      user_country,
      value,
      currency,
      content_name,
      content_category,
      content_ids,
      content_type,
      num_items,
      order_id,
      predicted_ltv,
      custom_data,
    } = body;

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

    // Verify pixel exists and belongs to user
    const { data: pixel, error: pixelError } = await adminClient
      .from("meta_pixels")
      .select("id")
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

    const eventId = crypto.randomUUID();

    const { data: event, error: insertError } = await adminClient
      .from("meta_capi_events")
      .insert({
        pixel_id,
        user_id: userId,
        event_name,
        event_id: eventId,
        event_time: new Date().toISOString(),
        event_source_url,
        action_source,
        status: "pending",
        user_email_hash,
        user_phone_hash,
        user_external_id,
        user_fbc,
        user_fbp,
        user_ip,
        user_user_agent,
        user_city,
        user_country,
        value,
        currency,
        content_name,
        content_category,
        content_ids,
        content_type,
        num_items,
        order_id,
        predicted_ltv,
        custom_data,
      })
      .select()
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: "Failed to track event", details: insertError.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        event_id: eventId,
        id: event.id,
        status: "pending",
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
