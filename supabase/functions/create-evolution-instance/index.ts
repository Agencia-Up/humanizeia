import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
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
  const { instance_name, user_id, friendly_name, custom_api_url, custom_api_key } = body;

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
  console.log(`[create-evolution-instance] Create response (${createRes.status}): ${createText.substring(0, 500)}`);

  let createData: any = {};
  try { createData = JSON.parse(createText); } catch {}

  if (!createRes.ok && createRes.status !== 200 && createRes.status !== 201) {
    return new Response(JSON.stringify({
      success: false,
      error: `Falha na Uazapi (Erro ${createRes.status}): Verifique se sua URL está correta (ex: https://dominio.com.br) e seu Token Global. Detalhes: ${createText}`,
      details: createText,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // In Uazapi, the token is returned on create.
  const instanceToken = createData?.token || api_key;

  // 2. Get QR Code
  let qrCode: string | null = createData?.qrcode?.base64 || createData?.hash?.qrcode || null;
  // If Uazapi, it might be inside response.instance.qrcode.base64
  if (!qrCode && createData?.instance?.qrcode?.base64) {
    qrCode = createData.instance.qrcode.base64;
  }

  if (!qrCode) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    // Try Evolution (GET) or Uazapi (POST)
    let qrRes = await fetch(`${baseUrl}/instance/connect/${instance_name}`, { // Evolution API
      method: 'GET',
      headers: { 
        'apikey': api_key,
        'Authorization': `Bearer ${api_key}`
      },
    });
    
    // If 404 or fails, try Uazapi connect POST endpoint
    if (!qrRes.ok) {
        qrRes = await fetch(`${baseUrl}/instance/connect`, {
            method: 'POST',
            headers: { 
                'token': instanceToken,
                'apikey': instanceToken
            },
        });
    }
    if (qrRes.ok) {
      const qrText = await qrRes.text();
      try {
        const qrData = JSON.parse(qrText);
        qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
      } catch {}
    }
  }

  // 2.5. Set webhook for this instance
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const webhookUrl = `${supabaseUrl}/functions/v1/uazapi-webhook`;
  try {
    // Evolution API
    let webhookRes = await fetch(`${baseUrl}/webhook/set/${instance_name}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'apikey': api_key,
        'Authorization': `Bearer ${api_key}`
      },
      body: JSON.stringify({
        webhook: {
          url: webhookUrl,
          enabled: true,
          webhook_by_events: false,
          webhook_base64: false,
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
        },
      }),
    });
    
    // For Uazapi
    if (!webhookRes.ok) {
        await fetch(`${baseUrl}/webhook/set`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'token': instanceToken
            },
            body: JSON.stringify({
                url: webhookUrl,
                enabled: true,
                webhook_by_events: false,
                webhook_base64: false,
                events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
            })
        });
    }
    console.log(`[create-evolution-instance] Webhook set for ${instance_name}`);
  } catch (webhookErr) {
    console.warn('[create-evolution-instance] Failed to set webhook:', webhookErr);
  }

  // 3. Save to wa_instances
  const { error: insertErr } = await supabase
    .from('wa_instances')
    .insert({
      user_id,
      instance_name,
      friendly_name: friendly_name || instance_name,
      api_url: baseUrl,
      api_key_encrypted: instanceToken, // Salvar o token da instancia (se Uazapi)
      phone_number: '',
      status: 'waiting_qr',
      is_active: false,
      provider: 'evolution',
    });

  if (insertErr) {
    console.error('[create-evolution-instance] DB insert error:', insertErr);
    await supabase.from('whatsapp_config').upsert({
      user_id,
      api_url: baseUrl,
      api_key: api_key,
      instance_name,
      is_active: false,
      phone_number: '',
    }, { onConflict: 'user_id' });
  }

  return new Response(JSON.stringify({
    success: true,
    qr_code: qrCode,
    provider: 'evolution',
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
