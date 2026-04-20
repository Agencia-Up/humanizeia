import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function buildAdminHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    apikey: apiKey,
    token: apiKey,
    admintoken: apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

function buildInstanceHeaders(instanceToken: string, adminToken?: string) {
  return {
    'Content-Type': 'application/json',
    token: instanceToken,
    apikey: instanceToken,
    ...(adminToken ? { admintoken: adminToken } : {}),
  };
}

function extractQrCodeCandidate(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.startsWith('data:image/')) return normalized;
    if (normalized.length > 200 && /^[A-Za-z0-9+/=\r\n]+$/.test(normalized)) return normalized;
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractQrCodeCandidate(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const priorityKeys = [
      'base64',
      'qrcode',
      'qrCode',
      'qr_code',
      'qr',
      'code',
      'pairingCode',
      'pairing_code',
      'connectionKey',
    ];

    for (const key of priorityKeys) {
      if (key in record) {
        const found = extractQrCodeCandidate(record[key]);
        if (found) return found;
      }
    }

    for (const nested of Object.values(record)) {
      const found = extractQrCodeCandidate(nested);
      if (found) return found;
    }
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL');
  const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');

  try {
    const { user_id, instance_id, instance_name } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ success: false, error: 'user_id obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
    } else if (instance_name) {
      const { data: inst } = await supabase
        .from('wa_instances')
        .select('instance_name, api_url, api_key_encrypted')
        .eq('instance_name', instance_name)
        .eq('user_id', user_id)
        .maybeSingle();

      if (inst) {
        instanceName = inst.instance_name;
        apiUrl = inst.api_url;
        apiKey = inst.api_key_encrypted;
      }
    } else {
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

    const baseUrl = (apiUrl || evolutionApiUrl || '').replace(/\/$/, '');
    const instanceToken = apiKey || '';
    const adminToken = evolutionApiKey || '';

    if (!baseUrl || (!instanceToken && !adminToken)) {
      return new Response(JSON.stringify({ success: false, error: 'Credenciais da Evolution API não encontradas' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let currentState = 'disconnected';
    if (adminToken || instanceToken) {
      const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
        headers: buildAdminHeaders(adminToken || instanceToken),
      });

      if (stateRes.ok) {
        try {
          const stateData = await stateRes.json();
          currentState = stateData?.state || stateData?.instance?.state || 'disconnected';
        } catch {}
      }
    }

    console.log(`[get-evolution-qrcode] Instance ${instanceName} state: ${currentState}`);

    if (currentState === 'open') {
      let phoneNumber = '';
      try {
        const infoRes = await fetch(`${baseUrl}/instance/fetchInstances`, {
          headers: buildAdminHeaders(adminToken || instanceToken),
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

    let qrCode: string | null = null;
    let connected = false;

    const qrAttempts = [
      {
        label: 'get-connect-by-name-admin',
        url: `${baseUrl}/instance/connect/${instanceName}`,
        method: 'GET',
        headers: buildAdminHeaders(adminToken || instanceToken),
      },
      ...(instanceToken ? [{
        label: 'post-connect-instance-token',
        url: `${baseUrl}/instance/connect`,
        method: 'POST',
        headers: buildInstanceHeaders(instanceToken, adminToken),
        body: {},
      }] : []),
      ...(instanceToken ? [{
        label: 'post-connect-instance-token-name',
        url: `${baseUrl}/instance/connect`,
        method: 'POST',
        headers: buildInstanceHeaders(instanceToken, adminToken),
        body: { instanceName },
      }] : []),
    ];

    for (const attempt of qrAttempts) {
      const qrRes = await fetch(attempt.url, {
        method: attempt.method,
        headers: attempt.headers,
        body: attempt.body ? JSON.stringify(attempt.body) : undefined,
      });

      const qrText = await qrRes.text();
      console.log(`[get-evolution-qrcode] ${attempt.label} QR response (${qrRes.status}): ${qrText.substring(0, 300)}`);

      try {
        const qrData = JSON.parse(qrText);
        console.log(`[get-evolution-qrcode] ${attempt.label} top-level keys: ${Object.keys(qrData || {}).join(', ')}`);
        console.log(`[get-evolution-qrcode] ${attempt.label} instance keys: ${Object.keys(qrData?.instance || {}).join(', ')}`);
        qrCode = extractQrCodeCandidate(qrData) || qrCode;
        connected =
          qrData?.state === 'open' ||
          qrData?.instance?.state === 'open' ||
          qrData?.connected === true ||
          qrData?.instance?.connected === true;
      } catch {}

      if (qrCode || connected) {
        break;
      }
    }

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
