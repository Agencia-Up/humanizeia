// ============================================================================
// audit-master-instances
// ----------------------------------------------------------------------------
// Bulk verify de todas as instâncias UAZAPI de uma conta master.
// (Sistema usa UAZAPI — logos-ia.uazapi.com — não Evolution.com)
//
// Para cada instância (provider != 'meta'):
//   1. Tenta GET  ${api_url}/instance/connectionState/${instance_name}
//   2. Se falhar, tenta POST ${api_url}/instance/connect (com token da instância)
//   3. Parse do estado: open/connected/loggedIn → conectada
//   4. UPDATE: is_active = bool, status = real, health_score = 100|0
//
// Auth: JWT do master (ou de vendedor — resolve master_id via ai_team_members).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface InstanceRow {
  id: string;
  instance_name: string;
  friendly_name: string | null;
  api_url: string | null;
  api_key_encrypted: string | null;
  provider: string | null;
  status: string | null;
}

function parseUazapiState(payload: any): { isConnected: boolean; realStatus: string } {
  // Resposta Uazapi V6 (GET /instance/status):
  // {
  //   instance: { status: "connected"|"disconnected"|"qrcode"|..., name, owner, ... },
  //   status:   { connected: true, loggedIn: true, resetting: false, jid }
  // }
  // CUIDADO: payload.status é um OBJETO, não string. Usar instance.status pra
  // pegar o estado textual (caso contrário String(obj) vira "[object Object]").

  // Sinal booleano de conexão (mais confiável)
  const isConnected =
    payload?.status?.connected === true
    || payload?.status?.loggedIn === true
    || payload?.instance?.connected === true
    || payload?.instance?.loggedIn === true;

  // String de estado (apenas pra label — nunca payload.status que é objeto)
  const stateRaw = String(
    payload?.instance?.status
    || payload?.instance?.state
    || payload?.state
    || ''
  ).toLowerCase().trim();

  let realStatus: string;
  if (isConnected) {
    realStatus = stateRaw === 'connecting' ? 'connecting' : 'connected';
  } else if (stateRaw === 'qrcode' || payload?.instance?.qrcode || payload?.qrcode) {
    realStatus = 'waiting_qr';
  } else if (stateRaw === 'close' || stateRaw === 'closed' || stateRaw === 'disconnected') {
    realStatus = 'disconnected';
  } else if (stateRaw) {
    realStatus = stateRaw;
  } else {
    realStatus = 'disconnected';
  }

  return { isConnected, realStatus };
}

