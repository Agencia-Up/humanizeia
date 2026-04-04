import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req: Request) => {
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

    const { instance_name, api_url, api_key_encrypted } = inst;
    const instanceToken = api_key_encrypted;
    const baseUrl = api_url?.replace(/\/$/, "") || Deno.env.get('EVOLUTION_API_URL')?.replace(/\/$/, "");

    console.log(`[delete-instance V8.2] Deletando instância: ${instance_name} (${instance_id})`);

    // 2. Delete from Uazapi — DELETE /instance com token no header (conforme docs.uazapi.com)
    if (baseUrl && instanceToken) {
      try {
        const delRes = await fetch(`${baseUrl}/instance`, {
          method: 'DELETE',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'token': instanceToken,
          },
        });
        
        const delText = await delRes.text();
        console.log(`[delete-instance] API Response (${delRes.status}): ${delText.substring(0, 300)}`);
        
        if (!delRes.ok) {
           console.warn(`[delete-instance] Falha na API Uazapi (${delRes.status}), continuando remoção do banco.`);
        }
      } catch (apiErr: any) {
        console.warn('[delete-instance] Erro ao chamar API Uazapi:', apiErr.message);
      }
    }

    // 3. Delete from Database - ALWAYS RUN THIS
    console.log(`[delete-instance] Removendo registro do banco: ${instance_id}`);
    const { error: dbErr } = await supabase
      .from('wa_instances')
      .delete()
      .eq('id', instance_id);

    if (dbErr) {
        console.error('[delete-instance] DB Delete Error:', dbErr);
        throw dbErr;
    }

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
