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
    const body = await req.json();
    const { user_id, action, group_ids, groups, list_id } = body;

    if (!user_id) {
      return new Response(JSON.stringify({ success: false, error: 'user_id obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's WhatsApp instance config
    const { data: instance, error: instanceErr } = await supabase
      .from('wa_instances')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    // Fallback to whatsapp_config if no wa_instances
    let apiUrl: string;
    let apiKey: string;
    let instanceName: string;

    if (instance) {
      apiUrl = instance.api_url;
      apiKey = instance.api_key_encrypted;
      instanceName = instance.instance_name;
    } else {
      const { data: config, error: configErr } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('user_id', user_id)
        .eq('is_active', true)
        .maybeSingle();

      if (!config) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Nenhuma instância WhatsApp ativa encontrada',
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      apiUrl = config.api_url;
      apiKey = config.api_key;
      instanceName = config.instance_name;
    }

    const baseUrl = apiUrl.replace(/\/$/, '');

    // ===== ACTION: Extract contacts from selected groups =====
    if (action === 'extract_contacts' && group_ids?.length) {
      const allContacts: { phone: string; name: string | null; group_name: string }[] = [];

      for (const groupId of group_ids) {
        try {
          // Fetch group participants
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
        return new Response(JSON.stringify({
          success: true,
          total_contacts: 0,
          message: 'Nenhum contato encontrado nos grupos selecionados',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Use provided list or create new one
      let targetListId = list_id;

      if (!targetListId) {
        const listName = `Grupos extraídos - ${new Date().toLocaleDateString('pt-BR')}`;
        const { data: list, error: listErr } = await supabase
          .from('wa_contact_lists')
          .insert({
            user_id,
            name: listName,
            source: 'group_extract',
            contact_count: allContacts.length,
          })
          .select('id')
          .single();

        if (listErr) throw listErr;
        targetListId = list.id;
      }

      // Insert contacts (deduplicate by phone)
      const uniquePhones = new Map<string, typeof allContacts[0]>();
      for (const c of allContacts) {
        if (!uniquePhones.has(c.phone)) {
          uniquePhones.set(c.phone, c);
        }
      }

      const contactRows = Array.from(uniquePhones.values()).map(c => ({
        user_id,
        list_id: targetListId,
        phone: c.phone,
        name: c.name,
        group_name: c.group_name,
        source: 'group_extract',
      }));

      // Insert in batches of 500
      for (let i = 0; i < contactRows.length; i += 500) {
        const batch = contactRows.slice(i, i + 500);
        const { error: insertErr } = await supabase.from('wa_contacts').insert(batch);
        if (insertErr) {
          console.error('Insert batch error:', insertErr);
        }
      }

      // Update list count
      await supabase
        .from('wa_contact_lists')
        .update({ contact_count: contactRows.length })
        .eq('id', list.id);

      return new Response(JSON.stringify({
        success: true,
        total_contacts: contactRows.length,
        list_id: list.id,
        list_name: listName,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== DEFAULT: Fetch all groups =====
    console.log(`[wa-extract-groups] Fetching groups for instance: ${instanceName}`);

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

    const groups_result = groupList.map((g: any) => ({
      id: g.id || g.jid,
      subject: g.subject || g.name || 'Sem nome',
      size: g.size || g.participants?.length || 0,
      owner: (g.owner || '').replace(/@.*$/, ''),
      creation: g.creation || 0,
    }));

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
