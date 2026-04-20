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

    // 1. Buscar dados da instância
    const { data: inst, error: fetchErr } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("id", instance_id)
      .single();

    if (fetchErr || !inst) throw new Error("Instância não encontrada");

    const baseUrl = inst.api_url.replace(/\/$/, "");
    const instanceToken = inst.api_key_encrypted;

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
    const webhookUrl = `${supabaseUrl}/functions/v1/uazapi-webhook`;

    console.log(`[sync-webhook V8.2] Instância: ${inst.instance_name} | Webhook: ${webhookUrl}`);

    let response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "token": instanceToken,
      },
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        events: ["messages", "connection"],
        excludeMessages: ["wasSentByApi"],
      }),
    });

    let resultText = await response.text();
    console.log(`[sync-webhook] POST /webhook (${response.status}): ${resultText.substring(0, 300)}`);

    if (!response.ok) {
      const nativePayload = {
        enabled: true,
        url: webhookUrl,
        local_map: false,
        STATUS_INSTANCE: true,
        QRCODE_UPDATED: true,
        MESSAGES_UPSERT: true,
        MESSAGES_SET: true,
        MESSAGES_UPDATE: true,
      };

      response = await fetch(`${baseUrl}/webhook/set/${inst.instance_name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "token": instanceToken,
          "apikey": instanceToken,
        },
        body: JSON.stringify(nativePayload),
      });

      resultText = await response.text();
      console.log(`[sync-webhook] POST /webhook/set/${inst.instance_name} (${response.status}): ${resultText.substring(0, 300)}`);
    }

    if (!response.ok) {
      throw new Error(`Erro ao configurar webhook: ${response.status} - ${resultText}`);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Webhook sincronizado com sucesso",
      webhookUrl 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[sync-webhook] Erro:", error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
