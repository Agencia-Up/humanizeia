import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: "campaign_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch campaign (RLS ensures ownership)
    const { data: campaign, error: campErr } = await supabase
      .from("wa_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .eq("user_id", userId)
      .single();

    if (campErr || !campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (campaign.status !== "draft" && campaign.status !== "paused") {
      return new Response(
        JSON.stringify({ error: "Campaign must be in draft or paused status to start" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const listIds: string[] = campaign.listas_alvo || campaign.list_ids || [];
    if (listIds.length === 0) {
      return new Response(JSON.stringify({ error: "No contact lists selected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use regras_delay if available, fallback to legacy columns
    const delayRules = campaign.regras_delay || {};
    const minDelay = delayRules.min || campaign.min_delay_seconds || 5;
    const maxDelay = delayRules.max || campaign.max_delay_seconds || 15;

    // Fetch all contacts from selected lists
    const { data: contacts, error: contactsErr } = await supabase
      .from("wa_contacts")
      .select("id, phone, name")
      .in("list_id", listIds)
      .eq("is_valid", true)
      .eq("user_id", userId);

    if (contactsErr) {
      return new Response(JSON.stringify({ error: "Failed to fetch contacts" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!contacts || contacts.length === 0) {
      return new Response(JSON.stringify({ error: "No valid contacts found in selected lists" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplicate by phone
    const uniqueContacts = new Map<string, { id: string; phone: string; name: string | null }>();
    for (const c of contacts) {
      const normalized = c.phone.replace(/\D/g, "");
      if (!uniqueContacts.has(normalized)) {
        uniqueContacts.set(normalized, { id: c.id, phone: normalized, name: c.name });
      }
    }

    const contactArr = Array.from(uniqueContacts.values());

    // Calculate staggered scheduled times based on delay settings
    const minDelay = campaign.min_delay_seconds || 5;
    const maxDelay = campaign.max_delay_seconds || 15;
    const now = Date.now();

    const queueRows = contactArr.map((c, i) => {
      const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
      const offset = i * randomDelay * 1000;
      return {
        user_id: userId,
        campaign_id: campaign_id,
        contact_id: c.id,
        phone: c.phone,
        message: campaign.message_template || "",
        media_url: campaign.media_url || null,
        media_type: campaign.media_type || null,
        status: "pending",
        scheduled_for: new Date(now + offset).toISOString(),
      };
    });

    // Insert in batches of 500
    const batchSize = 500;
    let insertedCount = 0;
    for (let i = 0; i < queueRows.length; i += batchSize) {
      const batch = queueRows.slice(i, i + batchSize);
      // Use service role for bulk insert to bypass per-row RLS overhead
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { error: insertErr } = await serviceClient.from("wa_queue").insert(batch);
      if (insertErr) {
        console.error("Queue insert error:", insertErr);
        return new Response(
          JSON.stringify({ error: `Failed to enqueue batch at offset ${i}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      insertedCount += batch.length;
    }

    // Update campaign status and total_contacts
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    await serviceClient
      .from("wa_campaigns")
      .update({
        status: "running",
        total_contacts: contactArr.length,
        started_at: new Date().toISOString(),
      })
      .eq("id", campaign_id);

    return new Response(
      JSON.stringify({
        success: true,
        enqueued: insertedCount,
        total_contacts: contactArr.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("enqueue-campaign error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
