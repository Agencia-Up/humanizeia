import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * wa-capi-track-lead: Full-funnel CAPI event sender for WhatsApp leads
 * 
 * Supports funnel stages:
 *   lead → qualified → checkout → purchase
 * 
 * Body params:
 *   - phone (required)
 *   - funnel_stage: "lead" | "qualified" | "checkout" | "purchase" | custom
 *   - value?: number (for checkout/purchase)
 *   - currency?: string (default BRL)
 *   - fbclid?: string
 *   - utm_source?: string
 *   - utm_campaign?: string
 *   - custom_data?: object
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders,
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

    const {
      phone,
      funnel_stage = "lead",
      value,
      currency = "BRL",
      fbclid,
      utm_source,
      utm_campaign,
      custom_data = {},
    } = await req.json();

    if (!phone) {
      return new Response(JSON.stringify({ error: "phone is required" }), {
        status: 400, headers: corsHeaders,
      });
    }

    // Map funnel stage to Meta event name
    const stageToEvent: Record<string, string> = {
      lead: "Lead",
      qualified: "CompleteRegistration",
      checkout: "InitiateCheckout",
      purchase: "Purchase",
    };
    const eventName = stageToEvent[funnel_stage] || funnel_stage;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get active pixel
    const { data: pixel } = await admin
      .from("meta_pixels")
      .select("id, pixel_id, access_token_encrypted, events_today, events_total")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!pixel) {
      return new Response(JSON.stringify({ error: "No active pixel found" }), {
        status: 404, headers: corsHeaders,
      });
    }

    // Get access token
    const { data: adAccount } = await admin
      .from("ad_accounts")
      .select("access_token_encrypted")
      .eq("user_id", userId)
      .eq("platform", "meta")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const accessToken = pixel.access_token_encrypted || adAccount?.access_token_encrypted;

    // Update contact funnel stage
    await admin
      .from("wa_contacts")
      .update({
        funnel_stage,
        funnel_updated_at: new Date().toISOString(),
        ...(fbclid && { fbclid }),
        ...(utm_source && { utm_source }),
        ...(utm_campaign && { utm_campaign }),
      })
      .eq("user_id", userId)
      .eq("phone", phone);

    // Hash phone
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(phone));
    const hashedPhone = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const eventPayload = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: "system_generated" as const,
      user_data: {
        ph: [hashedPhone],
        ...(fbclid && { fbc: `fb.1.${Date.now()}.${fbclid}` }),
      },
      custom_data: {
        source: "whatsapp",
        funnel_stage,
        ...(value !== undefined && { value, currency }),
        ...custom_data,
      },
    };

    let status = "pending";
    let responseBody: any = null;
    let responseCode: number | null = null;
    let errorMessage: string | null = null;

    if (accessToken) {
      const metaRes = await fetch(
        `https://graph.facebook.com/v21.0/${pixel.pixel_id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: [eventPayload],
            access_token: accessToken,
          }),
        }
      );

      responseBody = await metaRes.json();
      responseCode = metaRes.status;
      status = responseBody.error ? "failed" : "sent";
      errorMessage = responseBody.error?.message || null;

      // Update pixel stats
      if (!responseBody.error) {
        await admin
          .from("meta_pixels")
          .update({
            last_event_at: new Date().toISOString(),
            events_today: (pixel.events_today || 0) + 1,
            events_total: (pixel.events_total || 0) + 1,
          })
          .eq("id", pixel.id);
      }
    }

    // Log in meta_capi_events
    await admin.from("meta_capi_events").insert({
      user_id: userId,
      pixel_id: pixel.id,
      event_name: eventName,
      event_time: new Date().toISOString(),
      action_source: "system_generated",
      user_data: eventPayload.user_data,
      custom_data: eventPayload.custom_data,
      status,
      response_code: responseCode,
      response_body: responseBody,
      error_message: errorMessage,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    });

    // Log in wa_capi_funnel
    const { data: contact } = await admin
      .from("wa_contacts")
      .select("id")
      .eq("user_id", userId)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    await admin.from("wa_capi_funnel").insert({
      user_id: userId,
      contact_id: contact?.id || null,
      phone,
      pixel_id: pixel.id,
      funnel_stage,
      event_name: eventName,
      event_sent: status === "sent",
      meta_response: responseBody,
      custom_data: eventPayload.custom_data,
      value: value || null,
      currency,
      fbclid: fbclid || null,
      utm_source: utm_source || null,
      utm_campaign: utm_campaign || null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    });

    return new Response(
      JSON.stringify({
        success: status === "sent",
        status,
        event_name: eventName,
        funnel_stage,
        events_received: responseBody?.events_received,
        error: errorMessage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[wa-capi-track-lead] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
});
