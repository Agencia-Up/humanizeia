
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  const url = encodeURIComponent('https://fb.me/9zkKM2Zl7');
  const res = await fetch(`https://api.microlink.io/?url=${url}`);
  const data = await res.json();
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
});
