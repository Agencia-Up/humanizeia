import { createClient } from "npm:@supabase/supabase-js@2";

function buildAdminHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    apikey: apiKey,
    token: apiKey,
    admintoken: apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

function buildInstanceHeaders(instanceToken: string, adminToken?: string) {
  return {
    "Content-Type": "application/json",
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

function buildWebhookPayload(webhookUrl: string, instanceName?: string) {
  return {
    enabled: true,
    url: webhookUrl,
    local_map: false,
    STATUS_INSTANCE: true,
    QRCODE_UPDATED: true,
    MESSAGES_UPSERT: true,
    MESSAGES_SET: true,
    MESSAGES_UPDATE: true,
    ...(instanceName ? { instanceName } : {}),
  };
}

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
    }

    return await handleEvolutionProvider(supabase, body);
  } catch (error: unknown) {
    console.error('[create-evolution-instance] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

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

async function handleEvolutionProvider(supabase: any, body: any) {
  const { instance_name, user_id, friendly_name } = body;

  const api_url = Deno.env.get('EVOLUTION_API_URL');
  const api_key = Deno.env.get('EVOLUTION_API_KEY');

  if (!api_url || !api_key) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Evolution API/Uazapi não configurada no servidor. Contate o administrador.',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!instance_name || !user_id) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Campos obrigatórios: instance_name, user_id',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const baseUrl = api_url.replace(/\/$/, '');
  const adminHeaders = buildAdminHeaders(api_key);

  console.log(`[create-evolution-instance] Creating instance: ${instance_name} at ${baseUrl}`);

  const createAttempts = [
    {
      label: 'url-name',
      url: `${baseUrl}/instance/create/${encodeURIComponent(instance_name)}`,
      payload: {
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        groupsIgnore: true,
      },
    },
    {
      label: 'body-instanceName',
      url: `${baseUrl}/instance/create`,
      payload: {
        instanceName: instance_name,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        groupsIgnore: true,
      },
    },
    {
      label: 'body-name',
      url: `${baseUrl}/instance/create`,
      payload: {
        name: instance_name,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        groupsIgnore: true,
      },
    },
  ];

  let createStatus = 0;
  let createText = '';
  let createData: any = {};
  let successfulAttempt: string | null = null;

  for (const attempt of createAttempts) {
    console.log(`[create-evolution-instance] Create attempt (${attempt.label}): ${attempt.url}`);
    const createRes = await fetch(attempt.url, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify(attempt.payload),
    });

    createStatus = createRes.status;
    createText = await createRes.text();
    console.log(`[create-evolution-instance] ${attempt.label} response (${createStatus}): ${createText.substring(0, 500)}`);

    createData = {};
    try { createData = JSON.parse(createText); } catch {}

    if (createRes.ok || createStatus === 200 || createStatus === 201 || createStatus === 409) {
      successfulAttempt = attempt.label;
      break;
    }
  }

  if (!successfulAttempt) {
    return new Response(JSON.stringify({
      success: false,
      error: `Erro ao criar instância na Uazapi/Evolution API: ${createStatus}`,
      details: createText,
      attempted_format: createAttempts.map((a) => a.label),
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let qrCode: string | null =
    extractQrCodeCandidate(createData);
  const instanceToken =
    createData?.instance?.token ||
    createData?.token ||
    createData?.data?.token ||
    null;

  if (!qrCode) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const qrAttempts = [
      {
        label: 'get-connect-by-name',
        url: `${baseUrl}/instance/connect/${encodeURIComponent(instance_name)}`,
        method: 'GET',
      },
      {
        label: 'post-connect-body-instanceName',
        url: `${baseUrl}/instance/connect`,
        method: 'POST',
        body: { instanceName: instance_name },
        headers: adminHeaders,
      },
      ...(instanceToken ? [{
        label: 'post-connect-instance-token',
        url: `${baseUrl}/instance/connect`,
        method: 'POST',
        body: {},
        headers: buildInstanceHeaders(instanceToken, api_key),
      }] : []),
      ...(instanceToken ? [{
        label: 'post-connect-instance-token-name',
        url: `${baseUrl}/instance/connect`,
        method: 'POST',
        body: { instanceName: instance_name },
        headers: buildInstanceHeaders(instanceToken, api_key),
      }] : []),
      ...(instanceToken ? [{
        label: 'get-connect-instance-token-by-name',
        url: `${baseUrl}/instance/connect/${encodeURIComponent(instance_name)}`,
        method: 'GET',
        headers: buildInstanceHeaders(instanceToken, api_key),
      },
      ] : []),
    ];

    for (const attempt of qrAttempts) {
      const qrRes = await fetch(attempt.url, {
        method: attempt.method,
        headers: attempt.headers,
        body: attempt.body ? JSON.stringify(attempt.body) : undefined,
      });
      const qrText = await qrRes.text();
      console.log(`[create-evolution-instance] ${attempt.label} QR response (${qrRes.status}): ${qrText.substring(0, 300)}`);
      if (!qrRes.ok) continue;
      try {
        const qrData = JSON.parse(qrText);
        console.log(`[create-evolution-instance] ${attempt.label} top-level keys: ${Object.keys(qrData || {}).join(', ')}`);
        console.log(`[create-evolution-instance] ${attempt.label} instance keys: ${Object.keys(qrData?.instance || {}).join(', ')}`);
        qrCode = extractQrCodeCandidate(qrData);
      } catch {}
      if (qrCode) break;
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const webhookUrl = `${supabaseUrl}/functions/v1/uazapi-webhook`;
  try {
    const webhookPayload = buildWebhookPayload(webhookUrl, instance_name);
    let webhookRes = await fetch(`${baseUrl}/webhook/set/${instance_name}`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        ...webhookPayload,
      }),
    });

    if (webhookRes.status === 405) {
      await webhookRes.text().catch(() => '');
      webhookRes = await fetch(`${baseUrl}/webhook/instance`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          enabled: true,
          url: webhookUrl,
          events: ["messages", "messages_update", "connection", "qrcode"],
          excludeMessages: ["wasSentByApi"],
          instanceName: instance_name,
        }),
      });
    }

    console.log(`[create-evolution-instance] Webhook response: ${webhookRes.status}`);
    console.log(`[create-evolution-instance] Webhook set for ${instance_name}`);
  } catch (webhookErr) {
    console.warn('[create-evolution-instance] Failed to set webhook:', webhookErr);
  }

  const insertPayload = {
    user_id,
    instance_name,
    friendly_name: friendly_name || instance_name,
    api_url: baseUrl,
    api_key_encrypted: instanceToken || api_key,
    phone_number: '',
    status: 'waiting_qr',
    is_active: false,
    provider: 'evolution',
  };

  const { data: insertedInstance, error: insertErr } = await supabase
    .from('wa_instances')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertErr) {
    console.error('[create-evolution-instance] DB insert error:', insertErr);
    await supabase.from('whatsapp_config').upsert({
      user_id,
      api_url: baseUrl,
      api_key: instanceToken || api_key,
      instance_name,
      is_active: false,
      phone_number: '',
    }, { onConflict: 'user_id' });
  }

  return new Response(JSON.stringify({
    success: true,
    instance_id: insertedInstance?.id || null,
    qr_code: qrCode,
    provider: 'evolution',
    create_attempt: successfulAttempt,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
