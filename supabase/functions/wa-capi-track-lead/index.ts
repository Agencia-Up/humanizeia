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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const {
      user_id,
      contact_id,
      phone,
      event_name = "Lead",
      funnel_stage = "lead",
      value,
      currency = "BRL",
      custom_data,
      pixel_id: requestedPixelId,
    } = body;

    if (!user_id || !phone) {
      return new Response(
        JSON.stringify({ error: "user_id and phone are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get contact data for fbclid/utm
    let contactData: any = null;
    let resolvedContactId = contact_id;

    if (contact_id) {
      const { data } = await supabase
        .from("wa_contacts")
        .select("id, fbclid, utm_source, utm_campaign, utm_medium, capi_events_sent, funnel_stage")
        .eq("id", contact_id)
        .single();
      contactData = data;
    } else {
      // Find contact by phone
      const { data } = await supabase
        .from("wa_contacts")
        .select("id, fbclid, utm_source, utm_campaign, utm_medium, capi_events_sent, funnel_stage")
        .eq("user_id", user_id)
        .eq("phone", phone)
        .limit(1)
        .maybeSingle();
      contactData = data;
      resolvedContactId = data?.id;
    }

    // Check if event already sent for this contact
    const existingEvents = (contactData?.capi_events_sent as any) || {};
    if (existingEvents[event_name]) {
      return new Response(
        JSON.stringify({ success: true, already_sent: true, event_name }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get pixel
    let pixelQuery = supabase
      .from("meta_pixels")
      .select("id, pixel_id, access_token_encrypted")
      .eq("user_id", user_id)
      .eq("is_active", true);

    if (requestedPixelId) {
      pixelQuery = pixelQuery.eq("id", requestedPixelId);
    }

    const { data: pixel } = await pixelQuery.limit(1).maybeSingle();

    // Record funnel event
    await supabase.from("wa_capi_funnel").insert({
      user_id,
      phone,
      contact_id: resolvedContactId || null,
      event_name,
      funnel_stage,
      fbclid: contactData?.fbclid || null,
      utm_source: contactData?.utm_source || null,
      utm_campaign: contactData?.utm_campaign || null,
      pixel_id: pixel?.id || null,
      value: value || null,
      currency,
      custom_data: custom_data || null,
      event_sent: false,
    });

    // Update contact funnel stage
    if (resolvedContactId) {
      const capiEventRecord = { [event_name]: new Date().toISOString() };
      await supabase
        .from("wa_contacts")
        .update({
          funnel_stage,
          funnel_updated_at: new Date().toISOString(),
          capi_events_sent: { ...existingEvents, ...capiEventRecord },
        })
        .eq("id", resolvedContactId);
    }

    let metaResponse: any = null;

    // Fire to Meta if pixel configured
    if (pixel?.access_token_encrypted && pixel?.pixel_id) {
      const phoneHash = await hashData(phone);
      const eventData: any = {
        event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: crypto.randomUUID(),
        action_source: "website",
        user_data: {
          ph: [phoneHash],
          ...(contactData?.fbclid && { fbc: contactData.fbclid }),
        },
      };

      if (value || custom_data) {
        eventData.custom_data = {
          ...(value && { value }),
          currency,
          ...custom_data,
        };
      }

      const metaRes = await fetch(`${META_GRAPH_URL}/${pixel.pixel_id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [eventData],
          access_token: pixel.access_token_encrypted,
        }),
      });

      metaResponse = await metaRes.json();

      // Mark as sent
      await supabase
        .from("wa_capi_funnel")
        .update({
          event_sent: true,
          sent_at: new Date().toISOString(),
          meta_response: metaResponse,
        })
        .eq("contact_id", resolvedContactId)
        .eq("event_name", event_name)
        .eq("event_sent", false)
        .order("created_at", { ascending: false })
        .limit(1);

      console.log(`[wa-capi-track-lead] ${event_name} fired for ${phone}: ${metaResponse.events_received || 0} received`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        event_name,
        funnel_stage,
        pixel_configured: !!pixel?.access_token_encrypted,
        meta_response: metaResponse,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[wa-capi-track-lead] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function hashData(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
