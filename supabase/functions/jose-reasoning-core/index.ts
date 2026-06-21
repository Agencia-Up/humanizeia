import { createClient } from "npm:@supabase/supabase-js@2";
import { computeCampaignVerdict } from "../_shared/jose-v2/reasoningCore.ts";

/**
 * jose-reasoning-core — José v3.1 / Fase 1 (Núcleo de Julgamento).
 *
 * Recebe (ad_account_id, campaign_id, nivel1) do usuário autenticado e devolve o
 * VEREDITO da campanha pela hierarquia de verdade (venda > lead qualificado >
 * vitrine) + justificativa. Grava em jose_campaign_verdict. Força o tenant do
 * chamador (o veredito é do PRÓPRIO usuário).
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({}));
    if (!body?.campaign_id) return json({ error: "campaign_id obrigatório" }, 400);

    const result = await computeCampaignVerdict(admin, {
      user_id: user.id,                      // FORÇA o tenant do chamador
      ad_account_id: body?.ad_account_id ?? null,
      campaign_id: String(body.campaign_id),
      nivel1: body?.nivel1 ?? {},
      period_days: body?.period_days,
    });
    return json(result, result.ok ? 200 : 502);
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
