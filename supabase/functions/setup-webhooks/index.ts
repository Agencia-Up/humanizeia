import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPedroV2EnabledForUser } from "../_shared/pedro-v2/server.ts";

const UAZAPI_WEBHOOK_EVENTS = [
  "messages",
  "messages_update",
  "connection",
];

function buildWebhookPayload(webhookUrl: string, instanceName?: string) {
  return {
    enabled: true,
    url: webhookUrl,
    events: UAZAPI_WEBHOOK_EVENTS,
    excludeMessages: ["wasSentByApi"],
    addUrlEvents: false,
    addUrlTypesMessages: false,
    ...(instanceName ? { instanceName } : {}),
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function shouldRouteToPedroV2(supabase: any, inst: any): Promise<{ route: boolean; reason: string }> {
  if (!inst?.user_id || !inst?.id) return { route: false, reason: "missing_instance_context" };

  const gate = await isPedroV2EnabledForUser(supabase, inst.user_id);
  if (!gate.enabled) return { route: false, reason: gate.reason };

  const { data: agents, error } = await supabase
    .from("wa_ai_agents")
    .select("id, instance_id, instance_ids, agent_type, is_active")
    .eq("user_id", inst.user_id)
    .eq("is_active", true)
    .in("agent_type", ["sdr", "sdr_geral"]);

  if (error) return { route: false, reason: `agent_lookup_failed:${error.message}` };

  const linked = (agents || []).some((agent: any) => {
    const primary = String(agent?.instance_id || "") === String(inst.id);
    const multi = Array.isArray(agent?.instance_ids) && agent.instance_ids.map(String).includes(String(inst.id));
    return primary || multi;
  });

  return linked
    ? { route: true, reason: "active_sdr_agent_linked" }
    : { route: false, reason: "no_active_sdr_agent_linked" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const legacyUazapiToken = Deno.env.get("UAZAPI_API") || Deno.env.get("UAZAPI-API");
    const uazapiUrl = Deno.env.get("UAZAPI_URL") || Deno.env.get("EVOLUTION_API_URL") || (legacyUazapiToken ? "https://logosiabrasilcom.uazapi.com" : "");
    const uazapiAdminToken = Deno.env.get("UAZAPI_ADMIN_TOKEN") || legacyUazapiToken || Deno.env.get("EVOLUTION_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const defaultWebhookUrl = `${supabaseUrl}/functions/v1/wa-inbox-webhook`;
    const baseUrl = uazapiUrl.replace(/\/+$/, "");

    // Get all UazAPI instances
    const { data: instances } = await supabase
      .from("wa_instances")
      .select("id, instance_name, user_id")
      .in("provider", ["uazapi", "evolution"]);

    if (!instances || instances.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No instances found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const inst of instances) {
      try {
        const pedroRoute = await shouldRouteToPedroV2(supabase, inst);
        const webhookUrl = pedroRoute.route
          ? `${supabaseUrl}/functions/v1/pedro-webhook-v2`
          : defaultWebhookUrl;

        // Check current webhook
        const checkRes = await fetch(`${baseUrl}/webhook/find/${inst.instance_name}`, {
          method: "GET",
          headers: { "Content-Type": "application/json", apikey: uazapiAdminToken },
        });
        let currentWebhook = null;
        if (checkRes.ok) {
          currentWebhook = await checkRes.json();
        } else {
          await checkRes.text(); // consume body
        }

        // Try setting webhook - try v2 format first, then v1
        const webhookPayload = {
          webhook: buildWebhookPayload(webhookUrl, inst.instance_name),
        };

        let setRes = await fetch(`${baseUrl}/webhook/set/${inst.instance_name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: uazapiAdminToken },
          body: JSON.stringify(webhookPayload),
        });

        // If v2 format fails, try v1 flat format
        if (!setRes.ok) {
          await setRes.text(); // consume body
          setRes = await fetch(`${baseUrl}/webhook/set/${inst.instance_name}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: uazapiAdminToken },
            body: JSON.stringify(buildWebhookPayload(webhookUrl, inst.instance_name)),
          });
        }

        if (setRes.status === 405) {
          await setRes.text().catch(() => "");
          setRes = await fetch(`${baseUrl}/webhook/instance`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: uazapiAdminToken },
            body: JSON.stringify(buildWebhookPayload(webhookUrl, inst.instance_name)),
          });
        }

        const setResText = await setRes.text();
        let setData = null;
        try { setData = JSON.parse(setResText); } catch {}

        results.push({
          instance: inst.instance_name,
          status: setRes.ok ? "configured" : "error",
          http_status: setRes.status,
          webhook_url: webhookUrl,
          route_reason: pedroRoute.reason,
          previous_webhook: currentWebhook,
          set_result: setData,
        });
      } catch (err: any) {
        results.push({
          instance: inst.instance_name,
          status: "error",
          error: err.message,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, default_webhook_url: defaultWebhookUrl, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("setup-webhooks error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
