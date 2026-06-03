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

function listEnv(name: string): string[] {
  return String(Deno.env.get(name) || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function includesNormalized(value: string | null | undefined, allowed: string[]): boolean {
  if (!value) return false;
  const normalizedValue = value.toLowerCase().trim();
  return allowed.some((item) => item.toLowerCase().trim() === normalizedValue);
}

async function resolveWebhookFunction(supabase: any, userId: string | null | undefined) {
  // Migracao total v1->v2: o flag global liga o v2 para TODOS os usuarios
  // (consistente com sync-evolution-webhook). Reversivel via PEDRO_V2_ENABLED=false.
  if (["true", "1", "yes", "on", "enabled"].includes(String(Deno.env.get('PEDRO_V2_ENABLED') || '').toLowerCase().trim())) {
    return 'pedro-webhook-v2';
  }

  if (!userId) return 'uazapi-webhook';

  if (includesNormalized(userId, listEnv('PEDRO_V2_ALLOWED_USER_IDS'))) {
    return 'pedro-webhook-v2';
  }

  const allowedEmails = listEnv('PEDRO_V2_ALLOWED_USER_EMAILS');
  if (allowedEmails.length === 0) return 'uazapi-webhook';

  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    console.warn('[create-evolution-instance] Could not resolve user email for Pedro v2 gate:', error.message);
    return 'uazapi-webhook';
  }

  return includesNormalized(data?.user?.email, allowedEmails)
    ? 'pedro-webhook-v2'
    : 'uazapi-webhook';
}

function slugSuffix(value: string | null | undefined) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toLowerCase();
}

function normalizeUazapiInstanceName(instanceName: string, sellerMemberId?: string | null) {
  const normalized = instanceName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'whatsapp';

  if (!sellerMemberId) return normalized;
  const suffix = slugSuffix(sellerMemberId);
  if (!suffix || normalized.endsWith(`-${suffix}`)) return normalized;
  return `${normalized}-${suffix}`;
}

function isAlreadyExistsResponse(status: number, text: string) {
  const normalized = text.toLowerCase();
  return status === 409 ||
    normalized.includes('already') ||
    normalized.includes('exists') ||
    normalized.includes('existente') ||
    normalized.includes('duplic') ||
    normalized.includes('ja existe') ||
    normalized.includes('já existe');
}

function findInPayloadByName(value: unknown, instanceName: string): Record<string, unknown> | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInPayloadByName(item, instanceName);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const names = [
      record.name,
      record.instanceName,
      record.instance_name,
      (record.instance as any)?.name,
      (record.instance as any)?.instanceName,
    ].map((item) => String(item || '').toLowerCase());
    if (names.includes(instanceName.toLowerCase())) return record;
    for (const nested of Object.values(record)) {
      const found = findInPayloadByName(nested, instanceName);
      if (found) return found;
    }
  }
  return null;
}

function extractInstanceToken(value: any): string | null {
  return value?.instance?.token ||
    value?.token ||
    value?.data?.token ||
    value?.instance?.apikey ||
    value?.apikey ||
    value?.key ||
    value?.instance?.key ||
    null;
}

