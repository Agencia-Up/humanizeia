import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

function parseConnectionState(payload: any) {
  const state = String(
    payload?.instance?.state ||
    payload?.instance?.status ||
    payload?.state ||
    ''
  ).toLowerCase().trim();

  const connected =
    state === 'open' ||
    state === 'connected' ||
    payload?.connected === true ||
    payload?.loggedIn === true ||
    payload?.instance?.connected === true ||
    payload?.instance?.loggedIn === true ||
    payload?.status?.connected === true ||
    payload?.status?.loggedIn === true;

  return { state, connected };
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const { user_id, instance_id, instance_name, seller_member_id } = await req.json();

    const { data: sellerRows } = await supabase
      .from('ai_team_members')
      .select('id, user_id')
      .eq('auth_user_id', user.id)
      .eq('is_active', true);

    const sellerMemberIds = new Set((sellerRows || []).map((row: any) => row.id));
    const allowedMasterIds = new Set<string>([
      user.id,
      ...((sellerRows || []).map((row: any) => row.user_id).filter(Boolean)),
    ]);

    if (user_id && !allowedMasterIds.has(user_id)) {
      return jsonResponse({ success: false, error: 'Nenhuma instancia encontrada' }, 404);
    }

    const requestedMasterId = user_id || (sellerRows?.[0]?.user_id) || user.id;
    const isAuthorizedInstance = (inst: any) =>
      inst?.user_id === user.id ||
      (!!inst?.seller_member_id && sellerMemberIds.has(inst.seller_member_id));

    let instanceId: string | null = null;
    let instanceName: string | null = null;
    let apiUrl: string | null = null;
    let apiKey: string | null = null;
    let instanceSellerMemberId: string | null = null;

    if (instance_id) {
      const { data: inst } = await supabase
        .from('wa_instances')
        .select('id, user_id, seller_member_id, instance_name, api_url, api_key_encrypted')
        .eq('id', instance_id)
        .maybeSingle();

      if (inst && isAuthorizedInstance(inst)) {
        instanceId = inst.id;
        instanceName = inst.instance_name;
        apiUrl = inst.api_url;
        apiKey = inst.api_key_encrypted;
        instanceSellerMemberId = inst.seller_member_id || null;
      }
    } else if (instance_name) {
      const { data: rows } = await supabase
        .from('wa_instances')
        .select('id, user_id, seller_member_id, instance_name, api_url, api_key_encrypted')
        .eq('instance_name', instance_name)
        .in('user_id', Array.from(allowedMasterIds));

      const inst = (rows || []).find((row: any) =>
        isAuthorizedInstance(row) &&
        (!seller_member_id || row.seller_member_id === seller_member_id)
      );

      if (inst) {
        instanceId = inst.id;
        instanceName = inst.instance_name;
        apiUrl = inst.api_url;
        apiKey = inst.api_key_encrypted;
        instanceSellerMemberId = inst.seller_member_id || null;
      }
    } else {
      let query = supabase
        .from('wa_instances')
        .select('id, user_id, seller_member_id, instance_name, api_url, api_key_encrypted')
        .eq('user_id', requestedMasterId)
        .eq('provider', 'evolution')
        .in('status', ['waiting_qr', 'disconnected'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (sellerMemberIds.size > 0 && requestedMasterId !== user.id) {
        query = query.in('seller_member_id', Array.from(sellerMemberIds));
      }

      const { data: rows } = await query;
      const inst = (rows || []).find((row: any) => isAuthorizedInstance(row));

      if (inst) {
        instanceId = inst.id;
        instanceName = inst.instance_name;
        apiUrl = inst.api_url;
        apiKey = inst.api_key_encrypted;
        instanceSellerMemberId = inst.seller_member_id || null;
      }
    }

    if (!instanceName && requestedMasterId === user.id) {
      const { data: config } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('user_id', requestedMasterId)
        .maybeSingle();

      if (config) {
        instanceName = config.instance_name;
        apiUrl = config.api_url;
        apiKey = config.api_key;
      }
    }

    if (!instanceName) {
      return jsonResponse({ success: false, error: 'Nenhuma instancia encontrada' }, 404);
    }

    const baseUrl = (apiUrl || evolutionApiUrl || '').replace(/\/$/, '');
    const instanceToken = apiKey || '';
    const adminToken = evolutionApiKey || '';

    if (!baseUrl || (!instanceToken && !adminToken)) {
      return jsonResponse({ success: false, error: 'Credenciais da Evolution API nao encontradas' }, 500);
    }

    let currentState = 'disconnected';
    let currentConnected = false;

    const stateAttempts = [
      { label: 'status-token', url: `${baseUrl}/instance/status`, headers: buildInstanceHeaders(instanceToken || adminToken, adminToken) },
      { label: 'connection-state-admin', url: `${baseUrl}/instance/connectionState/${instanceName}`, headers: buildAdminHeaders(adminToken || instanceToken) },
    ];

    for (const attempt of stateAttempts) {
      try {
        const stateRes = await fetch(attempt.url, { headers: attempt.headers });
        if (!stateRes.ok) continue;
        const stateData = await stateRes.json();
        const parsed = parseConnectionState(stateData);
        currentState = parsed.state || currentState;
        currentConnected = parsed.connected;
        break;
      } catch {}
    }

    console.log(`[get-evolution-qrcode] Instance ${instanceName} state: ${currentState}`);

    const updateInstance = async (updates: Record<string, unknown>) => {
      if (instanceId) {
        await supabase.from('wa_instances').update(updates).eq('id', instanceId);
      } else {
        await supabase
          .from('wa_instances')
          .update(updates)
          .eq('user_id', requestedMasterId)
          .eq('instance_name', instanceName);
      }
    };

    const updateMasterConfigIfNeeded = async (updates: Record<string, unknown>) => {
      if (!instanceSellerMemberId) {
        await supabase.from('whatsapp_config').update(updates).eq('user_id', requestedMasterId);
      }
    };

    if (currentConnected) {
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
          phoneNumber = String(inst?.instance?.owner || inst?.owner || '').replace(/@.*$/, '');
        }
      } catch {}

      const updates = {
        status: 'connected',
        is_active: true,
        phone_number: phoneNumber || '',
        updated_at: new Date().toISOString(),
      };

      await updateInstance(updates);
      await updateMasterConfigIfNeeded({
        is_active: true,
        phone_number: phoneNumber || '',
        updated_at: new Date().toISOString(),
      });

      return jsonResponse({
        success: true,
        connected: true,
        qr_code: null,
        phone_number: phoneNumber,
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
        connected = parseConnectionState(qrData).connected;
      } catch {}

      if (qrCode || connected) {
        break;
      }
    }

    if (connected) {
      await updateInstance({ status: 'connected', is_active: true, updated_at: new Date().toISOString() });
      await updateMasterConfigIfNeeded({ is_active: true, updated_at: new Date().toISOString() });
    } else if (qrCode) {
      await updateInstance({ status: 'waiting_qr', is_active: false, updated_at: new Date().toISOString() });
    }

    return jsonResponse({
      success: true,
      connected,
      qr_code: qrCode,
    });
  } catch (error: unknown) {
    console.error('[get-evolution-qrcode] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ success: false, error: message }, 500);
  }
});
