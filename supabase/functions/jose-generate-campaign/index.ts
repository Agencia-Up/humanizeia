import { createClient } from "npm:@supabase/supabase-js@2";
import { generateCampaignDraft } from "../_shared/jose-v2/campaignDraft.ts";

/**
 * jose-generate-campaign — José v3.1 / Fase 4.
 *
 * Recebe um pedido em linguagem natural e devolve um RASCUNHO de campanha
 * (objetivo, público, criativo, orçamento) + simulação. Grava em
 * jose_generated_campaigns ('rascunho'). NÃO cria na Meta (isso é o gate +
 * CampanhaCreator). Força o tenant do chamador.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    if (!body?.prompt || String(body.prompt).trim().length < 5) return json({ error: "Descreva a campanha que você quer (prompt)." }, 400);

    const result = await generateCampaignDraft(admin, {
      user_id: user.id, ad_account_id: body?.ad_account_id ?? null, prompt: String(body.prompt),
    });
    return json(result, result.ok ? 200 : 502);
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
