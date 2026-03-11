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
    const { api_url, api_key, instance_name, user_id } = await req.json();

    if (!api_url || !api_key || !instance_name || !user_id) {
      return new Response(JSON.stringify({ success: false, error: 'Campos obrigatórios: api_url, api_key, instance_name, user_id' }), {
        status: 400,
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
      },
      body: JSON.stringify({
        instanceName: instance_name,
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
        error: `Erro ao criar instância na Evolution API: ${createRes.status}`,
        details: createText,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Get QR Code
    let qrCode: string | null = null;

    // Try to extract QR from creation response
    qrCode = createData?.qrcode?.base64 || createData?.hash?.qrcode || null;

    if (!qrCode) {
      // Wait and fetch QR Code separately
      await new Promise(resolve => setTimeout(resolve, 1500));

      const qrRes = await fetch(`${baseUrl}/instance/connect/${instance_name}`, {
        method: 'GET',
        headers: { 'apikey': api_key },
      });

      if (qrRes.ok) {
        const qrText = await qrRes.text();
        console.log(`[create-evolution-instance] QR response: ${qrText.substring(0, 200)}`);
        try {
          const qrData = JSON.parse(qrText);
          qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
        } catch {}
      }
    }

    // 3. Save to whatsapp_config (upsert by user_id) - NO webhook config
    const { error: upsertError } = await supabase
      .from('whatsapp_config')
      .upsert({
        user_id,
        api_url: baseUrl,
        api_key,
        instance_name,
        is_active: false, // Will be set to true when connected
        phone_number: '',
      }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('[create-evolution-instance] DB upsert error:', upsertError);
      return new Response(JSON.stringify({ success: false, error: upsertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      qr_code: qrCode,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[create-evolution-instance] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
