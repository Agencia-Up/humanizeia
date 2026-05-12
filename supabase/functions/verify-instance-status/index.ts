const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from token
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { instance_id } = await req.json();

    // Get instance from DB
    const { data: instance, error: dbError } = await supabase
      .from('wa_instances')
      .select('id, instance_name, provider, status, is_active, api_url, api_key_encrypted')
      .eq('id', instance_id)
      .eq('user_id', user.id)
      .single();

    if (dbError || !instance) {
      return new Response(JSON.stringify({ error: 'Instância não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only check UazAPI instances
    if (instance.provider === 'meta') {
      return new Response(JSON.stringify({
        success: true,
        status: instance.status,
        message: 'Meta API não suporta verificação direta de status.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiUrl = Deno.env.get('EVOLUTION_API_URL')?.replace(/\/$/, '');
    const apiKey = Deno.env.get('EVOLUTION_API_KEY');

    if (!apiUrl || !apiKey) {
      return new Response(JSON.stringify({ error: 'Evolution API não configurada' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = (instance.api_url || apiUrl || '').replace(/\/$/, '');
    const instKey = instance.api_key_encrypted || apiKey;
    const globalKey = apiKey;

    // First try: instance/connectionState with global key AND instance key
    const headers = { 
      'Content-Type': 'application/json', 
      'apikey': globalKey,
      'admintoken': globalKey,
      'Authorization': `Bearer ${globalKey}`
    };
    
    let realStatus = 'disconnected';
    let isConnected = false;

    try {
      let stateRes = await fetch(
        `${baseUrl}/instance/connectionState/${instance.instance_name}`,
        { method: 'GET', headers }
      );

      // If connectionState fails, fallback to POST /instance/connect like in get-qrcode (Uazapi feature)
      if (!stateRes.ok || stateRes.status === 404) {
        console.log(`[verify-instance] GET connectionState failed (${stateRes.status}), trying POST /instance/connect`);
        stateRes = await fetch(`${baseUrl}/instance/connect`, {
          method: 'POST',
          headers: {
              'token': instKey,
              'apikey': instKey,
              'admintoken': globalKey,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        });
      }

      const rawText = await stateRes.text();
      console.log(`[verify-instance] ${instance.instance_name} raw response from Uazapi:`, rawText.substring(0, 300));
      
      let stateData: any = {};
      try {
        stateData = JSON.parse(rawText);
      } catch {}

      if (stateRes.ok || stateData.state || stateData.status || stateData.connected) {
        const state = String(
          stateData?.state || 
          stateData?.instance?.state || 
          stateData?.status || 
          stateData?.instance?.status || 
          ''
        ).toLowerCase();
        
        console.log(`[verify-instance] Parsed logic state: ${state}`);

        // Robust connection check (V6 Uazapi)
        isConnected = state === 'open' || 
                    state === 'connected' || 
                    state === 'connecting' || // Do not drop connection immediately while it connects
                    state === 'connected_authenticated' || 
                    stateData?.connected === true || 
                    stateData?.instance?.connected === true || 
                    stateData?.loggedIn === true || 
                    stateData?.instance?.loggedIn === true;

        if (isConnected) {
          realStatus = state === 'connecting' ? 'connecting' : 'connected';
        } else if (state === 'close' || state === 'closed' || state === 'disconnected') {
          realStatus = 'disconnected';
        } else if (state === 'qrcode' || stateData?.base64 || stateData?.qrcode) {
          realStatus = 'waiting_qr';
        } else {
          realStatus = state || 'disconnected';
        }
      } else {
        console.log(`[verify-instance] ${instance.instance_name} check completely failed: ${stateRes.status}`);
        realStatus = 'error';
      }
    } catch (fetchErr) {
      console.error(`[verify-instance] Connection check failed:`, fetchErr);
      realStatus = 'error';
    }

    // Update the DB with the real status
    const updateData: Record<string, unknown> = {
      status: realStatus,
      updated_at: new Date().toISOString(),
    };

    // If connected or connecting, activate and fix health
    if (isConnected) {
      updateData.is_active = true;
      updateData.health_score = 100;
      updateData.shadow_ban_suspect = false;
    } else if (realStatus !== 'error') {
      // If disconnected, deactivate
      updateData.is_active = false;
      
      // If was marked as connected but is actually disconnected, reduce health
      // Do not reduce health if we just transitioned to a known waiting state recently
      if (instance.status === 'connected' && realStatus === 'disconnected') {
        updateData.health_score = 0;
        updateData.shadow_ban_suspect = true;
      }
    }

    await supabase
      .from('wa_instances')
      .update(updateData)
      .eq('id', instance_id);

    const statusChanged = instance.status !== realStatus;

    return new Response(JSON.stringify({
      success: true,
      previous_status: instance.status,
      current_status: realStatus,
      is_connected: isConnected,
      status_changed: statusChanged,
      message: statusChanged
        ? `Status atualizado: ${instance.status} → ${realStatus}`
        : `Status confirmado: ${realStatus}`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[verify-instance-status] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
