import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * apollo-cron-runner
 *
 * Called by pg_cron every minute.
 * Finds users with is_enabled=true and next_run_at <= NOW(), then triggers apollo-agent for each.
 * Also triggers apollo-measure-outcomes daily at 06:00 UTC.
 */
// Le a claim "role" de um JWT (service_role quando vem do pg_cron). Best-effort.
function jwtRole(tok: string): string | null {
  try {
    const part = tok.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    return JSON.parse(json).role || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Security: only allow service-role calls (from pg_cron or internal).
  // Aceita tanto a env exata quanto qualquer JWT com role=service_role (o
  // pg_cron usa o secret do vault, que pode diferir da env em formato).
  const authHeader = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = authHeader.replace("Bearer ", "").trim();
  const isServiceRole = (serviceKey && authHeader.includes(serviceKey)) || jwtRole(token) === "service_role";

  if (!isServiceRole) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey
  );

  const now = new Date().toISOString();
  const functionsUrl = Deno.env.get("SUPABASE_URL")!.replace(".supabase.co", ".supabase.co/functions/v1");

  // ── Find users due for analysis ──
  const { data: dueUsers } = await admin
    .from("apollo_cron_config")
    .select("*, ad_accounts!inner(id, account_id, user_id)")
    .eq("is_enabled", true)
    .lte("next_run_at", now)
    .limit(20);

  const results: any[] = [];

  for (const config of (dueUsers || [])) {
    try {
      // Get a valid access token for this user's account
      const { data: account } = await admin
        .from("ad_accounts")
        .select("account_id, access_token_encrypted")
        .eq("user_id", config.user_id)
        .eq("platform", "meta")
        .eq("is_active", true)
        .single();

      if (!account?.access_token_encrypted) continue;

      // Create a service-role signed JWT for this call
      // We call apollo-agent with the service role but pass user_id in the body
      const response = await fetch(`${functionsUrl}/apollo-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "x-apollo-cron": "true",
          "x-user-id": config.user_id,
        },
        body: JSON.stringify({
          targetAccountId: account.account_id,
          auto_execute: config.auto_execute,
          datePreset: config.date_preset || "last_7d",
          _cron_user_id: config.user_id, // passed for service-role bypass
        }),
      });

      const data = await response.json().catch(() => ({}));

      // Update next_run_at
      const nextRun = computeNextRun(config.run_hour, config.run_minute, config.timezone);
      await admin.from("apollo_cron_config").update({
        last_run_at: now,
        next_run_at: nextRun,
        updated_at: now,
      }).eq("user_id", config.user_id);

      results.push({
        user_id: config.user_id,
        status: "ok",
        health_score: data.health_score,
        actions: data.actions?.length || 0,
      });
    } catch (err: any) {
      console.error("[apollo-cron-runner] user error:", config.user_id, err.message);
      results.push({ user_id: config.user_id, status: "error", error: err.message });
    }
  }

  // ── Daily outcome measurement (run at 06:xx UTC) ──
  const utcHour = new Date().getUTCHours();
  if (utcHour === 6) {
    fetch(`${functionsUrl}/apollo-measure-outcomes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  return new Response(JSON.stringify({
    ran_at: now,
    users_processed: results.length,
    results,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

function computeNextRun(hour: number, minute: number, timezone: string): string {
  // Simple: next occurrence of hour:minute in UTC (approximate)
  const now = new Date();
  const next = new Date();
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
