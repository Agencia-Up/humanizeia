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
    const { instance_id, user_id } = await req.json();

    if (!instance_id || !user_id) {
      return new Response(JSON.stringify({ success: false, error: 'instance_id e user_id são obrigatórios' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Fetch instance details
    const { data: inst, error: fetchErr } = await supabase
      .from('wa_instances')
      .select('*')
      .eq('id', instance_id)
      .eq('user_id', user_id)
      .single();

    if (fetchErr || !inst) {
      return new Response(JSON.stringify({ success: false, error: 'Instância não encontrada' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { instance_name, api_url, api_key_encrypted, provider } = inst;
    const key = api_key_encrypted || Deno.env.get('EVOLUTION_API_KEY');
    const baseUrl = api_url?.replace(/\/$/, '') || Deno.env.get('EVOLUTION_API_URL')?.replace(/\/$/, '');

    console.log(`[delete-instance] Deleting ${instance_name} from ${baseUrl} (Provider: ${provider})`);

    // 2. Delete from Evolution/Uazapi
    if (baseUrl && key) {
      try {
        // Uazapi DELETE /instance (with instance token)
        // Evolution API DELETE /instance/delete/{name} (with admintoken)
        
        let delRes = await fetch(`${baseUrl}/instance/delete/${instance_name}`, {
          method: 'DELETE',
          headers: { 
            'apikey': key,
            'Authorization': `Bearer ${key}`
          },
        });

        if (!delRes.ok) {
          // Try Uazapi method: DELETE /instance with instance token
          delRes = await fetch(`${baseUrl}/instance`, {
            method: 'DELETE',
            headers: { 
              'token': key,
              'apikey': key,
              'Content-Type': 'application/json'
            },
          });
        }
        
        console.log(`[delete-instance] API Response status: ${delRes.status}`);
      } catch (apiErr) {
        console.warn('[delete-instance] API error (continuing with DB deletion):', apiErr);
      }
    }

    // 3. Delete from Database
    const { error: dbErr } = await supabase
      .from('wa_instances')
      .delete()
      .eq('id', instance_id);

    if (dbErr) throw dbErr;

    return new Response(JSON.stringify({ success: true, message: 'Instância removida com sucesso' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[delete-instance] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
