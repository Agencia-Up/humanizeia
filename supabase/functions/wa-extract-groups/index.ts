import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function getInstanceConfig(supabase: any, userId: string) {
  const { data: instance } = await supabase
    .from('wa_instances')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (instance) {
    return {
      apiUrl: instance.api_url,
      apiKey: instance.api_key_encrypted,
      instanceName: instance.instance_name,
    };
  }

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (!config) return null;

  return {
    apiUrl: config.api_url,
    apiKey: config.api_key,
    instanceName: config.instance_name,
  };
}

async function fetchOwnGroups(baseUrl: string, apiKey: string, instanceName: string) {
  const res = await fetch(`${baseUrl}/group/fetchAllGroups/${instanceName}`, {
    headers: { 'apikey': apiKey },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[wa-extract-groups] Error (${res.status}):`, errText.substring(0, 300));
    throw new Error(`Evolution API retornou status ${res.status}`);
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
  // Try the Evolution API group search endpoint
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
    // Fallback: fetch all groups and filter by query
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
  baseUrl: string,
  apiKey: string,
  instanceName: string,
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
      const res = await fetch(`${baseUrl}/group/participants/${instanceName}?groupJid=${groupId}`, {
        headers: { 'apikey': apiKey },
      });

      if (!res.ok) {
        console.error(`Failed to fetch participants for ${groupId}: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const participants = data?.participants || data || [];
      const groupData = groups?.find((g: any) => g.id === groupId);
      const groupName = groupData?.subject || groupId;

      for (const p of (Array.isArray(participants) ? participants : [])) {
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
    const { user_id, action, group_ids, groups, list_id, query } = body;

    if (!user_id) {
      return new Response(JSON.stringify({ success: false, error: 'user_id obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const config = await getInstanceConfig(supabase, user_id);
    if (!config) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Nenhuma instância WhatsApp ativa encontrada',
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = config.apiUrl.replace(/\/$/, '');

    // ===== ACTION: Search public groups by niche =====
    if (action === 'search_groups' && query) {
      console.log(`[wa-extract-groups] Searching groups for: ${query}`);
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
        baseUrl, config.apiKey, config.instanceName,
        group_ids, groups, supabase,
        supabaseUrl, supabaseServiceKey, user_id, list_id
      );
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== DEFAULT: Fetch own groups =====
    console.log(`[wa-extract-groups] Fetching groups for instance: ${config.instanceName}`);
    const groups_result = await fetchOwnGroups(baseUrl, config.apiKey, config.instanceName);

    return new Response(JSON.stringify({
      success: true,
      groups: groups_result,
      total: groups_result.length,
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
