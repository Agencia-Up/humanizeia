
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

let lastPayload = "No payload yet";

serve(async (req) => {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  
  if (req.method === 'POST') {
    try {
      lastPayload = await req.text();
      return new Response("Saved", { headers: corsHeaders });
    } catch (e: any) {
      return new Response(e.message, { status: 500, headers: corsHeaders });
    }
  } else {
    return new Response(lastPayload, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
