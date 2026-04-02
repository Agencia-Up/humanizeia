import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req: Request) => {
  console.log(`[create-evolution-instance] Received ${req.method} request`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const provider = body.provider || 'evolution';

    if (provider === 'meta') {
      return await handleMetaProvider(supabase, body);
    } else {
      return await handleEvolutionProvider(supabase, body);
    }
  } catch (error: unknown) {
    console.error('[create-evolution-instance] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ====================== META API PROVIDER ======================

async function handleMetaProvider(supabase: any, body: any) {
  const { user_id, friendly_name, phone_number_id, waba_id, access_token } = body;

  if (!user_id || !phone_number_id || !access_token || !friendly_name) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Campos obrigatórios: user_id, friendly_name, phone_number_id, access_token',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[create-evolution-instance] Verifying Meta API for phone_number_id: ${phone_number_id}`);

  try {
    const verifyRes = await fetch(
      `https://graph.facebook.com/v21.0/${phone_number_id}?fields=verified_name,display_phone_number,quality_rating`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    if (!verifyRes.ok) {
      const errText = await verifyRes.text();
      return new Response(JSON.stringify({
        success: false,
        error: `Meta API verification failed: ${verifyRes.status}`,
        details: errText,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phoneData = await verifyRes.json();
    const phoneNumber = phoneData.display_phone_number || null;
    const verifiedName = phoneData.verified_name || friendly_name;

    const instanceSlug = friendly_name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'meta-instance';

    const { data: newInstance, error: insertErr } = await supabase
      .from('wa_instances')
      .insert({
        user_id,
        instance_name: `meta-${instanceSlug}-${Date.now().toString(36)}`,
        friendly_name: verifiedName,
        api_url: 'https://graph.facebook.com/v21.0',
        api_key_encrypted: access_token,
        phone_number: phoneNumber,
        status: 'connected',
        is_active: true,
        provider: 'meta',
        meta_config: {
          phone_number_id,
          waba_id: waba_id || null,
          access_token_encrypted: access_token,
          quality_rating: phoneData.quality_rating || null,
        },
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[create-evolution-instance] Meta insert error:', insertErr);
      return new Response(JSON.stringify({ success: false, error: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      instance_id: newInstance.id,
      provider: 'meta',
      phone_number: phoneNumber,
      verified_name: verifiedName,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      success: false,
      error: `Meta API error: ${err.message}`,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// ====================== EVOLUTION API PROVIDER ======================

async function handleEvolutionProvider(supabase: any, body: any) {
  const { instance_name, user_id, friendly_name, custom_api_url, custom_api_key, agent_id } = body;

  // Read credentials: use custom if provided, otherwise fallback to secrets
  const api_url = (custom_api_url || Deno.env.get('EVOLUTION_API_URL') || '').trim();
  const api_key = (custom_api_key || Deno.env.get('EVOLUTION_API_KEY') || '').trim();

  if (!api_url || !api_key) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Serviço de WhatsApp não configurado pelo administrador. Verifique as SECRETS EVOLUTION_API_URL e EVOLUTION_API_KEY no painel Supabase.',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!instance_name || !user_id) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Campos obrigatórios: instance_name, user_id',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const baseUrl = api_url.replace(/\/$/, '');

  // 1. Create instance on Evolution API
  console.log(`[create-evolution-instance] Creating instance: ${instance_name} at ${baseUrl}`);
  const createRes = await fetch(`${baseUrl}/instance/create`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'apikey': api_key,
      'Authorization': `Bearer ${api_key}`,
      'admintoken': api_key
    },
    body: JSON.stringify({
      instanceName: instance_name,
      name: instance_name,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      groupsIgnore: true,
    }),
  });

  const createText = await createRes.text();
  let createData: any = {};
  try { createData = JSON.parse(createText); } catch {}

  const instanceToken = createData?.token || api_key;

  // 2. Get QR Code
  let qrCode: string | null = createData?.qrcode?.base64 || createData?.hash?.qrcode || createData?.instance?.qrcode?.base64 || null;

  if (!qrCode) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    let qrRes = await fetch(`${baseUrl}/instance/connect/${instance_name}`, {
      method: 'GET',
      headers: { 'apikey': api_key, 'admintoken': api_key },
    });
    if (qrRes.ok) {
        const qrData = await qrRes.json();
        qrCode = qrData?.base64 || qrData?.qrcode?.base64 || qrData?.qrcode || null;
    }
  }

  // 2.5. Set webhook
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const webhookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/uazapi-webhook`;
  try {
    await fetch(`${baseUrl}/webhook/set/${instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': api_key },
      body: JSON.stringify({
        webhook: { url: webhookUrl, enabled: true, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"] }
      }),
    });
  } catch (e) { console.warn('Webhook jump failed', e); }

  // 3. Save to wa_instances
  const { data: newInstance, error: insertErr } = await supabase
    .from('wa_instances')
    .insert({
      user_id,
      instance_name,
      friendly_name: friendly_name || instance_name,
      api_url: baseUrl,
      api_key_encrypted: instanceToken,
      status: 'waiting_qr',
      is_active: false,
      provider: 'evolution',
    })
    .select('id')
    .single();

  // 4. AUTO-LINK TO AGENT (V5.7)
  if (!insertErr && newInstance && agent_id) {
    console.log(`[V5.7] Auto-linking to agent: ${agent_id}`);
    const { data: currentAgent } = await supabase
      .from('wa_ai_agents')
      .select('instance_ids')
      .eq('id', agent_id)
      .single();
    
    if (currentAgent) {
      const ids = currentAgent.instance_ids || [];
      if (!ids.includes(newInstance.id)) {
        await supabase
          .from('wa_ai_agents')
          .update({ instance_ids: [...ids, newInstance.id] })
          .eq('id', agent_id);
      }
    }
  }

  return new Response(JSON.stringify({
    success: true,
    qr_code: qrCode,
    instance_id: newInstance?.id,
    provider: 'evolution',
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
