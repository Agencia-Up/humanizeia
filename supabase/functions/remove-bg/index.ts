import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const REMOVE_BG_API_KEY = Deno.env.get('REMOVE_BG_API_KEY');
    if (!REMOVE_BG_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'REMOVE_BG_API_KEY não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const formData = await req.formData();
    const imageFile = formData.get('image_file') as File | null;
    const imageUrl = formData.get('image_url') as string | null;

    if (!imageFile && !imageUrl) {
      return new Response(
        JSON.stringify({ error: 'Envie uma imagem (image_file) ou URL (image_url)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build request to remove.bg
    const removeBgForm = new FormData();
    removeBgForm.append('size', 'auto');

    if (imageFile) {
      removeBgForm.append('image_file', imageFile);
    } else if (imageUrl) {
      removeBgForm.append('image_url', imageUrl);
    }

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': REMOVE_BG_API_KEY,
      },
      body: removeBgForm,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('remove.bg error:', response.status, errorText);
      
      let errorMessage = 'Erro ao remover fundo';
      if (response.status === 402) {
        errorMessage = 'Créditos do remove.bg esgotados. Verifique seu plano.';
      } else if (response.status === 429) {
        errorMessage = 'Limite de requisições atingido. Aguarde um momento.';
      }

      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resultBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(resultBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      for (let j = 0; j < chunk.length; j++) {
        binary += String.fromCharCode(chunk[j]);
      }
    }
    const base64 = btoa(binary);

    return new Response(
      JSON.stringify({
        image: `data:image/png;base64,${base64}`,
        credits_charged: response.headers.get('X-Credits-Charged') || '1',
        image_width: response.headers.get('X-Width'),
        image_height: response.headers.get('X-Height'),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('remove-bg function error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
