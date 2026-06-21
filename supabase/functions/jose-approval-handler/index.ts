import { createClient } from "npm:@supabase/supabase-js@2";
import { executeMetaAction } from "../_shared/jose-v2/metaActions.ts";

/**
 * jose-approval-handler — José v3.1 / Fase 0
 *
 * Fecha o gate SIM/NÃO. Recebe { approval_id, decision }:
 *   • 'aprovado'  -> EXECUTA a ação guardada (payload) na plataforma + loga + marca aprovado
 *   • 'rejeitado' -> só marca rejeitado (não faz nada)
 * Chamado pelo painel (sessão do usuário). A leg do WhatsApp reusa a mesma função.
 * O usuário só mexe nas PRÓPRIAS aprovações (confere user_id).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    const approvalId = body?.approval_id;
    const decision = body?.decision; // 'aprovado' | 'rejeitado'
    if (!approvalId || !["aprovado", "rejeitado"].includes(decision)) {
      return json({ error: "Parâmetros inválidos (approval_id + decision aprovado|rejeitado)" }, 400);
    }

    // Carrega a aprovação e confirma que é do usuário e está pendente.
    const { data: ap } = await admin.from("jose_action_approvals").select("*").eq("id", approvalId).maybeSingle();
    if (!ap || ap.user_id !== user.id) return json({ error: "Aprovação não encontrada" }, 404);
    if (ap.status !== "pendente") return json({ error: `Aprovação já está ${ap.status}`, status: ap.status }, 409);

    // Rejeição: só marca.
    if (decision === "rejeitado") {
      await admin.from("jose_action_approvals").update({
        status: "rejeitado", respondido_em: new Date().toISOString(), canal_resposta: "painel",
      }).eq("id", approvalId);
      return json({ ok: true, status: "rejeitado" });
    }

    // ── Aprovado: executa a ação guardada ──
    const payload = ap.payload || {};
    // Resolve a conta de anúncio (pela ad_account_id da aprovação, senão a meta ativa do user).
    let acctQuery = admin.from("ad_accounts").select("*").eq("user_id", user.id).eq("platform", "meta").eq("is_active", true);
    if (ap.ad_account_id) acctQuery = acctQuery.eq("id", ap.ad_account_id);
    const { data: adAccount } = await acctQuery.limit(1).maybeSingle();

    if (!adAccount?.access_token_encrypted) {
      await admin.from("jose_action_approvals").update({
        status: "aprovado", respondido_em: new Date().toISOString(), canal_resposta: "painel",
        resposta_raw: "aprovado_sem_conta",
      }).eq("id", approvalId);
      return json({ ok: false, error: "Conta Meta não encontrada para executar", status: "aprovado" }, 200);
    }

    const result = await executeMetaAction(adAccount.access_token_encrypted, {
      campaign_id: payload.campaign_id,
      adset_id: payload.adset_id,
      action_type: payload.action_type,
      params: payload.params || {},
    });

    // Loga a ação executada, vinculada à aprovação.
    let logId: string | null = null;
    try {
      const { data: log } = await admin.from("apollo_action_log").insert({
        user_id: user.id,
        campaign_id: payload.campaign_id,
        action_type: payload.action_type,
        params: payload.params || {},
        result,
        executed_by: "guardrail_approved",
        executed_at: new Date().toISOString(),
        approval_id: approvalId,
        risco: ap.risco,
        platform: "meta",
      }).select("id").maybeSingle();
      logId = log?.id || null;
    } catch { /* ignore log error */ }

    await admin.from("jose_action_approvals").update({
      status: "aprovado", respondido_em: new Date().toISOString(),
      canal_resposta: "painel", action_log_id: logId,
    }).eq("id", approvalId);

    return json({ ok: true, status: "aprovado", executed: result });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
