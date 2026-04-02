import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { instance_id, user_id } = await req.json();
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get Instance Data
    const { data: inst, error: fetchErr } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("id", instance_id)
      .single();

    if (fetchErr || !inst) throw new Error("Instância não encontrada");

    const baseUrl = inst.api_url.replace(/\/$/, "");
    const instanceName = inst.instance_name;
    const instanceToken = inst.api_key_encrypted;
    const globalKey = Deno.env.get("EVOLUTION_API_KEY") || "";
    
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/uazapi-webhook`;

    console.log(`[sync-webhook] Syncing ${instanceName} to ${webhookUrl}`);

    const results = [];

    // Attempt 1: Evolution v1
    try {
        const r1 = await fetch(`${baseUrl}/webhook/set/${instanceName}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "apikey": globalKey, "token": instanceToken, "admintoken": globalKey },
            body: JSON.stringify({
                webhook: { url: webhookUrl, enabled: true, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "SEND_MESSAGE"] }
            })
        });
        const t1 = await r1.text();
        results.push(`V1 (${r1.status}): ${t1.substring(0, 100)}`);
    } catch(e) { results.push(`V1 Error: ${e.message}`); }

    // Attempt 2: Evolution v2 / Uazapi
    try {
        const r2 = await fetch(`${baseUrl}/webhook/set`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "apikey": globalKey, "token": instanceToken, "admintoken": globalKey },
            body: JSON.stringify({ instance: instanceName, url: webhookUrl, enabled: true, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"] })
        });
        const t2 = await r2.text();
        results.push(`V2 (${r2.status}): ${t2.substring(0, 100)}`);
    } catch(e) { results.push(`V2 Error: ${e.message}`); }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
