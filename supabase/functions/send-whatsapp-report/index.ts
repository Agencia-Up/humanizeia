import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface RequestBody {
  action: 'test' | 'send_report';
  reportContent?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.error('Missing or invalid authorization header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: claimsData, error: claimsError } = await supabase.auth.getUser();
    if (claimsError || !claimsData?.user) {
      console.error('Auth error:', claimsError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.user.id;
    console.log('WhatsApp report request from user:', userId);

    // Fetch user's WhatsApp config using service role to read api_key
    const supabaseService = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: config, error: configError } = await supabaseService
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (configError) {
      console.error('Error fetching WhatsApp config:', configError);
      return new Response(
        JSON.stringify({ error: 'Erro ao buscar configuração do WhatsApp' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!config || !config.api_url || !config.api_key || !config.instance_name) {
      console.error('WhatsApp config incomplete or missing');
      return new Response(
        JSON.stringify({ error: 'WhatsApp não configurado. Vá em Settings > WhatsApp para configurar.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RequestBody = await req.json();
    const { action, reportContent } = body;

    console.log('Action:', action, 'Instance:', config.instance_name);

    let messageText: string;

    if (action === 'test') {
      messageText = '🤖 *Apollo - Teste de Conexão*\n\n✅ Conexão com WhatsApp via Evolution API configurada com sucesso!\n\nVocê receberá relatórios de performance diretamente aqui.';
    } else if (action === 'send_report' && reportContent) {
      messageText = reportContent;
    } else {
      return new Response(
        JSON.stringify({ error: 'Ação inválida ou conteúdo vazio' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send message via UazAPI
    const evolutionUrl = `${config.api_url.replace(/\/$/, '')}/message/sendText/${config.instance_name}`;
    console.log('Sending to UazAPI:', evolutionUrl);

    const evolutionResponse = await fetch(evolutionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.api_key,
      },
      body: JSON.stringify({
        number: config.phone_number,
        text: messageText,
      }),
    });

    const evolutionData = await evolutionResponse.json();
    console.log('UazAPI response status:', evolutionResponse.status, 'data:', JSON.stringify(evolutionData));

    if (!evolutionResponse.ok) {
      throw new Error(`UazAPI error [${evolutionResponse.status}]: ${JSON.stringify(evolutionData)}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Mensagem enviada com sucesso!' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error in send-whatsapp-report:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
