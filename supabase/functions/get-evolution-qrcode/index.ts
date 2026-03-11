import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ success: false, error: 'user_id obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch user's whatsapp_config
    const { data: config, error: configErr } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (configErr || !config) {
      return new Response(JSON.stringify({ success: false, error: 'Configuração não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = config.api_url.replace(/\/$/, '');
    const instanceName = config.instance_name;

    // Check connection state
    const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
      headers: { 'apikey': config.api_key },
    });

    let currentState = 'disconnected';
    if (stateRes.ok) {
      try {
        const stateData = await stateRes.json();
        currentState = stateData?.state || stateData?.instance?.state || 'disconnected';
      } catch {}
    }

    console.log(`[get-evolution-qrcode] Instance ${instanceName} state: ${currentState}`);

    // If connected, update DB and return
    if (currentState === 'open') {
      // Try to get phone number from instance info
      let phoneNumber = '';
      try {
        const infoRes = await fetch(`${baseUrl}/instance/fetchInstances`, {
          headers: { 'apikey': config.api_key },
        });
        if (infoRes.ok) {
          const instances = await infoRes.json();
          const inst = Array.isArray(instances)
            ? instances.find((i: any) => i.instance?.instanceName === instanceName || i.instanceName === instanceName)
            : null;
          phoneNumber = inst?.instance?.owner || inst?.owner || '';
          // Clean phone number - remove @s.whatsapp.net suffix
          phoneNumber = phoneNumber.replace(/@.*$/, '');
        }
      } catch {}

      await supabase
        .from('whatsapp_config')
        .update({
          is_active: true,
          phone_number: phoneNumber || config.phone_number || '',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user_id);

      return new Response(JSON.stringify({
        success: true,
        connected: true,
        qr_code: null,
        phone_number: phoneNumber,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch QR Code
    const qrRes = await fetch(`${baseUrl}/instance/connect/${instanceName}`, {
      headers: { 'apikey': config.api_key },
    });

    const qrText = await qrRes.text();
    console.log(`[get-evolution-qrcode] QR response (${qrRes.status}): ${qrText.substring(0, 300)}`);

    let qrCode: string | null = null;
    let connected = false;

    try {
      const qrData = JSON.parse(qrText);
      qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
      connected = qrData?.state === 'open' || qrData?.instance?.state === 'open';
    } catch {}

    if (connected) {
      await supabase
        .from('whatsapp_config')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('user_id', user_id);
    }

    return new Response(JSON.stringify({
      success: true,
      connected,
      qr_code: qrCode,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[get-evolution-qrcode] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