async function checkUazapiInstance(baseUrl: string, _instanceName: string, token: string) {
  const headers = { 'Content-Type': 'application/json', token, apikey: token };

  // Endpoint CORRETO da Uazapi V6: GET /instance/status
  // (sem path param — o token no header identifica a instância)
  // Resposta: { instance: { status, name, profileName, owner, ... },
  //             status: { connected, loggedIn, ... } }
  try {
    const res = await fetch(`${baseUrl}/instance/status`, { method: 'GET', headers });
    if (res.ok) {
      const txt = await res.text();
      try {
        const payload = JSON.parse(txt);
        return parseUazapiState(payload);
      } catch {}
    }
  } catch {}

  // Fallback: POST /instance/connect (alguns ambientes retornam estado aqui)
  try {
    const res = await fetch(`${baseUrl}/instance/connect`, {
      method: 'POST', headers, body: JSON.stringify({}),
    });
    const txt = await res.text();
    try {
      const payload = JSON.parse(txt);
      return parseUazapiState(payload);
    } catch {}
  } catch {}

  return { isConnected: false, realStatus: 'error' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseService = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const supabaseAnon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabaseAnon.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve master_id (vendedor → busca via ai_team_members)
    const { data: tmRows } = await supabaseService
      .from('ai_team_members')
      .select('id, user_id')
      .eq('auth_user_id', user.id)
      .limit(1);
    const masterId = (tmRows && tmRows.length > 0) ? tmRows[0].user_id : user.id;
    const sellerMemberIds = (tmRows || []).map((row: any) => row.id).filter(Boolean);

    let instanceQuery = supabaseService
      .from('wa_instances')
      .select('id, instance_name, friendly_name, api_url, api_key_encrypted, provider, status, seller_member_id')
      .eq('user_id', masterId);

    if (sellerMemberIds.length > 0 && masterId !== user.id) {
      // Vendedor logado: só audita as instâncias dele.
      instanceQuery = instanceQuery.in('seller_member_id', sellerMemberIds);
    }

    let { data: instances, error: instErr } = await instanceQuery;
    if (instErr) throw new Error(instErr.message);

    // EXTRA-2: master logado audita instâncias do pool master + dos vendedores
    // ATIVOS. Antes, audit batia em TODAS as instâncias da conta (incluindo
    // de vendedores desativados/removidos) — desperdiçava requests à UazAPI
    // e gerava cascata de erros pra instâncias órfãs.
    if (masterId === user.id && instances && instances.length > 0) {
      const sellerIdsInInstances = Array.from(
        new Set((instances as any[]).map((i) => i.seller_member_id).filter(Boolean))
      );
      if (sellerIdsInInstances.length > 0) {
        const { data: activeSellersRows } = await supabaseService
          .from('ai_team_members')
          .select('id')
          .in('id', sellerIdsInInstances)
          .eq('is_active', true);
        const activeSellerIds = new Set((activeSellersRows || []).map((r: any) => r.id));
        const before = instances.length;
        instances = (instances as any[]).filter((i) =>
          !i.seller_member_id || activeSellerIds.has(i.seller_member_id)
        );
        const skipped = before - instances.length;
        if (skipped > 0) {
          console.log(`[audit-master-instances] Skipped ${skipped} instâncias de vendedores inativos (EXTRA-2 filtro)`);
        }
      }
    }

    const report: Array<{
      id: string;
      friendly_name: string | null;
      previous_status: string | null;
      current_status: string;
      is_active: boolean;
      changed: boolean;
    }> = [];

    for (const inst of (instances || []) as InstanceRow[]) {
      // Meta API (Cloud API): sem verificação direta — preserva estado atual
      if (inst.provider === 'meta') {
        report.push({
          id: inst.id,
          friendly_name: inst.friendly_name,
          previous_status: inst.status,
          current_status: inst.status || 'unknown',
          is_active: true,
          changed: false,
        });
        continue;
      }

      const baseUrl = (inst.api_url || '').replace(/\/$/, '');
      const apiKey = inst.api_key_encrypted || '';
      if (!baseUrl || !apiKey) {
        await supabaseService.from('wa_instances')
          .update({ is_active: false, status: 'no_credentials', health_score: 0 })
          .eq('id', inst.id);
        report.push({
          id: inst.id, friendly_name: inst.friendly_name,
          previous_status: inst.status, current_status: 'no_credentials',
          is_active: false, changed: inst.status !== 'no_credentials',
        });
        continue;
      }

      const { isConnected, realStatus } = await checkUazapiInstance(baseUrl, inst.instance_name, apiKey);

      const updates: Record<string, unknown> = {
        status: realStatus, updated_at: new Date().toISOString(),
      };
      if (isConnected) {
        updates.is_active = true;
        updates.health_score = 100;
      } else if (realStatus !== 'error') {
        updates.is_active = false;
        if (inst.status === 'connected' && realStatus === 'disconnected') {
          updates.health_score = 0;
        }
      }
      await supabaseService.from('wa_instances').update(updates).eq('id', inst.id);

      report.push({
        id: inst.id, friendly_name: inst.friendly_name,
        previous_status: inst.status, current_status: realStatus,
        is_active: isConnected, changed: inst.status !== realStatus,
      });
    }

    const summary = {
      total: report.length,
      connected: report.filter(r => r.is_active).length,
      disconnected: report.filter(r => !r.is_active).length,
      changed: report.filter(r => r.changed).length,
    };

    return new Response(JSON.stringify({ success: true, summary, report }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