async function findExistingUazapiToken(baseUrl: string, adminHeaders: Record<string, string>, instanceName: string) {
  const endpoints = ['/instance/all', '/instance/list', '/instance/fetchInstances'];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${baseUrl}${endpoint}`, { method: 'GET', headers: adminHeaders });
      const text = await res.text();
      console.log(`[create-evolution-instance] lookup ${endpoint} response (${res.status}): ${text.substring(0, 300)}`);
      if (!res.ok) continue;
      const payload = JSON.parse(text);
      const found = findInPayloadByName(payload, instanceName);
      const token = extractInstanceToken(found);
      if (token) return token;
    } catch {}
  }
  return null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Limite de instâncias por plano (pool compartilhado: master + vendedores)
const INSTANCE_LIMITS_BY_PLAN: Record<string, number> = {
  basico: 10,
  pro: 15,
  enterprise: 15,
};
const DEFAULT_PLAN_LIMIT = INSTANCE_LIMITS_BY_PLAN.basico;

/**
 * Valida limites antes de criar uma instância:
 *   1. Pool da conta master: total de wa_instances WHERE user_id = master_id
 *      não pode passar de INSTANCE_LIMITS_BY_PLAN[plano_master].
 *   2. Se body.seller_member_id presente: vendedor não pode ter mais que 1
 *      instância (count WHERE seller_member_id = X).
 *
 * body.user_id deve ser SEMPRE o master_id (mesmo quando vendedor cria).
 */
async function validatePoolLimits(
  supabase: any,
  body: { user_id?: string; seller_member_id?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const masterId = body.user_id;
  if (!masterId) {
    return { ok: false, error: 'user_id (master_id) é obrigatório' };
  }

  // 1. Pool total da conta master
  const { data: subData } = await supabase
    .from('user_subscriptions')
    .select('plan_id, status')
    .eq('user_id', masterId)
    .maybeSingle();
  const planId = (subData?.plan_id as string | undefined) || 'basico';
  const poolLimit = INSTANCE_LIMITS_BY_PLAN[planId] ?? DEFAULT_PLAN_LIMIT;

  // Pool conta SOMENTE instâncias ativas (is_active = true).
  // Desativadas não consomem cota — quem desativa libera espaço.
  const { count: totalCount } = await supabase
    .from('wa_instances')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', masterId)
    .eq('is_active', true);
  const totalUsed = totalCount ?? 0;

  if (totalUsed >= poolLimit) {
    return {
      ok: false,
      error: `Limite de instâncias da conta atingido (${totalUsed}/${poolLimit} no plano ${planId}). Faça upgrade ou remova uma instância existente.`,
    };
  }

  // 2. Limite individual do vendedor (1 instância ATIVA por vendedor)
  if (body.seller_member_id) {
    const { count: sellerCount } = await supabase
      .from('wa_instances')
      .select('id', { count: 'exact', head: true })
      .eq('seller_member_id', body.seller_member_id)
      .eq('is_active', true);
    if ((sellerCount ?? 0) >= 1) {
      return {
        ok: false,
        error: 'Este vendedor já possui uma instância conectada. Cada vendedor pode ter no máximo 1 número de WhatsApp.',
      };
    }
  }

  return { ok: true };
}

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

    // ── Segurança: confirma que o chamador é dono da conta (user_id = master_id) ──
    // Sem isso, qualquer um com a anon key pública poderia criar instâncias na
    // conta de OUTRO usuário (consumindo o pool do plano dele). Espelha a checagem
    // de get-evolution-qrcode / verify-instance-status.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!);
    const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(callerToken);
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // IMPORTANTE: autorizacao usa active_in_system (vendedor habilitado na
    // plataforma), NAO is_active. is_active reflete estado da linha/instancia
    // (cai pra false quando a instancia desconecta), entao filtrar por is_active
    // bloqueava o vendedor de (re)conectar justamente quando ele mais precisa.
    const { data: callerSellerRows } = await supabase
      .from('ai_team_members')
      .select('id, user_id')
      .eq('auth_user_id', caller.id)
      .eq('active_in_system', true);
    const allowedMasterIds = new Set<string>([
      caller.id,
      ...((callerSellerRows || []).map((r: any) => r.user_id).filter(Boolean)),
    ]);
    if (body.user_id && !allowedMasterIds.has(body.user_id)) {
      return new Response(JSON.stringify({ success: false, error: 'Ação não autorizada para esta conta.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Se a instância é para um vendedor específico, ele precisa pertencer a esta conta.
    if (body.seller_member_id) {
      const { data: memberRow } = await supabase
        .from('ai_team_members')
        .select('id, user_id')
        .eq('id', body.seller_member_id)
        .maybeSingle();
      if (!memberRow || memberRow.user_id !== body.user_id) {
        return new Response(JSON.stringify({ success: false, error: 'Vendedor inválido para esta conta.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const provider = body.provider || 'evolution';

    // ── Validação de pool de instâncias da conta (master + vendedores) ──
    // Sempre antes de criar: count total da conta < limite do plano do master.
    // Se vendedor: também valida que ele já não tem 1 (limite individual).
    const validation = await validatePoolLimits(supabase, body);
    if (!validation.ok) {
      return new Response(JSON.stringify({ success: false, error: validation.error }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
  const { user_id, friendly_name, phone_number_id, waba_id, access_token, seller_member_id } = body;

  if (!user_id || !phone_number_id || !access_token || !friendly_name) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Campos obrigatórios: user_id, friendly_name, phone_number_id, access_token',
    }), {
      status: 200,
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
        status: 200,
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
        seller_member_id: seller_member_id || null,
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
  const { instance_name, user_id, friendly_name, seller_member_id } = body;

  // 28/05/2026 — Cliente NUNCA usa Evolution API. Sempre UaZapi.
  // UAZAPI_URL / UAZAPI_TOKEN sao as keys preferidas; legacy EVOLUTION_*
  // mantidas como fallback pra nao quebrar deploys atuais.
  let api_url = Deno.env.get('UAZAPI_URL') || Deno.env.get('EVOLUTION_API_URL');
  let api_key = Deno.env.get('UAZAPI_ADMIN_TOKEN') || Deno.env.get('EVOLUTION_API_KEY');
  let credSource = 'env';

  // Fallback — herdar URL de uma instância ativa do master (mesmo painel UaZapi).
  // O api_key da instância NÃO funciona como admin token, então não dá pra herdar
  // do banco; mas pelo menos descobrimos a URL correta quando env var estiver vazia.
  if ((!api_url || !api_key) && user_id) {
    const { data: existing } = await supabase
      .from('wa_instances')
      .select('api_url, api_key_encrypted')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .not('api_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.api_url) {
      api_url = api_url || existing.api_url;
      credSource = 'env+db_url';
    }
  }

  if (!api_url || !api_key) {
    return new Response(JSON.stringify({
      success: false,
      error: `API do WhatsApp (UaZapi) sem credenciais no servidor. Faltando: ${[
        !api_url ? 'UAZAPI_URL' : null,
        !api_key ? 'UAZAPI_ADMIN_TOKEN (admin token UaZapi)' : null,
      ].filter(Boolean).join(', ')}. Configure os secrets no Supabase.`,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[create-uazapi-instance] Using credentials from: ${credSource}, url=${api_url}`);

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
  const adminHeaders = buildAdminHeaders(api_key);
  const requestedInstanceName = String(instance_name);
  const uazapiInstanceName = normalizeUazapiInstanceName(requestedInstanceName, seller_member_id);

  // ========================================================================
  // PROBE — testa se o admin token funciona em endpoints conhecidos.
  // UazAPI V6 expoe /instance/all listando instancias com admin token.
  // Se ESSE endpoint tambem 404, o problema NAO eh o caminho de criacao,
  // eh o token errado ou o painel UaZapi nao expoe API admin nesse host.
  // ========================================================================
  let adminProbeStatus = 0;
  let adminProbeBody = '';
  try {
    const probeRes = await fetch(`${baseUrl}/instance/all`, { method: 'GET', headers: adminHeaders });
    adminProbeStatus = probeRes.status;
    adminProbeBody = (await probeRes.text()).substring(0, 200);
    console.log(`[create-uazapi-instance] Admin probe GET /instance/all → ${adminProbeStatus}: ${adminProbeBody}`);
  } catch (err) {
    console.warn(`[create-uazapi-instance] Admin probe falhou: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`[create-uazapi-instance] Creating Uazapi instance: ${uazapiInstanceName} at ${baseUrl}`);

  // Endpoints conhecidos do UazAPI V6 + alguns aliases comuns.
  // Reordenado por probabilidade de funcionar primeiro.
  const createAttempts = [
    {
      label: 'uazapi-v6-instance-init-name',
      url: `${baseUrl}/instance/init`,
      payload: { name: uazapiInstanceName, systemName: 'LogosIA' },
      headers: adminHeaders,
    },
    {
      label: 'uazapi-v6-instance-init-full',
      url: `${baseUrl}/instance/init`,
      payload: { name: uazapiInstanceName, systemName: 'LogosIA', qrcode: true, integration: 'WHATSAPP-BAILEYS' },
      headers: adminHeaders,
    },
    {
      label: 'uazapi-v6-instance-init-instanceName',
      url: `${baseUrl}/instance/init`,
      payload: { instanceName: uazapiInstanceName, systemName: 'LogosIA', qrcode: true },
      headers: adminHeaders,
    },
    {
      label: 'manager-instance-init',
      url: `${baseUrl}/manager/instance/init`,
      payload: { name: uazapiInstanceName, systemName: 'LogosIA' },
      headers: adminHeaders,
    },
    {
      label: 'evolution-compat-create-path-name',
      url: `${baseUrl}/instance/create/${encodeURIComponent(uazapiInstanceName)}`,
      payload: { qrcode: true, integration: 'WHATSAPP-BAILEYS', groupsIgnore: true },
      headers: adminHeaders,
    },
    {
      label: 'evolution-compat-create-body-instanceName',
      url: `${baseUrl}/instance/create`,
      payload: { instanceName: uazapiInstanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS', groupsIgnore: true },
      headers: adminHeaders,
    },
    {
      label: 'evolution-compat-create-body-name',
      url: `${baseUrl}/instance/create`,
      payload: { name: uazapiInstanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS', groupsIgnore: true },
      headers: adminHeaders,
    },
  ];

  let createStatus = 0;
  let createText = '';
  let createData: any = {};
  let successfulAttempt: string | null = null;
  // 28/05/2026 — guarda resultado de CADA attempt pra diagnostico no front
  const attemptResults: Array<{ label: string; url: string; status: number; body: string }> = [];

  for (const attempt of createAttempts) {
    console.log(`[create-uazapi-instance] Create attempt (${attempt.label}): ${attempt.url}`);
    const createRes = await fetch(attempt.url, {
      method: 'POST',
      headers: attempt.headers,
      body: JSON.stringify(attempt.payload),
    });

    createStatus = createRes.status;
    createText = await createRes.text();
    console.log(`[create-uazapi-instance] ${attempt.label} response (${createStatus}): ${createText.substring(0, 500)}`);

    attemptResults.push({
      label: attempt.label,
      url: attempt.url,
      status: createStatus,
      body: createText.substring(0, 200),
    });

    createData = {};
    try { createData = JSON.parse(createText); } catch {}

    if (createRes.ok || createStatus === 200 || createStatus === 201 || isAlreadyExistsResponse(createStatus, createText)) {
      successfulAttempt = attempt.label;
      break;
    }
  }

  if (!successfulAttempt) {
    const urlHost = baseUrl.replace(/^https?:\/\//, '');
    const allReturned404 = attemptResults.every((r) => r.status === 404);
    const adminProbeOk = adminProbeStatus >= 200 && adminProbeStatus < 300;

    let hint: string;
    if (createStatus === 401 || createStatus === 403) {
      hint = 'admin token da UaZapi invalido ou sem permissao (UAZAPI_ADMIN_TOKEN).';
    } else if (allReturned404 && !adminProbeOk) {
      // Probe + create ambos 404: token errado OU painel sem API admin habilitada
      hint = `painel UaZapi em ${urlHost} nao expoe API admin (probe /instance/all → ${adminProbeStatus}). Token errado ou host so aceita /send/* publico. Crie a instancia direto no painel UaZapi e cole o token aqui.`;
    } else if (allReturned404 && adminProbeOk) {
      // Probe OK mas create 404: caminho de criacao desse painel eh diferente
      hint = `admin token OK (probe respondeu ${adminProbeStatus}), mas nenhum dos caminhos de criacao existe. Possivelmente UazAPI custom — confirmar com docs do painel.`;
    } else if (createStatus >= 500) {
      hint = 'UaZapi indisponivel temporariamente.';
    } else {
      hint = 'verifique secrets do Supabase e logs da edge function.';
    }

    return new Response(JSON.stringify({
      success: false,
      error: `Falha ao criar instancia na UaZapi (HTTP ${createStatus}): ${hint}`,
      status: createStatus,
      url_host: urlHost,
      admin_probe: { status: adminProbeStatus, body: adminProbeBody },
      response_body: createText.substring(0, 500),
      attempted_endpoints: attemptResults,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let qrCode: string | null =
    extractQrCodeCandidate(createData);
  let instanceToken = extractInstanceToken(createData);
  if (!instanceToken && isAlreadyExistsResponse(createStatus, createText)) {
    instanceToken = await findExistingUazapiToken(baseUrl, adminHeaders, uazapiInstanceName);
  }

  if (!qrCode) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const qrAttempts = [
      {
        label: 'get-connect-by-name',
        url: `${baseUrl}/instance/connect/${encodeURIComponent(uazapiInstanceName)}`,
        method: 'GET',
        headers: adminHeaders,
      },
      {
        label: 'post-connect-body-instanceName',
        url: `${baseUrl}/instance/connect`,
        method: 'POST',
        body: { instanceName: uazapiInstanceName },
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
        body: { instanceName: uazapiInstanceName },
        headers: buildInstanceHeaders(instanceToken, api_key),
      }] : []),
      ...(instanceToken ? [{
        label: 'get-connect-instance-token-by-name',
        url: `${baseUrl}/instance/connect/${encodeURIComponent(uazapiInstanceName)}`,
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
  const webhookFunction = await resolveWebhookFunction(supabase, user_id);
  const webhookUrl = `${supabaseUrl}/functions/v1/${webhookFunction}`;
  try {
    let webhookRes = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: buildInstanceHeaders(instanceToken || api_key, api_key),
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        events: ['messages', 'connection'],
        excludeMessages: ['wasSentByApi'],
      }),
    });

    if (!webhookRes.ok) {
      await webhookRes.text().catch(() => '');
      const webhookPayload = buildWebhookPayload(webhookUrl, uazapiInstanceName);
      webhookRes = await fetch(`${baseUrl}/webhook/instance`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          enabled: true,
          url: webhookUrl,
          events: ["messages", "messages_update", "connection", "qrcode"],
          excludeMessages: ["wasSentByApi"],
          instanceName: uazapiInstanceName,
        }),
      });

      if (!webhookRes.ok) {
        await webhookRes.text().catch(() => '');
        webhookRes = await fetch(`${baseUrl}/webhook/set/${uazapiInstanceName}`, {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({
            ...webhookPayload,
          }),
        });
      }
    }

    console.log(`[create-evolution-instance] Webhook response: ${webhookRes.status}`);
    console.log(`[create-evolution-instance] Webhook set for ${uazapiInstanceName}`);
  } catch (webhookErr) {
    console.warn('[create-evolution-instance] Failed to set webhook:', webhookErr);
  }

  const insertPayload = {
    user_id,
    seller_member_id: seller_member_id || null,
    instance_name: uazapiInstanceName,
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
      instance_name: uazapiInstanceName,
      is_active: false,
      phone_number: '',
    }, { onConflict: 'user_id' });
  }

  return new Response(JSON.stringify({
    success: true,
    instance_id: insertedInstance?.id || null,
    instance_name: uazapiInstanceName,
    qr_code: qrCode,
    provider: 'evolution',
    create_attempt: successfulAttempt,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
