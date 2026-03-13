import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function getInstanceConfig(supabase: any, userId: string) {
  // First try wa_instances
  const { data: instances } = await supabase
    .from('wa_instances')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'evolution');

  if (instances && instances.length > 0) {
    // For Evolution instances, use env vars for credentials
    const evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL');
    const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');

    // Return all active instances
    return instances.map((inst: any) => {
      if (inst.provider === 'evolution') {
        return {
          id: inst.id,
          apiUrl: evolutionApiUrl || inst.api_url,
          apiKey: evolutionApiKey || inst.api_key_encrypted,
          instanceName: inst.instance_name,
          provider: 'evolution',
        };
      }
      // Meta instances use stored credentials
      return {
        id: inst.id,
        apiUrl: inst.api_url,
        apiKey: inst.api_key_encrypted,
        instanceName: inst.instance_name,
        provider: inst.provider || 'meta',
      };
    });
  }

  // Fallback: whatsapp_config table
  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (!config) return null;

  const evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL');
  const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');

  return [{
    id: null,
    apiUrl: evolutionApiUrl || config.api_url,
    apiKey: evolutionApiKey || config.api_key,
    instanceName: config.instance_name,
    provider: 'evolution',
  }];
}

async function fetchOwnGroups(baseUrl: string, apiKey: string, instanceName: string) {
  const res = await fetch(`${baseUrl}/group/fetchAllGroups/${instanceName}?getParticipants=false`, {
    headers: { 'apikey': apiKey },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[wa-extract-groups] Error (${res.status}) for ${instanceName}:`, errText.substring(0, 300));
    throw new Error(`Evolution API retornou status ${res.status} para instância ${instanceName}`);
  }

  const data = await res.json();
  const groupList = Array.isArray(data) ? data : (data?.groups || []);

  return groupList.map((g: any) => ({
    id: g.id || g.jid,
    subject: g.subject || g.name || 'Sem nome',
    size: g.size || g.participants?.length || 0,
    owner: (g.owner || '').replace(/@.*$/, ''),
    creation: g.creation || 0,
  }));
}

async function searchPublicGroups(baseUrl: string, apiKey: string, instanceName: string, query: string) {
  const res = await fetch(`${baseUrl}/group/findGroupInfos/${instanceName}`, {
    method: 'POST',
    headers: {
      'apikey': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subject: query }),
  });

  if (!res.ok) {
    console.error(`[wa-extract-groups] Search error (${res.status})`);
    const allGroups = await fetchOwnGroups(baseUrl, apiKey, instanceName);
    return allGroups.filter((g: any) =>
      g.subject.toLowerCase().includes(query.toLowerCase())
    );
  }

  const data = await res.json();
  const groupList = Array.isArray(data) ? data : (data?.groups || data?.result || []);

  return groupList.map((g: any) => ({
    id: g.id || g.jid,
    subject: g.subject || g.name || 'Sem nome',
    size: g.size || g.participants?.length || 0,
    owner: (g.owner || '').replace(/@.*$/, ''),
    creation: g.creation || 0,
  }));
}

async function extractContacts(
  configs: any[],
  groupIds: string[],
  groups: any[],
  supabase: any,
  supabaseUrl: string,
  supabaseServiceKey: string,
  userId: string,
  listId?: string,
) {
  const allContacts: { phone: string; name: string | null; group_name: string }[] = [];

  for (const groupId of groupIds) {
    try {
      const groupData = groups?.find((g: any) => g.id === groupId);
      const groupName = groupData?.subject || groupId;

      const orderedConfigs: any[] = [];
      if (groupData?.instance_id) {
        const byId = configs.find((c: any) => c.id === groupData.instance_id);
        if (byId) orderedConfigs.push(byId);
      }
      if (groupData?.instance_name) {
        const byName = configs.find((c: any) => c.instanceName === groupData.instance_name);
        if (byName) orderedConfigs.push(byName);
      }
      orderedConfigs.push(...configs);

      let participants: any[] = [];
      const tried = new Set<string>();

      for (const cfg of orderedConfigs) {
        if (!cfg || cfg.provider !== 'evolution') continue;
        const key = `${cfg.id || ''}:${cfg.instanceName || ''}`;
        if (tried.has(key)) continue;
        tried.add(key);

        const cBaseUrl = (cfg.apiUrl || '').replace(/\/$/, '');
        const url = `${cBaseUrl}/group/participants/${cfg.instanceName}?groupJid=${encodeURIComponent(groupId)}`;

        const res = await fetch(url, {
          headers: { 'apikey': cfg.apiKey },
        });

        if (!res.ok) {
          console.warn(`[wa-extract-groups] Participants ${groupId} failed on ${cfg.instanceName}: ${res.status}`);
          continue;
        }

        const data = await res.json();
        participants = data?.participants || data || [];
        console.log(`[wa-extract-groups] Participants for ${groupId} fetched via ${cfg.instanceName}`);
        break;
      }

      if (!Array.isArray(participants) || participants.length === 0) {
        continue;
      }

      for (const p of participants) {
        const phone = (p.id || p).replace(/@.*$/, '');
        if (phone && phone.length >= 10) {
          allContacts.push({
            phone,
            name: p.name || p.pushName || null,
            group_name: groupName,
          });
        }
      }
    } catch (err) {
      console.error(`Error processing group ${groupId}:`, err);
    }
  }

  if (allContacts.length === 0) {
    return { success: true, total_contacts: 0, message: 'Nenhum contato encontrado nos grupos selecionados' };
  }

  let targetListId = listId;
  if (!targetListId) {
    const listName = `Grupos extraídos - ${new Date().toLocaleDateString('pt-BR')}`;
    const { data: list, error: listErr } = await supabase
      .from('wa_contact_lists')
      .insert({ user_id: userId, name: listName, source: 'group_extract', contact_count: 0 })
      .select('id')
      .single();
    if (listErr) throw listErr;
    targetListId = list.id;
  }

  console.log(`[wa-extract-groups] Sanitizing ${allContacts.length} contacts...`);

  const sanitizeRes = await fetch(`${supabaseUrl}/functions/v1/sanitize-contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({
      user_id: userId,
      list_id: targetListId,
      contacts: allContacts.map(c => ({
        phone: c.phone,
        name: c.name,
        group_name: c.group_name,
        source: 'group_extract',
      })),
      check_whatsapp: true,
    }),
  });

  const sanitizeData = await sanitizeRes.json();
  if (!sanitizeData.success) throw new Error(sanitizeData.error || 'Erro na higienização');

  const stats = sanitizeData.stats || {};
  console.log(`[wa-extract-groups] Sanitization stats:`, stats);

  return {
    success: true,
    total_contacts: stats.total_valid || 0,
    inserted: sanitizeData.inserted_count || 0,
    list_id: targetListId,
    stats,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const { user_id, action, group_ids, groups, list_id, query, instance_id } = body;

    if (!user_id) {
      return new Response(JSON.stringify({ success: false, error: 'user_id obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const configs = await getInstanceConfig(supabase, user_id);
    if (!configs || configs.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Nenhuma instância WhatsApp ativa encontrada. Verifique se seu servidor Evolution API está online.',
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pick specific instance or default to first evolution one
    let config = configs[0];
    if (instance_id) {
      const found = configs.find((c: any) => c.id === instance_id);
      if (found) config = found;
    }
    // Prefer evolution instances for group operations
    const evolutionConfig = configs.find((c: any) => c.provider === 'evolution');
    if (evolutionConfig) config = evolutionConfig;

    const baseUrl = config.apiUrl.replace(/\/$/, '');

    // ===== ACTION: Search public groups by niche =====
    if (action === 'search_groups' && query) {
      console.log(`[wa-extract-groups] Searching groups for: ${query} via ${config.instanceName}`);
      const results = await searchPublicGroups(baseUrl, config.apiKey, config.instanceName, query);
      return new Response(JSON.stringify({
        success: true,
        groups: results,
        total: results.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== ACTION: Extract contacts from selected groups =====
    if (action === 'extract_contacts' && group_ids?.length) {
      const result = await extractContacts(
        configs,
        group_ids,
        groups,
        supabase,
        supabaseUrl,
        supabaseServiceKey,
        user_id,
        list_id,
      );
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== DEFAULT: Fetch own groups from ALL evolution instances =====
    console.log(`[wa-extract-groups] Fetching groups for ${configs.length} instance(s)`);
    const allGroups: any[] = [];

    for (const c of configs) {
      if (c.provider !== 'evolution') {
        console.log(`[wa-extract-groups] Skipping non-evolution instance: ${c.instanceName} (${c.provider})`);
        continue;
      }
      try {
        const cBaseUrl = c.apiUrl.replace(/\/$/, '');
        console.log(`[wa-extract-groups] Fetching groups from ${c.instanceName} at ${cBaseUrl}`);
        const instanceGroups = await fetchOwnGroups(cBaseUrl, c.apiKey, c.instanceName);
        console.log(`[wa-extract-groups] ${c.instanceName}: ${instanceGroups.length} groups found`);
        for (const g of instanceGroups) {
          g.instance_name = c.instanceName;
          g.instance_id = c.id;
        }
        allGroups.push(...instanceGroups);
      } catch (err) {
        console.error(`[wa-extract-groups] Failed for instance ${c.instanceName}:`, err);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      groups: allGroups,
      total: allGroups.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[wa-extract-groups] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
