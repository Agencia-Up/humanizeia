import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { prompt, size = '1024x1024', quality = 'standard' } = await req.json();

    if (!prompt) {
      throw new Error('Prompt é obrigatório.');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

    if (!OPENAI_API_KEY) {
       // Fallback for Pollinations if user didn't register OpenAI Key yet
       const cleanPrompt = encodeURIComponent(String(prompt).replace(/[^\w\s\-,.]/gi, '').substring(0, 180));
       const fallbackUrl = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=1080&height=1080&nologo=true&model=flux`;
       return new Response(JSON.stringify({ url: fallbackUrl }), {
         headers: { ...corsHeaders, 'Content-Type': 'application/json' }
       });
    }

    // Call OpenAI DALL-E 3
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt,
        model: "dall-e-3",
        n: 1,
        // DALL-E 3 allowed sizes: 1024x1024, 1024x1792, 1792x1024
        size: size === 'tall' ? '1024x1792' : size === 'wide' ? '1792x1024' : '1024x1024',
        quality: quality,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DALL-E falhou:', response.status, errorText);
      // Fallback if DALL-E triggered safety or limit bounds
      const cleanPrompt = encodeURIComponent(String(prompt).substring(0, 180));
      const fallbackUrl = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=1080&height=1080&nologo=true&model=flux`;
      return new Response(JSON.stringify({ url: fallbackUrl, warning: 'DALL-E falhou, fallback utilizado', details: errorText }), {
         headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    const imageUrl = data.data[0].url;

    // Convert to base64 to avoid CORS issues in the browser's html2canvas
    const imgResp = await fetch(imageUrl);
    const buffer = await imgResp.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);
    
    // Efficient base64 conversion for deno
    let binary = '';
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    const contentType = imgResp.headers.get('content-type') || 'image/png';
    const base64Url = `data:${contentType};base64,${base64}`;

    return new Response(JSON.stringify({ url: base64Url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Error in davi-image:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
