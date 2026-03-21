import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const steps: any[] = [];
  const ok = (step: string, data: any) => steps.push({ step, status: "ok", data });
  const fail = (step: string, error: any) => steps.push({ step, status: "error", error: String(error) });

  try {
    // STEP 1: Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) { fail("auth", "Sem Authorization header"); return json({ steps }); }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) { fail("auth", userError?.message || "Usuário não encontrado"); return json({ steps }); }
    ok("auth", { user_id: user.id, email: user.email });

    // STEP 2: Buscar conta Meta no banco
    const { data: acct, error: acctErr } = await admin
      .from("ad_accounts")
      .select("id, account_id, account_name, currency, access_token_encrypted, is_active")
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .eq("is_active", true)
      .order("created_at")
      .limit(1)
      .single();

    if (acctErr || !acct) {
      fail("db_account", acctErr?.message || "Conta não encontrada");
    } else {
      ok("db_account", {
        account_id: acct.account_id,
        account_name: acct.account_name,
        currency: acct.currency,
        has_token: !!acct.access_token_encrypted,
        token_preview: acct.access_token_encrypted?.slice(0, 20) + "...",
      });
    }

    // STEP 3: Ping Meta API
    const token = acct?.access_token_encrypted || Deno.env.get("META_ACCESS_TOKEN");
    const acctId = acct?.account_id || Deno.env.get("META_AD_ACCOUNT_ID")?.replace(/^act_/, "");

    if (!token || !acctId) {
      fail("meta_ping", "Token ou account_id ausente");
    } else {
      try {
        const url = new URL(`${META_GRAPH_URL}/act_${acctId}`);
        url.searchParams.set("access_token", token);
        url.searchParams.set("fields", "id,name,currency,account_status,business_name");
        const r = await fetch(url.toString());
        const d = await r.json();
        if (d.error) fail("meta_ping", `Meta API error ${d.error.code}: ${d.error.message}`);
        else ok("meta_ping", { id: d.id, name: d.name, account_status: d.account_status, currency: d.currency });
      } catch (e) { fail("meta_ping", String(e)); }
    }

    // STEP 4: Buscar campanhas
    if (token && acctId) {
      try {
        const url = new URL(`${META_GRAPH_URL}/act_${acctId}/campaigns`);
        url.searchParams.set("access_token", token);
        url.searchParams.set("fields", "id,name,status,effective_status,objective,daily_budget");
        url.searchParams.set("limit", "10");
        const r = await fetch(url.toString());
        const d = await r.json();
        if (d.error) fail("meta_campaigns", `Meta API error ${d.error.code}: ${d.error.message}`);
        else ok("meta_campaigns", { count: d.data?.length || 0, sample: d.data?.slice(0, 3).map((c: any) => ({ id: c.id, name: c.name, status: c.effective_status })) });
      } catch (e) { fail("meta_campaigns", String(e)); }
    }

    // STEP 5: Testar Anthropic API
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      fail("anthropic", "ANTHROPIC_API_KEY não configurado");
    } else {
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-opus-4-5",
            max_tokens: 10,
            messages: [{ role: "user", content: "diga: ok" }],
          }),
        });
        const d = await r.json();
        if (d.error) fail("anthropic", `Claude error ${d.error.type}: ${d.error.message}`);
        else ok("anthropic", { model: d.model, status: "respondendo" });
      } catch (e) { fail("anthropic", String(e)); }
    }

    // STEP 6: Verificar tabelas do banco
    for (const table of ["apollo_sessions", "apollo_cron_config", "apollo_metric_snapshots", "apollo_action_outcomes", "apollo_action_log"]) {
      const { error: tErr } = await admin.from(table).select("id").limit(1);
      if (tErr) fail(`table_${table}`, tErr.message);
      else ok(`table_${table}`, "exists");
    }

    return json({ steps, summary: steps.filter(s => s.status === "error").length === 0 ? "TUDO OK" : "ERROS ENCONTRADOS" });

  } catch (e: any) {
    fail("unexpected", e?.message || String(e));
    return json({ steps, summary: "ERRO INESPERADO" }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
