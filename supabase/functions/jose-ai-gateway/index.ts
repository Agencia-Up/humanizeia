import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway, type GatewayCallOpts } from "../_shared/jose-v2/aiGateway.ts";

/**
 * jose-ai-gateway — superfície HTTP do gateway de IA do José (Fase 0).
 *
 * A lógica real vive em _shared/jose-v2/aiGateway.ts (chamada in-process pelas
 * outras edge functions). Esta função expõe o gateway por HTTP p/ teste/uso
 * pontual. O usuário autenticado SÓ pode gastar no PRÓPRIO user_id (o ledger
 * é por tenant) — ignora qualquer user_id vindo no corpo.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const capability = body?.capability;
    if (!["llm", "vision", "stt", "tts"].includes(capability)) {
      return json({ error: "capability inválida (use llm|vision|stt|tts)" }, 400);
    }

    const opts: GatewayCallOpts = {
      user_id: user.id,                       // FORÇA o tenant do chamador
      ad_account_id: body?.ad_account_id ?? null,
      capability,
      input: body?.input ?? {},
      ref_tipo: body?.ref_tipo ?? "http",
      ref_id: body?.ref_id ?? null,
    };

    const result = await callAiGateway(admin, opts);
    return json(result, result.ok ? 200 : 502);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
