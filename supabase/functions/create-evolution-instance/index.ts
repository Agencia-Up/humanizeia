import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const provider = body.provider || "evolution";

    if (provider === "meta") {
      return await handleMetaProvider(supabase, body);
    }
    return await handleEvolutionProvider(supabase, body);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[V6.0] Erro critico:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ====================== META API PROVIDER ======================

async function handleMetaProvider(supabase: any, body: any) {
  const { user_id, friendly_name, phone_number_id, waba_id, access_token } = body;

  if (!user_id || !phone_number_id || !access_token || !friendly_name) {
    return new Response(JSON.stringify({
      success: false,
      error: "Campos obrigatorios: user_id, friendly_name, phone_number_id, access_token",
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const verifyRes = await fetch(
      `https://graph.facebook.com/v21.0/${phone_number_id}?fields=verified_name,display_phone_number,quality_rating`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    if (!verifyRes.ok) {
      const errText = await verifyRes.text();
      return new Response(JSON.stringify({ success: false, error: `Meta API error: ${verifyRes.status}`, details: errText }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phoneData = await verifyRes.json();
    const phoneNumber = phoneData.display_phone_number || null;
    const verifiedName = phoneData.verified_name || friendly_name;
    const instanceSlug = `meta-${Date.now().toString(36)}`;

    const { data: newInstance, error: insertErr } = await supabase
      .from("wa_instances")
      .insert({
        user_id,
        instance_name: instanceSlug,
        friendly_name: verifiedName,
        api_url: "https://graph.facebook.com/v21.0",
        api_key_encrypted: access_token,
        phone_number: phoneNumber,
        status: "connected",
        is_active: true,
        provider: "meta",
        meta_config: { phone_number_id, waba_id: waba_id || null },
      })
      .select("id").single();

    if (insertErr) throw insertErr;

    return new Response(JSON.stringify({
      success: true, instance_id: newInstance.id, provider: "meta",
      phone_number: phoneNumber, verified_name: verifiedName,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: `Meta API error: ${err.message}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// ====================== EVOLUTION / UAZAPI PROVIDER ======================

async function handleEvolutionProvider(supabase: any, body: any) {
  const { instance_name, user_id, friendly_name, agent_id } = body;

  const api_url = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/$/, "");
  const api_key = Deno.env.get("EVOLUTION_API_KEY") || "";

  if (!api_url || !api_key) {
    return new Response(JSON.stringify({
      success: false,
      error: "EVOLUTION_API_URL ou EVOLUTION_API_KEY nao configurado nos Secrets do Supabase. Acesse: supabase.com > Edge Functions > Secrets",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!instance_name || !user_id) {
    return new Response(JSON.stringify({ success: false, error: "instance_name e user_id sao obrigatorios" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[V6.0] Criando instancia: ${instance_name} em ${api_url}`);

  // 1. Criar instancia na Uazapi/Evolution
  const createRes = await fetch(`${api_url}/instance/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": api_key,
      "token": api_key,
      "admintoken": api_key,
    },
    body: JSON.stringify({
      instanceName: instance_name,
      token: api_key,
      qrcode: true,
    }),
  });

  const createText = await createRes.text();
  console.log(`[V6.0] Create response (${createRes.status}): ${createText.substring(0, 600)}`);

  let createData: any = {};
  try { createData = JSON.parse(createText); } catch (e) { console.error("[V6.0] Parse error:", e); }

  const instanceToken = createData?.token || createData?.instance?.token || api_key;

  // 2. Extrair QR Code da resposta de criacao
  let qrCode: string | null =
    createData?.qrcode?.base64 ||
    createData?.instance?.qrcode?.base64 ||
    createData?.hash?.qrcode ||
    createData?.base64 ||
    null;

  // 3. Se QR nao veio, tentar endpoints alternativos
  if (!qrCode) {
    console.log("[V6.0] QR nao veio no create. Aguardando 3s e tentando /instance/connect/...");
    await new Promise((r) => setTimeout(r, 3000));

    // Tentativa 1: GET /instance/connect/{name} (Evolution API padrao)
    try {
      const r1 = await fetch(`${api_url}/instance/connect/${instance_name}`, {
        method: "GET",
        headers: { "apikey": api_key, "token": instanceToken, "admintoken": api_key },
      });
      const t1 = await r1.text();
      console.log(`[V6.0] connect GET (${r1.status}): ${t1.substring(0, 400)}`);
      if (r1.ok) {
        const d1 = JSON.parse(t1);
        qrCode = d1?.base64 || d1?.qrcode?.base64 || d1?.code || null;
      }
    } catch (e) { console.log("[V6.0] connect GET falhou:", e); }

    // Tentativa 2: POST /instance/connect (Uazapi style)
    if (!qrCode) {
      try {
        const r2 = await fetch(`${api_url}/instance/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "token": instanceToken, "apikey": api_key, "admintoken": api_key },
          body: JSON.stringify({ instanceName: instance_name }),
        });
        const t2 = await r2.text();
        console.log(`[V6.0] connect POST (${r2.status}): ${t2.substring(0, 400)}`);
        if (r2.ok) {
          const d2 = JSON.parse(t2);
          qrCode = d2?.base64 || d2?.qrcode?.base64 || d2?.code || null;
        }
      } catch (e) { console.log("[V6.0] connect POST falhou:", e); }
    }
  }

  // 4. Configurar Webhook automaticamente
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const webhookUrl = `${supabaseUrl}/functions/v1/uazapi-webhook`;
  try {
    const wRes = await fetch(`${api_url}/webhook/set/${instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": api_key, "token": instanceToken },
      body: JSON.stringify({
        webhook: { url: webhookUrl, enabled: true, events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "MESSAGES_UPDATE"] },
      }),
    });
    console.log(`[V6.0] Webhook set (${wRes.status}): ${webhookUrl}`);
  } catch (e) { console.warn("[V6.0] Webhook setup falhou:", e); }

  // 5. Salvar no banco
  const { data: newInstance, error: insertErr } = await supabase
    .from("wa_instances")
    .insert({
      user_id,
      instance_name,
      friendly_name: friendly_name || instance_name,
      api_url: api_url,
      api_key_encrypted: instanceToken,
      status: "waiting_qr",
      is_active: false,
      provider: "evolution",
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error("[V6.0] Erro ao salvar instancia:", insertErr.message);
  }

  // 6. Vincular ao Agente automaticamente
  if (newInstance && agent_id) {
    console.log(`[V6.0] Vinculando instancia ${newInstance.id} ao agente ${agent_id}`);
    const { data: agentData } = await supabase.from("wa_ai_agents").select("instance_ids").eq("id", agent_id).single();
    if (agentData) {
      const ids: string[] = agentData.instance_ids || [];
      if (!ids.includes(newInstance.id)) {
        await supabase.from("wa_ai_agents").update({ instance_ids: [...ids, newInstance.id] }).eq("id", agent_id);
      }
    }
  }

  console.log(`[V6.0] Concluido. QR Code: ${qrCode ? "OBTIDO ✓" : "NAO OBTIDO ✗"}`);

  return new Response(JSON.stringify({
    success: true,
    qr_code: qrCode,
    instance_id: newInstance?.id || null,
    provider: "evolution",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
