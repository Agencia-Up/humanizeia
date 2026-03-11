const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  console.log(`[test-evolution-connection] Received ${req.method} request`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { api_url, api_key } = body;

    if (!api_url || !api_key) {
      return new Response(JSON.stringify({ success: false, error: 'api_url e api_key são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const baseUrl = api_url.replace(/\/$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': api_key,
    };

    const fetchUrl = `${baseUrl}/instance/fetchInstances`;
    console.log(`[test-evolution-connection] Health check: ${fetchUrl}`);

    const response = await fetch(fetchUrl, { method: 'GET', headers });
    const responseText = await response.text();

    console.log(`[test-evolution-connection] Status: ${response.status}`);
    console.log(`[test-evolution-connection] Response: ${responseText.substring(0, 300)}`);

    if (response.status === 401 || response.status === 403) {
      return new Response(JSON.stringify({
        success: false,
        error: 'API Key inválida ou sem permissão. Verifique suas credenciais.',
        status: response.status,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (response.ok) {
      let instances = [];
      try { instances = JSON.parse(responseText); } catch { /* ignore */ }

      return new Response(JSON.stringify({
        success: true,
        connected: true,
        instances_count: Array.isArray(instances) ? instances.length : 0,
        message: 'Evolution API acessível e credenciais válidas!',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: `Servidor retornou status ${response.status}. Verifique a URL da Evolution API.`,
      status: response.status,
      details: responseText.substring(0, 300),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('[test-evolution-connection] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: `Não foi possível alcançar o servidor: ${message}`,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
