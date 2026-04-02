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

  // Read Evolution API credentials from environment
  const evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL');
  const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');

  try {
    const { user_id, instance_id } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ success: false, error: 'user_id obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Try wa_instances first (new multi-instance approach)
    let instanceName: string | null = null;
    let apiUrl: string | null = null;
    let apiKey: string | null = null;

    if (instance_id) {
      const { data: inst } = await supabase
        .from('wa_instances')
        .select('instance_name, api_url, api_key_encrypted')
        .eq('id', instance_id)
        .eq('user_id', user_id)
        .single();

      if (inst) {
        instanceName = inst.instance_name;
        apiUrl = inst.api_url;
        apiKey = inst.api_key_encrypted;
      }
    } else {
      // Get latest waiting_qr instance
      const { data: inst } = await supabase
        .from('wa_instances')
        .select('instance_name, api_url, api_key_encrypted')
        .eq('user_id', user_id)
        .eq('provider', 'evolution')
        .in('status', ['waiting_qr', 'disconnected'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (inst) {
        instanceName = inst.instance_name;
        apiUrl = inst.api_url;
        apiKey = inst.api_key_encrypted;
      }
    }

    // Fallback to whatsapp_config
    if (!instanceName) {
      const { data: config } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('user_id', user_id)
        .single();

      if (config) {
        instanceName = config.instance_name;
        apiUrl = config.api_url;
        apiKey = config.api_key;
      }
    }

    if (!instanceName) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhuma instância encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use instance-specific token as primary (crucial for Uazapi), fallback to Global Admin Token
    const baseUrl = (apiUrl || evolutionApiUrl || '').replace(/\/$/, '');
    const key = apiKey || evolutionApiKey || '';

    if (!baseUrl || !key) {
      return new Response(JSON.stringify({ success: false, error: 'Credenciais da Evolution API não encontradas' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check connection state
    const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
      headers: { 'apikey': key },
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
      let phoneNumber = '';
      try {
        const infoRes = await fetch(`${baseUrl}/instance/fetchInstances`, {
          headers: { 'apikey': key },
        });
        if (infoRes.ok) {
          const instances = await infoRes.json();
          const inst = Array.isArray(instances)
            ? instances.find((i: any) => i.instance?.instanceName === instanceName || i.instanceName === instanceName)
            : null;
          phoneNumber = inst?.instance?.owner || inst?.owner || '';
          phoneNumber = phoneNumber.replace(/@.*$/, '');
        }
      } catch {}

      // Update wa_instances
      await supabase
        .from('wa_instances')
        .update({
          status: 'connected',
          is_active: true,
          phone_number: phoneNumber || '',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user_id)
        .eq('instance_name', instanceName);

      // Also update whatsapp_config for backward compat
      await supabase
        .from('whatsapp_config')
        .update({
          is_active: true,
          phone_number: phoneNumber || '',
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

    // Fetch QR Code (Try Evolution API first)
    let qrRes = await fetch(`${baseUrl}/instance/connect/${instanceName}`, {
      method: 'GET',
      headers: { 
        'apikey': key,
        'Authorization': `Bearer ${key}`
      },
    });
    
    // If it's a Uazapi instance, the method is POST to /instance/connect with the instance token
    if (!qrRes.ok) {
        qrRes = await fetch(`${baseUrl}/instance/connect`, {
            method: 'POST',
            headers: {
                'token': key,
                'apikey': key,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
    }

    const qrText = await qrRes.text();
    console.log(`[get-evolution-qrcode] QR response (${qrRes.status}): ${qrText.substring(0, 300)}`);
    console.log(`[get-evolution-qrcode] Used token beginning with: ${key.substring(0, 6)}...`);

    let qrCode: string | null = null;
    let connected = false;

    try {
      const qrData = JSON.parse(qrText);
      qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
      connected = qrData?.state === 'open' || qrData?.instance?.state === 'open';
    } catch {}

    if (connected) {
      await supabase
        .from('wa_instances')
        .update({ status: 'connected', is_active: true, updated_at: new Date().toISOString() })
        .eq('user_id', user_id)
        .eq('instance_name', instanceName);

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
