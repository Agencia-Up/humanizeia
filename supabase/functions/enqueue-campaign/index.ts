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

    // Fix: use getUser instead of getClaims (which doesn't exist in SDK)
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

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

    // Fetch all contacts from selected lists WITH metadata for AI personalization
    const { data: contacts, error: contactsErr } = await supabase
      .from("wa_contacts")
      .select("id, phone, name, metadata")
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
    const uniqueContacts = new Map<string, { id: string; phone: string; name: string | null; metadata: any }>();
    for (const c of contacts) {
      const normalized = c.phone.replace(/\D/g, "");
      if (!uniqueContacts.has(normalized)) {
        uniqueContacts.set(normalized, { id: c.id, phone: normalized, name: c.name, metadata: c.metadata });
      }
    }

    const contactArr = Array.from(uniqueContacts.values());

    // Use scheduled_at from campaign as base time, fallback to now
    const baseTime = campaign.scheduled_at
      ? new Date(campaign.scheduled_at).getTime()
      : Date.now();

    // Ensure base time is in the future
    const now = Date.now();
    const effectiveBaseTime = Math.max(baseTime, now);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Read current queue rows so resume/edit works from where it stopped
    const { data: existingQueue, error: existingQueueErr } = await serviceClient
      .from("wa_queue")
      .select("id, contact_id, phone, status")
      .eq("campaign_id", campaign_id);

    if (existingQueueErr) {
      console.error("Queue read error:", existingQueueErr);
      return new Response(JSON.stringify({ error: "Failed to read existing queue" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingByContactId = new Map<string, { id: string; status: string }>();
    const existingByPhone = new Map<string, { id: string; status: string }>();

    for (const row of existingQueue || []) {
      if (row.contact_id) existingByContactId.set(row.contact_id, { id: row.id, status: row.status });
      if (row.phone) existingByPhone.set(String(row.phone).replace(/\D/g, ""), { id: row.id, status: row.status });
    }

    const terminalStatuses = new Set(["sent", "delivered", "read"]);

    const rowsToReactivate: Array<Record<string, unknown>> = [];
    const rowsToInsert: Array<Record<string, unknown>> = [];

    let scheduleCursor = effectiveBaseTime;
    const nextSchedule = () => {
      const scheduledFor = new Date(scheduleCursor).toISOString();
      const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
      scheduleCursor += randomDelay * 1000;
      return scheduledFor;
    };

    for (const c of contactArr) {
      const existing = existingByContactId.get(c.id) || existingByPhone.get(c.phone);

      // Keep already sent/delivered/read contacts untouched when resuming
      if (existing && terminalStatuses.has(existing.status)) {
        continue;
      }

      const scheduledFor = nextSchedule();

      if (existing) {
        // Resume paused/cancelled/processing from where campaign stopped
        rowsToReactivate.push({
          id: existing.id,
          user_id: userId,
          campaign_id,
          contact_id: c.id,
          phone: c.phone,
          status: "pending",
          scheduled_for: scheduledFor,
          retry_count: 0,
          error_message: null,
          message: campaign.message_template || "",
          media_url: campaign.media_url || null,
          media_type: campaign.media_type || null,
          contact_metadata: c.metadata || null,
          contact_name: c.name || null,
        });
      } else {
        rowsToInsert.push({
          user_id: userId,
          campaign_id,
          contact_id: c.id,
          phone: c.phone,
          message: campaign.message_template || "",
          media_url: campaign.media_url || null,
          media_type: campaign.media_type || null,
          status: "pending",
          scheduled_for: scheduledFor,
          contact_metadata: c.metadata || null,
          contact_name: c.name || null,
          retry_count: 0,
        });
      }
    }

    const batchSize = 500;

    for (let i = 0; i < rowsToReactivate.length; i += batchSize) {
      const batch = rowsToReactivate.slice(i, i + batchSize);
      const { error: reactivateErr } = await serviceClient
        .from("wa_queue")
        .upsert(batch, { onConflict: "id" });

      if (reactivateErr) {
        console.error("Queue reactivate error:", reactivateErr);
        return new Response(
          JSON.stringify({ error: `Failed to reactivate queue batch at offset ${i}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    for (let i = 0; i < rowsToInsert.length; i += batchSize) {
      const batch = rowsToInsert.slice(i, i + batchSize);
      const { error: insertErr } = await serviceClient
        .from("wa_queue")
        .insert(batch);

      if (insertErr) {
        console.error("Queue insert error:", insertErr);
        return new Response(
          JSON.stringify({ error: `Failed to enqueue batch at offset ${i}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const enqueuedCount = rowsToReactivate.length + rowsToInsert.length;

    // Update campaign status and total_contacts
    await serviceClient
      .from("wa_campaigns")
      .update({
        status: "running",
        total_contacts: contactArr.length,
        started_at: campaign.started_at || new Date().toISOString(),
      })
      .eq("id", campaign_id);

    return new Response(
      JSON.stringify({
        success: true,
        enqueued: enqueuedCount,
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
