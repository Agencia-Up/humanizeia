import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * wa-capi-process-queue: Processes pending CAPI events in batches
 * 
 * Picks up meta_capi_events with status='pending', groups by pixel,
 * sends in batches of up to 1000 events per Meta API call,
 * and updates statuses accordingly.
 * 
 * Designed to be called via pg_cron every 5 minutes.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch pending events (limit 1000 per run)
    const { data: pendingEvents, error: fetchErr } = await admin
      .from("meta_capi_events")
      .select("id, user_id, pixel_id, event_name, event_time, action_source, user_data, custom_data, event_source_url")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1000);

    if (fetchErr) {
      console.error("[wa-capi-process-queue] Fetch error:", fetchErr);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: corsHeaders,
      });
    }

    if (!pendingEvents || pendingEvents.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "No pending events" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group events by pixel_id
    const groupedByPixel: Record<string, typeof pendingEvents> = {};
    for (const evt of pendingEvents) {
      const key = evt.pixel_id;
      if (!groupedByPixel[key]) groupedByPixel[key] = [];
      groupedByPixel[key].push(evt);
    }

    let totalSent = 0;
    let totalFailed = 0;

    for (const [pixelId, events] of Object.entries(groupedByPixel)) {
      // Get pixel config
      const { data: pixel } = await admin
        .from("meta_pixels")
        .select("id, pixel_id, access_token_encrypted, user_id, events_today, events_total")
        .eq("id", pixelId)
        .eq("is_active", true)
        .maybeSingle();

      if (!pixel) {
        // Mark events as failed - pixel not found
        const eventIds = events.map(e => e.id);
        await admin
          .from("meta_capi_events")
          .update({ status: "failed", error_message: "Pixel not found or inactive" })
          .in("id", eventIds);
        totalFailed += events.length;
        continue;
      }

      // Get access token
      const { data: adAccount } = await admin
        .from("ad_accounts")
        .select("access_token_encrypted")
        .eq("user_id", pixel.user_id)
        .eq("platform", "meta")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const accessToken = pixel.access_token_encrypted || adAccount?.access_token_encrypted;
      if (!accessToken) {
        console.log(`[wa-capi-process-queue] No token for pixel ${pixelId}, skipping ${events.length} events`);
        continue; // Leave as pending for next run
      }

      // Send in batches of 1000 (Meta API limit)
      const BATCH_SIZE = 1000;
      for (let i = 0; i < events.length; i += BATCH_SIZE) {
        const batch = events.slice(i, i + BATCH_SIZE);

        // Create batch record
        const { data: batchRecord } = await admin
          .from("meta_capi_batches")
          .insert({
            user_id: pixel.user_id,
            pixel_id: pixel.id,
            batch_size: batch.length,
            status: "sending",
          })
          .select("id")
          .single();

        // Mark events as part of this batch
        const batchEventIds = batch.map(e => e.id);
        if (batchRecord) {
          await admin
            .from("meta_capi_events")
            .update({ batch_id: batchRecord.id })
            .in("id", batchEventIds);
        }

        // Prepare Meta CAPI payload
        const capiData = await Promise.all(batch.map(async (evt) => {
          // Hash phone numbers in user_data if present
          const userData = { ...evt.user_data };
          if (userData.ph && Array.isArray(userData.ph)) {
            userData.ph = await Promise.all(
              userData.ph.map(async (p: string) => {
                if (p.length === 64) return p; // Already hashed
                const encoder = new TextEncoder();
                const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(p));
                return Array.from(new Uint8Array(hashBuffer))
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("");
              })
            );
          }

          return {
            event_name: evt.event_name,
            event_time: Math.floor(new Date(evt.event_time).getTime() / 1000),
            event_source_url: evt.event_source_url || undefined,
            action_source: evt.action_source || "system_generated",
            user_data: userData,
            custom_data: evt.custom_data || {},
          };
        }));

        try {
          const metaRes = await fetch(
            `https://graph.facebook.com/v21.0/${pixel.pixel_id}/events`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                data: capiData,
                access_token: accessToken,
              }),
            }
          );

          const metaData = await metaRes.json();
          const success = !metaData.error;

          // Update events status
          await admin
            .from("meta_capi_events")
            .update({
              status: success ? "sent" : "failed",
              response_code: metaRes.status,
              response_body: metaData,
              error_message: metaData.error?.message || null,
              sent_at: success ? new Date().toISOString() : null,
            })
            .in("id", batchEventIds);

          // Update batch record
          if (batchRecord) {
            await admin
              .from("meta_capi_batches")
              .update({
                status: success ? "sent" : "failed",
                events_sent: success ? batch.length : 0,
                events_failed: success ? 0 : batch.length,
                response_body: metaData,
                error_message: metaData.error?.message || null,
                sent_at: new Date().toISOString(),
              })
              .eq("id", batchRecord.id);
          }

          // Update pixel stats
          if (success) {
            await admin
              .from("meta_pixels")
              .update({
                last_event_at: new Date().toISOString(),
                events_today: (pixel.events_today || 0) + batch.length,
                events_total: (pixel.events_total || 0) + batch.length,
              })
              .eq("id", pixel.id);
            totalSent += batch.length;
          } else {
            totalFailed += batch.length;
            console.error(`[wa-capi-process-queue] Batch failed:`, metaData.error?.message);
          }
        } catch (sendErr) {
          console.error(`[wa-capi-process-queue] Send error:`, sendErr);
          await admin
            .from("meta_capi_events")
            .update({
              status: "failed",
              error_message: sendErr instanceof Error ? sendErr.message : "Send failed",
            })
            .in("id", batchEventIds);
          totalFailed += batch.length;
        }
      }
    }

    console.log(`[wa-capi-process-queue] Done: ${totalSent} sent, ${totalFailed} failed`);

    return new Response(
      JSON.stringify({ processed: pendingEvents.length, sent: totalSent, failed: totalFailed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[wa-capi-process-queue] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: corsHeaders,
    });
  }
});
