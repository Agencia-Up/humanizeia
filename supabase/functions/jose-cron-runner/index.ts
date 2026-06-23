import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * apollo-cron-runner
 *
 * Called by pg_cron every minute.
 * Finds users with is_enabled=true and next_run_at <= NOW(), then triggers apollo-agent for each.
 * Also triggers apollo-measure-outcomes daily at 06:00 UTC.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Security: só permite chamadas service-role (pg_cron / interno). Resiliente a
  // rotação/troca de FORMATO da chave: aceita o match direto da env key OU um JWT
  // legado role=service_role deste projeto (é o que o pg_cron manda). Antes só fazia
  // o match exato -> quando a service_role key mudou de formato, dava 403 e o
  // relatório automático nunca rodava.
  const authHeader = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  let authOk = !!serviceKey && authHeader.includes(serviceKey);
  if (!authOk) {
    try {
      const payload = JSON.parse(atob((authHeader.replace(/^Bearer\s+/i, "").split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")));
      const ref = (Deno.env.get("SUPABASE_URL") || "").match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1];
      authOk = payload.role === "service_role" && (!ref || payload.ref === ref) && (!payload.exp || payload.exp * 1000 > Date.now());
    } catch { /* authOk segue false */ }
  }
  if (!authOk) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey
  );

  const now = new Date().toISOString();
  const functionsUrl = Deno.env.get("SUPABASE_URL")!.replace(".supabase.co", ".supabase.co/functions/v1");

  // ── Find users due for analysis ──
  // NÃO usa ad_accounts!inner: a config tem account_id null em muitas contas e o
  // INNER JOIN excluía quem não tinha o link (mesmo com conta Meta ativa) -> o
  // relatório nunca rodava. A conta é resolvida por user_id no loop (pula se não tiver).
  const { data: dueUsers } = await admin
    .from("apollo_cron_config")
    .select("*")
    .eq("is_enabled", true)
    .lte("next_run_at", now)
    .limit(20);

  const results: any[] = [];

  for (const config of (dueUsers || [])) {
    try {
      // ── RESERVA O SLOT PRIMEIRO (anti-duplicação) ──────────────────────────
      // O runner roda a cada minuto. O apollo-agent abaixo DEMORA (análise leva
      // minutos). Se a gente só atualizasse next_run_at DEPOIS, os ticks seguintes
      // do cron re-pegariam o mesmo usuário (next_run_at ainda no passado) e o
      // relatório sairia VÁRIAS vezes. Avançando o next_run_at pra amanhã ANTES da
      // chamada, os próximos ticks não re-pegam. Só claim quem ainda não foi
      // reservado neste minuto (guard contra corrida).
      const nextRun = computeNextRun(config.run_hour, config.run_minute, config.timezone);
      const { data: claimed } = await admin.from("apollo_cron_config").update({
        last_run_at: now,
        next_run_at: nextRun,
        updated_at: now,
      }).eq("user_id", config.user_id).lte("next_run_at", now).select("user_id");
      if (!claimed || claimed.length === 0) continue; // outro tick já reservou

      // Get a valid access token for this user's account
      const { data: account } = await admin
        .from("ad_accounts")
        .select("account_id, access_token_encrypted")
        .eq("user_id", config.user_id)
        .eq("platform", "meta")
        .eq("is_active", true)
        .single();

      if (!account?.access_token_encrypted) continue;

      // Create a service-role signed JWT for this call
      // We call apollo-agent with the service role but pass user_id in the body
      const response = await fetch(`${functionsUrl}/apollo-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "x-apollo-cron": "true",
          "x-user-id": config.user_id,
        },
        body: JSON.stringify({
          targetAccountId: account.account_id,
          auto_execute: config.auto_execute,
          datePreset: config.date_preset || "last_7d",
          _cron_user_id: config.user_id, // passed for service-role bypass
        }),
      });

      const data = await response.json().catch(() => ({}));
      // (next_run_at já foi reservado no topo do loop — anti-duplicação)

      results.push({
        user_id: config.user_id,
        status: "ok",
        health_score: data.health_score,
        actions: data.actions?.length || 0,
      });
    } catch (err: any) {
      console.error("[apollo-cron-runner] user error:", config.user_id, err.message);
      results.push({ user_id: config.user_id, status: "error", error: err.message });
    }
  }

  // ── Daily outcome measurement (run at 06:xx UTC) ──
  const utcHour = new Date().getUTCHours();
  if (utcHour === 6) {
    fetch(`${functionsUrl}/apollo-measure-outcomes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  return new Response(JSON.stringify({
    ran_at: now,
    users_processed: results.length,
    results,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

// Offset do fuso vs UTC, em minutos (ex.: America/Sao_Paulo = -180). Fallback BRT.
function tzOffsetMinutes(timeZone: string): number {
  try {
    const now = new Date();
    const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const local = new Date(now.toLocaleString("en-US", { timeZone }));
    return Math.round((local.getTime() - utc.getTime()) / 60000);
  } catch (_e) { return -180; }
}

function computeNextRun(hour: number, minute: number, timezone: string): string {
  // hour:minute são no FUSO do cliente (default America/Sao_Paulo) — NÃO em UTC.
  // Converte a hora local de parede pra UTC (UTC = local - offset).
  const tz = timezone || "America/Sao_Paulo";
  const offsetMin = tzOffsetMinutes(tz); // ex.: -180 p/ BRT
  const now = new Date();
  const next = new Date();
  next.setUTCHours(hour, minute, 0, 0);
  next.setUTCMinutes(next.getUTCMinutes() - offsetMin);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
