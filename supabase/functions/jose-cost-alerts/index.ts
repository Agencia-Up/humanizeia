import { createClient } from "npm:@supabase/supabase-js@2";
import { requireInternalCaller, internalAuthDenied } from "../_shared/jose-v2/internalAuth.ts";

/**
 * jose-cost-alerts — José v3.1 / Fase 0 (alvo de pg_cron, 1x/dia).
 *
 * FASE 1 (segurança): a função era PÚBLICA (verify_jwt=false + nenhuma checagem)
 * e a resposta devolvia user_id, gasto_usd e threshold_usd de TODOS os tenants —
 * vazamento financeiro cross-tenant para qualquer anônimo na internet, que ainda
 * conseguia marcar `disparado_em` e queimar os alertas. Agora exige chamador
 * interno.
 *
 * Agrega o custo de IA por tenant (jose_usage_ledger) no período de cada alerta
 * (dia | mes) e, se passou do threshold, marca disparado_em. Re-arma quando entra
 * num novo período (reset_em). Best-effort: nunca lança; só registra.
 *
 * Alerta global (user_id NULL) = soma de TODOS os tenants (visão da revenda).
 * O envio efetivo (WhatsApp/e-mail) reaproveita o canal de aprovação na Fase 4;
 * aqui o foco é DETECTAR e marcar (o painel de Custo mostra os disparados).
 */

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-jose-internal-secret, x-jose-ts, x-jose-nonce" };

function periodStartISO(periodo: string): string {
  const now = new Date();
  if (periodo === "mes") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString(); // 'dia'
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = await requireInternalCaller(req, { admin });
  if (!auth.ok) return internalAuthDenied(auth, corsHeaders);

  const fired: any[] = [];

  try {
    const { data: alerts } = await admin
      .from("jose_cost_alerts")
      .select("id, user_id, periodo, threshold_usd, canal, disparado_em, reset_em");

    for (const a of (alerts || []) as any[]) {
      const startISO = periodStartISO(a.periodo);

      // já disparou DENTRO do período atual? então não redispara.
      if (a.disparado_em && new Date(a.disparado_em).toISOString() >= startISO) continue;

      // soma o custo de IA do período (tenant específico, ou global = todos)
      let q = admin.from("jose_usage_ledger").select("custo_usd").gte("created_at", startISO);
      if (a.user_id) q = q.eq("user_id", a.user_id);
      const { data: ledger } = await q;
      const gasto = ((ledger || []) as any[]).reduce((s, r) => s + Number(r.custo_usd || 0), 0);

      if (gasto >= Number(a.threshold_usd)) {
        await admin.from("jose_cost_alerts")
          .update({ disparado_em: new Date().toISOString() })
          .eq("id", a.id);
        fired.push({ id: a.id, user_id: a.user_id, periodo: a.periodo, gasto_usd: Number(gasto.toFixed(4)), threshold_usd: Number(a.threshold_usd) });
      }
    }

    return new Response(JSON.stringify({ ok: true, checked: (alerts || []).length, fired }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as any)?.message || e), fired }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
