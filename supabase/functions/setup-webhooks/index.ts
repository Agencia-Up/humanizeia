import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EVOLUTION_WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_SET",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
];

function buildWebhookPayload(webhookUrl: string, instanceName?: string) {
  return {
    enabled: true,
    url: webhookUrl,
    webhook_by_events: false,
    webhook_base64: false,
    events: EVOLUTION_WEBHOOK_EVENTS,
    ...(instanceName ? { instanceName } : {}),
  };
}

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL")!;
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const webhookUrl = `${supabaseUrl}/functions/v1/wa-inbox-webhook`;
    const baseUrl = evolutionApiUrl.replace(/\/+$/, "");

    // Get all evolution instances
    const { data: instances } = await supabase
      .from("wa_instances")
      .select("id, instance_name, user_id")
      .eq("provider", "evolution");

    if (!instances || instances.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No instances found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const inst of instances) {
      try {
        // Check current webhook
        const checkRes = await fetch(`${baseUrl}/webhook/find/${inst.instance_name}`, {
          method: "GET",
          headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
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
          headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
          body: JSON.stringify(webhookPayload),
        });

        // If v2 format fails, try v1 flat format
        if (!setRes.ok) {
          await setRes.text(); // consume body
          setRes = await fetch(`${baseUrl}/webhook/set/${inst.instance_name}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
            body: JSON.stringify(buildWebhookPayload(webhookUrl, inst.instance_name)),
          });
        }

        if (setRes.status === 405) {
          await setRes.text().catch(() => "");
          setRes = await fetch(`${baseUrl}/webhook/instance`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
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

    return new Response(JSON.stringify({ success: true, webhook_url: webhookUrl, results }), {
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
