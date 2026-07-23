import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPedroV2EnabledForUser } from "../_shared/pedro-v2/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function listEnv(name: string): string[] {
  return String(Deno.env.get(name) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function includesNormalized(value: string | null | undefined, allowed: string[]): boolean {
  if (!value) return false;
  const normalizedValue = value.toLowerCase().trim();
  return allowed.some((item) => item.toLowerCase().trim() === normalizedValue);
}

async function resolveWebhookFunction(supabase: any, userId: string | null | undefined) {
  if (!userId) return { functionName: "uazapi-webhook", reason: "missing_user_id" };

  if (includesNormalized(userId, listEnv("PEDRO_V2_ALLOWED_USER_IDS"))) {
    return { functionName: "pedro-webhook-v2", reason: "user_id_allowlist_local" };
  }

  const gate = await isPedroV2EnabledForUser(supabase, userId);
  if (gate.enabled) return { functionName: "pedro-webhook-v2", reason: gate.reason, email: gate.email || null };

  return { functionName: "uazapi-webhook", reason: gate.reason, email: gate.email || null };
}

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
    const webhookDecision = await resolveWebhookFunction(supabase, inst.user_id);
    const webhookFunction = webhookDecision.functionName;
    const webhookUrl = `${supabaseUrl}/functions/v1/${webhookFunction}`;

    console.log(`[sync-webhook V8.3] Instância: ${inst.instance_name} | Webhook: ${webhookUrl} | Reason: ${webhookDecision.reason}`);

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
        // Uazapi's public webhook contract uses these lowercase event names.
        // Uppercase Evolution-style names are accepted by some versions but
        // do not deliver messages on the Uazapi runtime.
        events: ["messages", "messages_update", "connection", "qrcode"],
        excludeMessages: ["wasSentByApi"],
        addUrlEvents: false,
        addUrlTypesMessages: false,
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
      webhookUrl,
      pedroV2Gate: webhookDecision,
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
