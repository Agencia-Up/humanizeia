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
    // Use environment secrets — no user input needed
    const api_url = Deno.env.get('EVOLUTION_API_URL');
    const api_key = Deno.env.get('EVOLUTION_API_KEY');

    if (!api_url || !api_key) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Evolution API não configurada no servidor. Contate o administrador.',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    if (response.status === 401 || response.status === 403) {
      return new Response(JSON.stringify({
        success: false,
        error: 'API Key inválida ou sem permissão.',
        status: response.status,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (response.ok) {
      let instances = [];
      try { instances = JSON.parse(responseText); } catch {}

      return new Response(JSON.stringify({
        success: true,
        connected: true,
        instances_count: Array.isArray(instances) ? instances.length : 0,
        message: 'Evolution API acessível!',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: `Servidor retornou status ${response.status}.`,
      status: response.status,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[test-evolution-connection] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: `Não foi possível alcançar o servidor: ${message}`,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
