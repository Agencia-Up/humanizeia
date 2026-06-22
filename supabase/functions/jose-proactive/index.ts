import { createClient } from "npm:@supabase/supabase-js@2";
import { sendProactiveSummary } from "../_shared/jose-v2/proactiveSummary.ts";

/**
 * jose-proactive — José v3.1 / Fase 6 (alvo de pg_cron, semanal).
 *
 * Para cada conta com o flag 'otimizacao_proativa' LIGADO, gera e envia o resumo
 * proativo (oportunidades + riscos + sugestão) pro WhatsApp do responsável.
 * Pode receber { user_id } pra rodar só um (teste). Best-effort.
 */

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const results: any[] = [];

  try {
    const body = await req.json().catch(() => ({}));
    let userIds: string[] = [];

    if (body?.user_id) {
      userIds = [String(body.user_id)];
    } else {
      // contas que LIGARAM o recurso (flag tenant habilitado)
      const { data: flags } = await admin.from("jose_feature_flags")
        .select("user_id").eq("feature", "otimizacao_proativa").eq("habilitado", true).not("user_id", "is", null);
      userIds = [...new Set(((flags || []) as any[]).map((f) => f.user_id).filter(Boolean))];
    }

    for (const uid of userIds) {
      const r = await sendProactiveSummary(admin, uid);
      results.push({ user_id: uid, ...r });
    }

    return new Response(JSON.stringify({ ok: true, contas: userIds.length, results }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as any)?.message || e), results }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
