import { createClient } from "npm:@supabase/supabase-js@2";
import { sendProactiveSummary } from "../_shared/jose-v2/proactiveSummary.ts";
import { requireInternalCaller, internalAuthDenied } from "../_shared/jose-v2/internalAuth.ts";

/**
 * jose-proactive — José v3.1 / Fase 6 (alvo de pg_cron, semanal).
 *
 * Para cada conta com o flag 'otimizacao_proativa' LIGADO, gera e envia o resumo
 * proativo (oportunidades + riscos + sugestão) pro WhatsApp do responsável.
 *
 * FASE 1 (segurança) — duas falhas fechadas aqui:
 *   1. A função era PÚBLICA (verify_jwt=false e nenhuma checagem no código).
 *      Agora exige chamador interno (service key ou segredo dedicado).
 *   2. `{ user_id }` vinha do BODY e pulava o feature flag. Isso deixava
 *      qualquer anônimo faturar uma chamada de LLM no tenant alvo e disparar
 *      WhatsApp em nome dele. O tenant agora sai SEMPRE do banco; o body só
 *      pode RESTRINGIR o conjunto já elegível, nunca ampliá-lo.
 */

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-jose-internal-secret, x-jose-ts, x-jose-nonce" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = await requireInternalCaller(req, { admin });
  if (!auth.ok) return internalAuthDenied(auth, corsHeaders);

  const results: any[] = [];

  try {
    const body = await req.json().catch(() => ({}));

    // Fonte da verdade: SEMPRE as contas que ligaram o recurso.
    const { data: flags } = await admin.from("jose_feature_flags")
      .select("user_id").eq("feature", "otimizacao_proativa").eq("habilitado", true).not("user_id", "is", null);
    const elegiveis = [...new Set(((flags || []) as any[]).map((f) => f.user_id).filter(Boolean))];

    // O body pode pedir para rodar só UM tenant (útil em teste manual), mas
    // apenas dentro do conjunto elegível — nunca fora dele.
    let userIds = elegiveis;
    if (body?.user_id) {
      const pedido = String(body.user_id);
      if (!elegiveis.includes(pedido)) {
        return new Response(
          JSON.stringify({ ok: false, error: "tenant_nao_elegivel_ou_recurso_desligado" }),
          { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } },
        );
      }
      userIds = [pedido];
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
