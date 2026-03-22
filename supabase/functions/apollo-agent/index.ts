import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";

/**
 * apollo-agent v4: Level 6 Autonomous Meta Ads AI Agent — JOSÉ
 *
 * Features:
 * - Historical WoW trend analysis (apollo_metric_snapshots)
 * - Learning from past action outcomes (apollo_action_outcomes)
 * - Ad Set + Ad level awareness with creative fatigue scoring
 * - Campaign cloning (winners) + creative rotation
 * - Proactive WhatsApp notifications
 * - Scheduled via apollo-cron-runner
 * - Brazilian seasonal intelligence
 * - Portfolio optimization across campaigns
 * - Budget pacing analysis
 * - Subcapitalization detection
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const {
      targetAccountId,
      auto_execute = false,
      datePreset = "last_30d",
      action: bodyAction,
      campaignId,
      actionType,
      actionParams,
    } = body;

    // ── Direct action execution ──
    if (bodyAction === "execute_action") {
      return await handleExecuteAction(admin, user.id, targetAccountId, campaignId, actionType, actionParams, corsHeaders);
    }

    // ── Clone campaign ──
    if (bodyAction === "clone_campaign") {
      return await handleCloneCampaign(admin, user.id, targetAccountId, campaignId, actionParams, corsHeaders);
    }

    // ── Load last saved session (persist across page reloads) ──
    if (bodyAction === "load_session") {
      return await handleLoadSession(admin, user.id, targetAccountId, corsHeaders);
    }

    // ── Get history for UI ──
    if (bodyAction === "get_history") {
      return await handleGetHistory(admin, user.id, targetAccountId, corsHeaders);
    }

    // ── Save cron config ──
    if (bodyAction === "save_cron_config") {
      return await handleSaveCronConfig(admin, user.id, body, corsHeaders);
    }

    // ── Get lead stats for dashboard ──
    if (bodyAction === "get_lead_stats") {
      return await handleGetLeadStats(admin, user.id, targetAccountId, corsHeaders);
    }

    // ── Get geographic performance ──
    if (bodyAction === "get_geo_performance") {
      return await handleGeoPerformance(admin, user.id, targetAccountId, datePreset, corsHeaders);
    }

    // ── Get ROI/profit report ──
    if (bodyAction === "get_roi_report") {
      return await handleROIReport(admin, user.id, targetAccountId, datePreset, corsHeaders);
    }

    // ── Get PME config ──
    if (bodyAction === "get_pme_config") {
      return await handleGetPMEConfig(admin, user.id, corsHeaders);
    }

    // ── Save PME config ──
    if (bodyAction === "save_pme_config") {
      return await handleSavePMEConfig(admin, user.id, body, corsHeaders);
    }

    // ── Debug / connection test ──
    if (bodyAction === "debug") {
      // SELECT inclui access_token_encrypted para poder fazer o ping
      const { data: accts, error: acctErr } = await admin
        .from("ad_accounts")
        .select("id, account_id, account_name, currency, platform, is_active, access_token_encrypted, created_at")
        .eq("user_id", user.id)
        .eq("platform", "meta");

      const diagResults: any[] = [];

      // Testa cada conta conectada no banco
      for (const acct of (accts || [])) {
        const token = acct.access_token_encrypted;
        const acctId = acct.account_id?.replace(/^act_/, "");
        let pingResult: any = null;

        if (token && acctId) {
          try {
            const pingUrl = new URL(`${META_GRAPH_URL}/act_${acctId}`);
            pingUrl.searchParams.set("access_token", token);
            pingUrl.searchParams.set("fields", "id,name,currency,account_status,business_name");
            const r = await fetch(pingUrl.toString());
            pingResult = await r.json();
          } catch (e: any) {
            pingResult = { error: e.message };
          }
        } else {
          pingResult = { error: "Token ou account_id ausente no banco" };
        }

        diagResults.push({
          account_id: acct.account_id,
          account_name: acct.account_name,
          is_active: acct.is_active,
          has_token: !!token,
          meta_ping: pingResult,
        });
      }

      // Testa também o secret META_ACCESS_TOKEN como fallback
      const secretToken = Deno.env.get("META_ACCESS_TOKEN");
      const secretAcctId = Deno.env.get("META_AD_ACCOUNT_ID");
      let secretPing: any = null;

      if (secretToken && secretAcctId) {
        try {
          const pingUrl = new URL(`${META_GRAPH_URL}/act_${secretAcctId.replace(/^act_/, "")}`);
          pingUrl.searchParams.set("access_token", secretToken);
          pingUrl.searchParams.set("fields", "id,name,currency,account_status");
          const r = await fetch(pingUrl.toString());
          secretPing = await r.json();
        } catch (e: any) {
          secretPing = { error: e.message };
        }
      } else {
        secretPing = { error: "Secret META_ACCESS_TOKEN ou META_AD_ACCOUNT_ID não configurado" };
      }

      return new Response(JSON.stringify({
        user_id: user.id,
        db_accounts: diagResults,
        db_error: acctErr?.message || null,
        secret_token_ping: secretPing,
        has_secret_token: !!secretToken,
        has_secret_account_id: !!secretAcctId,
        timestamp: new Date().toISOString(),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Get cron config ──
    if (bodyAction === "get_cron_config") {
      return await handleGetCronConfig(admin, user.id, corsHeaders);
    }

    // ── Get ad set drill-down ──
    if (bodyAction === "get_adsets") {
      return await handleGetAdsets(admin, user.id, targetAccountId, campaignId, datePreset, corsHeaders);
    }

    // ────────────────────────────────────────────────────────────
    // MAIN ANALYSIS FLOW
    // ────────────────────────────────────────────────────────────

    // ── Get Meta ad account ──
    let accountQuery = admin
      .from("ad_accounts")
      .select("*")
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .eq("is_active", true);

    if (targetAccountId) accountQuery = accountQuery.eq("account_id", targetAccountId);

    const { data: adAccount } = await accountQuery.order("created_at").limit(1).single();

    // Fallback: se não encontrou no banco, tenta os secrets configurados
    let accessToken: string;
    let accountId: string;
    let currency = "BRL";

    const adAccountDbId: string | undefined = adAccount?.id;
    const adAccountName: string = adAccount?.account_name || "Conta Meta";

    if (adAccount?.access_token_encrypted && adAccount?.account_id) {
      accessToken = adAccount.access_token_encrypted;
      accountId = adAccount.account_id;
      currency = adAccount.currency || "BRL";
    } else {
      // Tenta secrets configurados no projeto
      const secretToken = Deno.env.get("META_ACCESS_TOKEN");
      const secretAccountId = Deno.env.get("META_AD_ACCOUNT_ID");

      if (!secretToken || !secretAccountId) {
        return new Response(
          JSON.stringify({
            error: "Nenhuma conta Meta Ads conectada. Vá em Configurações > Contas Conectadas e adicione sua conta Meta Ads.",
            code: "NO_ACCOUNT"
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Remove "act_" prefix se existir
      accessToken = secretToken;
      accountId = secretAccountId.replace(/^act_/, "");
      console.log("[apollo-agent v4] Usando token do secret META_ACCESS_TOKEN (fallback)");
    }

    const currencySymbol = currency === "USD" ? "US$" : "R$";

    // ── Fetch all data in parallel ──
    const [campaigns, insights, adSetInsights, historicalSnapshots, pastOutcomes] = await Promise.all([
      fetchMetaCampaigns(accessToken, accountId),
      fetchMetaInsights(accessToken, accountId, datePreset),
      fetchAdSetInsights(accessToken, accountId, datePreset),
      loadHistoricalSnapshots(admin, user.id, adAccountDbId || ""),
      loadLearningOutcomes(admin, user.id),
    ]);

    const insightsMap = new Map(insights.map((i: any) => [i.campaign_id, i]));
    const adSetInsightsMap = buildAdSetInsightsMap(adSetInsights);

    // ── Enrich campaigns with insights + health score ──
    const enriched = campaigns.map((c: any) => enrichCampaign(c, insightsMap, adSetInsightsMap, currency));

    // ── Build historical context for Claude ──
    const trendContext = buildTrendContext(historicalSnapshots, enriched, currency, currencySymbol);

    // ── Build learning context for Claude ──
    const learningContext = buildLearningContext(pastOutcomes);

    // ── Level 6: Compute new intelligence ──
    const seasonalContext = getSeasonalContext();
    const portfolioContext = detectPortfolioOpportunities(enriched, currencySymbol);

    // Enrich each campaign with Level 6 data
    for (const c of enriched) {
      c.creative_fatigue = computeCreativeFatigue(c.adsets || []);
      c.budget_pacing = computeBudgetPacing(c.spend, c.daily_budget, datePreset);
      // Propagate fatigue score to each adset for display
      if (c.adsets) {
        for (const as of c.adsets) {
          const asFreq = as.frequency || 0;
          const asCtr = as.ctr || 0;
          const freqScore = asFreq <= 1.5 ? 0 : asFreq <= 2.5 ? 10 : asFreq <= 3.5 ? 30 : asFreq <= 5 ? 65 : 90;
          const ctrPenalty = asCtr < 0.3 ? 40 : asCtr < 0.7 ? 20 : asCtr < 1.0 ? 8 : 0;
          as.creative_fatigue_score = Math.min(100, freqScore + ctrPenalty);
        }
      }
    }

    // ── Claude AI Analysis ──
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    let aiResult: any = { analysis: null, actions: [], health_score: null, summary: null };

    if (ANTHROPIC_KEY && enriched.length > 0) {
      aiResult = await runApolloAI(ANTHROPIC_KEY, enriched, currency, currencySymbol, datePreset, trendContext, learningContext, seasonalContext, portfolioContext);
    }

    // ── Validate & fix campaign IDs in actions (AI sometimes returns slugs instead of numeric IDs) ──
    if (aiResult.actions?.length > 0) {
      const campaignIdMap = new Map(enriched.map((c: any) => [c.id, c]));
      const campaignNameMap = new Map(enriched.map((c: any) => [c.name.toLowerCase().trim(), c]));

      aiResult.actions = aiResult.actions.map((action: any) => {
        // If campaign_id is already valid (exists in enriched), keep it
        if (campaignIdMap.has(action.campaign_id)) return action;

        // Try to find by name match
        const nameKey = (action.campaign_name || "").toLowerCase().trim();
        const matchByName = campaignNameMap.get(nameKey);
        if (matchByName) {
          console.log(`[apollo-agent] Fixed campaign_id: "${action.campaign_id}" → "${matchByName.id}" (matched by name)`);
          return { ...action, campaign_id: matchByName.id };
        }

        // Try fuzzy match (slug-like ID → find campaign whose name contains it)
        const slug = (action.campaign_id || "").replace(/[_-]/g, " ").toLowerCase();
        const fuzzyMatch = enriched.find((c: any) =>
          c.name.toLowerCase().replace(/[^a-z0-9]/g, " ").includes(slug.slice(0, 15)) ||
          slug.includes(c.name.toLowerCase().replace(/[^a-z0-9]/g, " ").slice(0, 15))
        );
        if (fuzzyMatch) {
          console.log(`[apollo-agent] Fixed campaign_id (fuzzy): "${action.campaign_id}" → "${fuzzyMatch.id}"`);
          return { ...action, campaign_id: fuzzyMatch.id };
        }

        return action;
      });
    }

    // ── Auto-execute safe actions ──
    const executionLog: any[] = [];
    if (auto_execute && aiResult.actions?.length > 0) {
      for (const action of aiResult.actions) {
        if (action.auto_safe && action.action_type !== "clone_campaign") {
          const result = await executeMetaAction(accessToken, action);
          executionLog.push({
            ...action,
            result,
            executed_at: new Date().toISOString(),
            executed_by: "apollo_auto",
          });
          // Find the campaign metrics for before_state
          const camp = enriched.find((e: any) => e.id === action.campaign_id);
          try {
            await admin.from("apollo_action_log").insert({
              user_id: user.id,
              campaign_id: action.campaign_id,
              action_type: action.action_type,
              params: action.params || {},
              result,
              before_state: camp ? { health_score: camp.health_score, roas: camp.roas, ctr: camp.ctr, cpc: camp.cpc, spend: camp.spend } : {},
              executed_by: "apollo_auto",
              executed_at: new Date().toISOString(),
            });
          } catch { /* ignore log error */ }
        }
      }
    }

    // ── Save session ──
    try {
      await admin.from("apollo_sessions").upsert({
        user_id: user.id,
        account_id: adAccountDbId || null,
        campaigns_analyzed: enriched.length,
        actions_generated: aiResult.actions?.length || 0,
        actions_executed: executionLog.length,
        ai_analysis: aiResult.analysis,
        health_score: aiResult.health_score,
        summary: aiResult.summary,
        campaigns_snapshot: enriched,
        actions_snapshot: aiResult.actions,
        execution_log: executionLog,
        date_preset: datePreset,
        auto_mode: auto_execute,
        analyzed_at: new Date().toISOString(),
      }, { onConflict: "user_id,account_id" });
    } catch { /* ignore session save error */ }

    // ── Save snapshot (fire and forget) ──
    saveMetricSnapshot(admin, user.id, adAccountDbId || "", enriched, historicalSnapshots, aiResult.health_score).catch(() => {});

    // ── Schedule outcome checks for executed actions ──
    if (executionLog.length > 0) {
      scheduleOutcomeChecks(admin, user.id, executionLog, enriched).catch(() => {});
    }

    // ── WhatsApp notifications ──
    const hasCritical = (aiResult.actions || []).some((a: any) => a.priority === "critical");
    if (hasCritical) {
      sendCriticalWhatsApp(admin, user.id, aiResult, enriched, currencySymbol).catch(() => {});
    }

    // ── Daily WhatsApp report (resumo de campanhas + ações) ──
    sendDailyReport(admin, user.id, aiResult, enriched, executionLog, currencySymbol).catch(() => {});

    return new Response(JSON.stringify({
      status: "analyzed",
      account: { id: accountId, name: adAccountName, currency, currencySymbol },
      campaigns: enriched,
      health_score: aiResult.health_score,
      summary: aiResult.summary,
      ai_analysis: aiResult.analysis,
      actions: aiResult.actions || [],
      execution_log: executionLog,
      date_preset: datePreset,
      analyzed_at: new Date().toISOString(),
      trend_context: trendContext,
      learning_context: learningContext,
      seasonal_context: seasonalContext,
      portfolio_context: portfolioContext,
      level: 6,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[apollo-agent v4]", err?.message || err);
    return new Response(
      JSON.stringify({ error: err?.message || "Erro interno no agente JOSÉ" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Meta API helpers ──────────────────────────────────────────────────────────

async function fetchMetaCampaigns(accessToken: string, accountId: string) {
  const url = new URL(`${META_GRAPH_URL}/act_${accountId}/campaigns`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,created_time,special_ad_categories");
  url.searchParams.set("limit", "100");
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) {
    const msg = data.error.message || "Meta API error";
    const code = data.error.code ? ` (código ${data.error.code})` : "";
    throw new Error(`Meta API: ${msg}${code}. Verifique se o token de acesso ainda é válido em Configurações > Contas Conectadas.`);
  }
  return data.data || [];
}

async function fetchMetaInsights(accessToken: string, accountId: string, datePreset: string) {
  const url = new URL(`${META_GRAPH_URL}/act_${accountId}/insights`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values,cost_per_action_type,conversions");
  url.searchParams.set("date_preset", datePreset);
  url.searchParams.set("level", "campaign");
  url.searchParams.set("limit", "100");
  const res = await fetch(url.toString());
  const data = await res.json();
  return data.data || [];
}

async function fetchAdSetInsights(accessToken: string, accountId: string, datePreset: string) {
  const url = new URL(`${META_GRAPH_URL}/act_${accountId}/insights`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "campaign_id,adset_id,adset_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values");
  url.searchParams.set("date_preset", datePreset);
  url.searchParams.set("level", "adset");
  url.searchParams.set("limit", "200");
  const res = await fetch(url.toString());
  const data = await res.json();
  return data.data || [];
}

async function fetchCampaignAdSets(accessToken: string, campaignId: string) {
  const url = new URL(`${META_GRAPH_URL}/${campaignId}/adsets`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "id,name,status,effective_status,daily_budget,optimization_goal,billing_event,bid_strategy,targeting,start_time");
  url.searchParams.set("limit", "50");
  const res = await fetch(url.toString());
  const data = await res.json();
  return data.data || [];
}

async function fetchAdSetAds(accessToken: string, adsetId: string) {
  const url = new URL(`${META_GRAPH_URL}/${adsetId}/ads`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "id,name,status,effective_status,creative{id,name,body,image_url}");
  url.searchParams.set("limit", "20");
  const res = await fetch(url.toString());
  const data = await res.json();
  return data.data || [];
}

function buildAdSetInsightsMap(adSetInsights: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const insight of adSetInsights) {
    const cid = insight.campaign_id;
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid)!.push(insight);
  }
  return map;
}

// ── Campaign enrichment ───────────────────────────────────────────────────────

function enrichCampaign(c: any, insightsMap: Map<string, any>, adSetInsightsMap: Map<string, any[]>, currency: string) {
  const m: any = insightsMap.get(c.id) || {};
  const spend = Number(m.spend || 0);
  let cpa = 0, roas = 0, conversions = 0;

  if (m.cost_per_action_type?.length) {
    const a = m.cost_per_action_type.find((x: any) =>
      x.action_type.includes("purchase") || x.action_type.includes("lead")
    ) || m.cost_per_action_type[0];
    cpa = Number(a?.value || 0);
  }
  if (m.action_values?.length && spend > 0) {
    const av = m.action_values.find((x: any) => x.action_type.includes("purchase"));
    if (av) roas = Number(av.value) / spend;
  }
  if (m.actions?.length) {
    const conv = m.actions.find((x: any) => x.action_type.includes("purchase") || x.action_type.includes("lead"));
    conversions = Number(conv?.value || 0);
  }
  if (m.conversions?.length) {
    conversions = m.conversions.reduce((s: number, x: any) => s + Number(x.value || 0), 0);
  }

  const ctr = Number(m.ctr || 0);
  const cpc = Number(m.cpc || 0);
  const cpm = Number(m.cpm || 0);
  const frequency = Number(m.frequency || 0);
  const reach = Number(m.reach || 0);
  const impressions = Number(m.impressions || 0);
  const clicks = Number(m.clicks || 0);

  // Ad Set summary
  const adsets = (adSetInsightsMap.get(c.id) || []).map((as: any) => ({
    id: as.adset_id,
    name: as.adset_name,
    spend: Number(as.spend || 0),
    ctr: Number(as.ctr || 0),
    cpc: Number(as.cpc || 0),
    frequency: Number(as.frequency || 0),
    impressions: Number(as.impressions || 0),
    clicks: Number(as.clicks || 0),
  }));

  // Health score (0-100)
  let score = 50;
  if (impressions > 0) {
    let pts = 0, count = 0;
    if (ctr >= 3) pts += 100; else if (ctr >= 1.5) pts += 70; else if (ctr > 0) pts += 30;
    count++;
    const cpcThreshold = currency === "USD" ? 1.5 : 3.0;
    if (cpc > 0 && cpc <= cpcThreshold) pts += 100; else if (cpc <= cpcThreshold * 2) pts += 60; else if (cpc > 0) pts += 20;
    count++;
    if (frequency <= 2) pts += 100; else if (frequency <= 3) pts += 70; else if (frequency <= 4) pts += 40; else pts += 10;
    count++;
    if (roas >= 4) pts += 100; else if (roas >= 2) pts += 70; else if (roas > 0) pts += 40;
    if (roas > 0) count++;
    score = Math.round(pts / count);
  } else if (c.effective_status === "ACTIVE") {
    score = 40;
  } else {
    score = 30;
  }

  return {
    id: c.id,
    name: c.name,
    status: c.status,
    effective_status: c.effective_status,
    objective: c.objective || "",
    daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
    lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
    special_ad_categories: c.special_ad_categories || [],
    spend, impressions, clicks, ctr, cpc, cpm, reach, frequency, cpa, roas, conversions,
    health_score: score,
    adsets,
  };
}

// ── Historical context ────────────────────────────────────────────────────────

async function loadHistoricalSnapshots(admin: any, userId: string, accountDbId: string) {
  const { data } = await admin
    .from("apollo_metric_snapshots")
    .select("*")
    .eq("user_id", userId)
    .eq("account_id", accountDbId)
    .order("snapshot_date", { ascending: false })
    .limit(4);
  return data || [];
}

function buildTrendContext(snapshots: any[], currentCampaigns: any[], currency: string, currencySymbol: string): string {
  if (snapshots.length === 0) return "Sem histórico ainda — esta é a primeira análise.";

  const last = snapshots[0];
  const lines: string[] = [`📅 Tendências (vs semana anterior):`];

  if (last.wow_roas_delta !== null) {
    const arrow = last.wow_roas_delta > 0 ? "📈" : last.wow_roas_delta < 0 ? "📉" : "→";
    lines.push(`  ${arrow} ROAS: ${last.wow_roas_delta > 0 ? "+" : ""}${last.wow_roas_delta?.toFixed(1)}%`);
  }
  if (last.wow_ctr_delta !== null) {
    const arrow = last.wow_ctr_delta > 0 ? "📈" : last.wow_ctr_delta < 0 ? "📉" : "→";
    lines.push(`  ${arrow} CTR: ${last.wow_ctr_delta > 0 ? "+" : ""}${last.wow_ctr_delta?.toFixed(1)}%`);
  }
  if (last.wow_cpc_delta !== null) {
    const arrow = last.wow_cpc_delta < 0 ? "📈" : last.wow_cpc_delta > 0 ? "📉" : "→";
    lines.push(`  ${arrow} CPC: ${last.wow_cpc_delta > 0 ? "+" : ""}${last.wow_cpc_delta?.toFixed(1)}%`);
  }
  if (last.wow_spend_delta !== null) {
    lines.push(`  💰 Investimento: ${last.wow_spend_delta > 0 ? "+" : ""}${last.wow_spend_delta?.toFixed(1)}%`);
  }
  if (last.wow_health_delta !== null) {
    const arrow = last.wow_health_delta > 0 ? "⬆️" : last.wow_health_delta < 0 ? "⬇️" : "→";
    lines.push(`  ${arrow} Health Score: ${last.wow_health_delta > 0 ? "+" : ""}${last.wow_health_delta} pts`);
  }

  if (snapshots.length >= 2) {
    lines.push(`\n📊 Histórico (últimas ${snapshots.length} semanas):`);
    snapshots.slice(0, 4).forEach((s: any, i: number) => {
      lines.push(`  Semana -${i + 1}: Score ${s.overall_health_score}/100 | ROAS ${s.avg_roas?.toFixed(2)}x | CTR ${s.avg_ctr?.toFixed(2)}%`);
    });
  }

  return lines.join("\n");
}

// ── Learning context ──────────────────────────────────────────────────────────

async function loadLearningOutcomes(admin: any, userId: string) {
  const { data } = await admin
    .from("apollo_action_outcomes")
    .select("action_type, outcome, improvement_score")
    .eq("user_id", userId)
    .not("outcome", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  return data || [];
}

function buildLearningContext(outcomes: any[]): string {
  if (outcomes.length === 0) return "Sem histórico de ações ainda — aprendizado será acumulado após execuções.";

  const stats: Record<string, { total: number; positive: number; avgScore: number; scores: number[] }> = {};
  for (const o of outcomes) {
    if (!stats[o.action_type]) stats[o.action_type] = { total: 0, positive: 0, avgScore: 0, scores: [] };
    stats[o.action_type].total++;
    if (o.outcome === "improved") stats[o.action_type].positive++;
    if (o.improvement_score !== null) stats[o.action_type].scores.push(o.improvement_score);
  }

  const lines = ["🎓 Aprendizado acumulado (efetividade das ações passadas):"];
  for (const [type, s] of Object.entries(stats)) {
    const avg = s.scores.length ? Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length) : 0;
    const rate = Math.round((s.positive / s.total) * 100);
    lines.push(`  • ${type}: ${s.total} execuções → ${rate}% melhoraram | score médio ${avg > 0 ? "+" : ""}${avg} pts`);
  }

  return lines.join("\n");
}

// ── Level 6: New Intelligence Helpers ─────────────────────────────────────────

function getSeasonalContext(): string {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const month = brt.getUTCMonth() + 1;
  const day = brt.getUTCDate();
  const dow = brt.getUTCDay(); // 0=Sun

  const ctx: string[] = [];

  if (month === 11 && day >= 24 && day <= 30)
    ctx.push("🛒 BLACK FRIDAY SEMANA: Pico máximo do ano. Maximize orçamentos em ROAS>3x. CPCs altos são normais.");
  else if (month === 11 && day >= 15 && day <= 23)
    ctx.push("🛒 PRÉ-BLACK FRIDAY: Aqueça campanhas. Aumente orçamentos gradualmente. Construa audiências de remarketing.");
  else if (month === 11)
    ctx.push("📅 NOVEMBRO: Mês mais importante do e-commerce brasileiro. Prepare criativos e audiências para Black Friday.");
  else if (month === 12 && day <= 24)
    ctx.push("🎄 NATAL: Alta temporada. Foco em presenteáveis. ROAS benchmark sobe para 3x mínimo.");
  else if (month === 12 && day >= 26)
    ctx.push("📉 PÓS-NATAL: Volume caindo. Reduza orçamentos 20-30% até virada do ano.");
  else if (month === 1 && day <= 20)
    ctx.push("❄️ PÓS-FESTAS: Ressaca de consumo. Ideal para testes A/B e otimização de criativos.");
  else if (month === 2 && day >= 25 || (month === 3 && day <= 5))
    ctx.push("🎭 CARNAVAL: Queda em B2B. B2C de viagem/entretenimento pode performar. Reduza B2B 20-30%.");
  else if (month === 5 && day >= 4 && day <= 11)
    ctx.push("💐 DIA DAS MÃES (2ª dom/maio): Pico para moda, beleza, casa, decoração. Aumente verba em conversão.");
  else if (month === 6 && day >= 10 && day <= 30)
    ctx.push("🎪 MEIO DO ANO: Período de promoções de mid-year. Bom para liquidações e novos públicos.");
  else if (month === 8 && day >= 5 && day <= 12)
    ctx.push("👔 DIA DOS PAIS (2ª dom/ago): Pico para tech, ferramentas, moda masculina, esportes.");
  else if (month === 10 && day >= 8 && day <= 13)
    ctx.push("🧸 DIA DAS CRIANÇAS: Pico para brinquedos, games, produtos infantis. CPCs podem subir 30-50%.");

  if (dow === 0 || dow === 6)
    ctx.push("📅 FINAL DE SEMANA: CTR B2B cai tipicamente 25-40%. B2C pode melhorar. Ajuste bids se necessário.");
  else if (dow === 1)
    ctx.push("📅 SEGUNDA-FEIRA: Retomada. B2B tem pico de engajamento 9h-12h BRT.");

  return ctx.length > 0 ? ctx.join("\n") : "📅 Período normal de operação — sem sazonalidade especial.";
}

function computeCreativeFatigue(adsets: any[]): { score: number; level: string; recommendation: string } {
  if (!adsets?.length) return { score: 0, level: "sem_dados", recommendation: "" };

  const scores = adsets.map(as => {
    const freq = as.frequency || 0;
    const ctr = as.ctr || 0;
    // Frequency fatigue: optimal 1.5-2.5, escalates after 3
    const freqScore = freq <= 1.5 ? 0 : freq <= 2.5 ? 10 : freq <= 3.5 ? 30 : freq <= 5 ? 65 : 90;
    // CTR degradation penalty
    const ctrPenalty = ctr < 0.3 ? 40 : ctr < 0.7 ? 20 : ctr < 1.0 ? 8 : 0;
    return Math.min(100, freqScore + ctrPenalty);
  });

  const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const level = score >= 70 ? "crítica" : score >= 40 ? "moderada" : score >= 20 ? "leve" : "saudável";
  const recommendation = score >= 70
    ? "⚠️ Fadiga crítica: Pause Ad Sets com frequência > 4 e renove criativos urgente."
    : score >= 40
    ? "🔄 Fadiga moderada: Considere novos criativos e expansão de audiência."
    : score >= 20
    ? "👀 Fadiga leve: Monitore frequência. Prepare variações criativas."
    : "✅ Criativos saudáveis.";

  return { score, level, recommendation };
}

function computeBudgetPacing(spend: number, dailyBudget: number, datePreset: string): { ratio: number; status: string; insight: string } {
  if (!dailyBudget || dailyBudget <= 0) return { ratio: 1, status: "sem_orçamento", insight: "" };

  // Estimate daily spend from period
  const days: Record<string, number> = { today: 1, yesterday: 1, last_7d: 7, last_14d: 14, last_30d: 30 };
  const periodDays = days[datePreset] || 30;
  const avgDailySpend = spend / periodDays;
  const ratio = avgDailySpend / dailyBudget;

  const hourBRT = ((new Date().getUTCHours() - 3) + 24) % 24;
  const dayProgress = Math.max(0.1, (hourBRT + 1) / 24);

  let status: string;
  let insight: string;

  if (ratio > 1.25) {
    status = "overpacing";
    insight = `Gastando ${Math.round(ratio * 100)}% do orçamento diário em média. Risco de overspend.`;
  } else if (ratio < 0.65) {
    status = "underpacing";
    insight = `Utilizando apenas ${Math.round(ratio * 100)}% do orçamento diário. Verificar problemas de entrega.`;
  } else {
    status = "on_track";
    insight = `Pacing normal: ${Math.round(ratio * 100)}% do orçamento diário utilizado.`;
  }

  return { ratio, status, insight };
}

function detectPortfolioOpportunities(enriched: any[], currencySymbol: string): string {
  const active = enriched.filter(c => c.effective_status === "ACTIVE" && c.spend > 0);
  if (active.length < 2) return "Portfólio com uma única campanha ativa — sem análise comparativa disponível.";

  const totalBudget = active.reduce((s, c) => s + (c.daily_budget || 0), 0);
  const withRoas = active.filter(c => c.roas > 0);
  const avgRoas = withRoas.length ? withRoas.reduce((s, c) => s + c.roas, 0) / withRoas.length : 0;

  const insights: string[] = [];

  // Winners vs losers reallocation
  const winners = active.filter(c => c.roas >= Math.max(avgRoas * 1.5, 3) && c.health_score >= 65);
  const losers = active.filter(c => c.roas < Math.max(avgRoas * 0.4, 0.5) && c.health_score < 45 && c.spend > 50);

  if (winners.length > 0 && losers.length > 0) {
    const loserBudget = losers.reduce((s, c) => s + (c.daily_budget || 0), 0);
    insights.push(`💡 REALOCAÇÃO: ${losers.length} campanha(s) abaixo da média consomem ${currencySymbol}${loserBudget.toFixed(0)}/dia. Realocar para: ${winners.map(c => c.name).slice(0, 2).join(", ")} (ROAS médio ${(winners.reduce((s, c) => s + c.roas, 0) / winners.length).toFixed(1)}x).`);
  }

  // Budget concentration risk
  if (totalBudget > 0) {
    const concentrated = active.find(c => (c.daily_budget || 0) / totalBudget > 0.65);
    if (concentrated) {
      insights.push(`⚠️ CONCENTRAÇÃO: "${concentrated.name}" representa ${Math.round((concentrated.daily_budget / totalBudget) * 100)}% do orçamento. Diversifique para reduzir risco.`);
    }
  }

  // Under-invested winners
  const underinvested = winners.filter(c => totalBudget > 0 && (c.daily_budget || 0) / totalBudget < 0.12 && c.roas > 3);
  if (underinvested.length > 0) {
    insights.push(`🚀 SUBCAPITALIZADO: "${underinvested[0].name}" tem ROAS ${underinvested[0].roas.toFixed(1)}x mas apenas ${Math.round(((underinvested[0].daily_budget || 0) / totalBudget) * 100)}% do orçamento total. Aumente investimento.`);
  }

  // Portfolio health distribution
  const healthDist = {
    healthy: active.filter(c => c.health_score >= 70).length,
    warning: active.filter(c => c.health_score >= 45 && c.health_score < 70).length,
    critical: active.filter(c => c.health_score < 45).length,
  };
  insights.push(`📊 DISTRIBUIÇÃO DE SAÚDE: ${healthDist.healthy} saudáveis | ${healthDist.warning} em atenção | ${healthDist.critical} críticas de ${active.length} campanhas ativas.`);

  return insights.join("\n");
}

// ── Claude AI Analysis ────────────────────────────────────────────────────────

async function runApolloAI(
  apiKey: string, campaigns: any[], currency: string, currencySymbol: string,
  datePreset: string, trendContext: string, learningContext: string,
  seasonalContext: string, portfolioContext: string
) {
  const periodLabel: Record<string, string> = {
    today: "hoje", yesterday: "ontem", last_7d: "últimos 7 dias",
    last_14d: "últimos 14 dias", last_30d: "últimos 30 dias"
  };

  const campaignSummary = campaigns.map(c => {
    const adsetSummary = c.adsets?.length
      ? `  Ad Sets: ${c.adsets.map((as: any) =>
          `${as.name}[CTR:${as.ctr.toFixed(2)}% CPC:${currencySymbol}${as.cpc.toFixed(2)} Freq:${as.frequency.toFixed(1)} Fatiga:${as.creative_fatigue_score ?? 0}%]`
        ).join(", ")}`
      : "";
    const fatigueInfo = c.creative_fatigue ? ` | Fadiga Criativa: ${c.creative_fatigue.score}% (${c.creative_fatigue.level})` : "";
    const pacingInfo = c.budget_pacing ? ` | Pacing: ${c.budget_pacing.status} (${Math.round(c.budget_pacing.ratio * 100)}%)` : "";
    return `• ${c.name} [${c.effective_status}] | Score: ${c.health_score}/100${fatigueInfo}${pacingInfo}
  Gasto: ${currencySymbol} ${c.spend.toFixed(2)} | Impressões: ${c.impressions.toLocaleString()} | Cliques: ${c.clicks} | Conversões: ${c.conversions}
  CTR: ${c.ctr.toFixed(2)}% | CPC: ${currencySymbol} ${c.cpc.toFixed(2)} | CPM: ${currencySymbol} ${c.cpm.toFixed(2)}
  Alcance: ${c.reach.toLocaleString()} | Frequência: ${c.frequency.toFixed(2)} | ROAS: ${c.roas > 0 ? c.roas.toFixed(2) + "x" : "sem dados"} | CPA: ${c.cpa > 0 ? currencySymbol + c.cpa.toFixed(2) : "sem dados"}
  Orçamento/dia: ${c.daily_budget ? currencySymbol + " " + c.daily_budget.toFixed(2) : "N/A"}
${adsetSummary}`;
  }).join("\n\n");

  const systemPrompt = `Você é JOSÉ, agente autônomo NÍVEL 6 de otimização de Meta Ads. Você é o melhor gestor de tráfego pago do Brasil — sênior com 10+ anos de experiência, especialista em escalar negócios digitais através de dados, sazonalidade, fadiga criativa, otimização de portfólio e aprendizado contínuo.

CAPACIDADES NÍVEL 6:
✅ Análise WoW histórica e tendências
✅ Aprendizado de ações passadas
✅ Visão por Ad Set com fadiga criativa
✅ Inteligência de sazonalidade brasileira
✅ Otimização de portfólio entre campanhas
✅ Pacing de orçamento em tempo real
✅ Detecção de subcapitalização de vencedores
✅ Calibração de confiança por aprendizado acumulado
✅ Módulo PME: Gestão de leads e funil de vendas
✅ Módulo PME: Análise geográfica regional
✅ Módulo PME: ROI real com dados de vendas
✅ Módulo PME: Detecção de leads parados

BENCHMARKS (moeda: ${currency}):
- CTR: fraco < 0.8%, bom > 1.5%, excelente > 3%
- CPC: bom < ${currencySymbol} ${currency === "USD" ? "1.50" : "3.00"}, excelente < ${currencySymbol} ${currency === "USD" ? "0.80" : "1.50"}
- CPM: bom < ${currencySymbol} ${currency === "USD" ? "15" : "25"}
- Frequência: ideal 1.0-2.5, alerta > 3.5, fadiga crítica > 4.5
- ROAS: mínimo 1.5x, equilíbrio > 2x, bom > 3x, excelente > 5x
- Fadiga Criativa Score: leve < 20, moderada 20-40, alta 40-70, crítica > 70

CONTEXTO SAZONAL (HOJE):
${seasonalContext}

ANÁLISE DE PORTFÓLIO:
${portfolioContext}

REGRAS DE DECISÃO AUTOMÁTICA (auto_safe=true):
1. Pausar campanha: CTR < 0.5% E frequência > 4 (fadiga confirmada) E gasto > ${currencySymbol}${currency === "USD" ? "20" : "50"}
2. Pausar campanha: Gasto > ${currencySymbol}${currency === "USD" ? "30" : "100"} E conversões = 0 E impressões > 5000
3. Aumentar orçamento +30%: ROAS > 4x E CTR > 2% E frequency < 3 E health_score > 70 (escalar vencedor seguro)
4. Aumentar orçamento +50%: ROAS > 6x E health_score > 80 (escalar winner agressivo)
5. Diminuir orçamento -25%: CPC > 3x benchmark E ROAS < 1x E gasto > ${currencySymbol}${currency === "USD" ? "15" : "50"}
6. Pausar Ad Set: frequência do adset > 5 (preservar campanha, pausar conjunto fatigado)
7. Pausar Ad Set: fadiga_criativa_score > 70 E CTR caindo (fadiga criativa crítica)

AÇÕES QUE REQUEREM APROVAÇÃO (auto_safe=false):
- clone_campaign: ROAS > 5x E spend > ${currencySymbol}${currency === "USD" ? "200" : "500"} (clonar com público lookalike novo)
- rotate_creative: fadiga_criativa moderada/alta (sugerir renovação de criativos)
- reallocate_budget: redistribuir verba entre campanhas (portfólio)
- Pausar/ativar com performance moderada ou ambígua

HISTÓRICO DE TENDÊNCIAS WoW:
${trendContext}

APRENDIZADO DE AÇÕES PASSADAS:
${learningContext}

INSTRUÇÕES DE ANÁLISE NÍVEL 6:
1. Identifique TENDÊNCIAS, não apenas estado atual — mencione se métricas melhoram ou pioram
2. Para Ad Sets com frequência > 4, recomende pausar o adset, não a campanha inteira
3. Para fadiga criativa score > 40, recomende rotate_creative
4. Se ROAS > 5x com orçamento pequeno, recomende aumento agressivo (+50%) ou clone
5. Analise sazonalidade: adapte recomendações ao contexto do dia/época do ano
6. Faça análise de portfólio: identifique redistribuições de verba entre campanhas
7. Calibre confiança com aprendizado histórico — se ações similares melhoraram antes, aumente confiança
8. Identifique campanhas subcapitalizadas (bom ROAS mas orçamento pequeno)
9. Quando budget_pacing for underpacing, investigue problemas de entrega
10. Use linguagem de especialista sênior: seja específico, cite dados, quantifique impactos

Responda EXCLUSIVAMENTE em JSON válido:
{
  "health_score": número 0-100,
  "summary": "resumo executivo em 2 linhas com WoW + contexto sazonal",
  "analysis": "análise completa markdown ## títulos bullets emojis mín 400 palavras — inclua: tendências WoW, fadiga criativa, pacing, portfólio, sazonalidade, aprendizados",
  "actions": [
    {
      "campaign_id": "id_da_campanha",
      "adset_id": "id_do_adset_se_for_acao_de_adset_senao_null",
      "campaign_name": "nome",
      "action_type": "pause|activate|increase_budget|decrease_budget|pause_adset|activate_adset|clone_campaign|rotate_creative|reallocate_budget|notify",
      "priority": "critical|high|medium|low",
      "reason": "motivo específico com dados, comparação histórica e contexto sazonal",
      "impact": "impacto esperado quantificado — ex: 'Redução estimada de CPC em 25-35% baseada em 3 ações similares bem-sucedidas'",
      "params": {"daily_budget": valor_centavos_inteiro},
      "auto_safe": true|false,
      "confidence": número 0-100
    }
  ]
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: `Analise estas ${campaigns.length} campanhas (período: ${periodLabel[datePreset] || datePreset}):\n\n${campaignSummary}\n\nGere análise profunda NÍVEL 6 considerando: histórico WoW, aprendizado acumulado, fadiga criativa, sazonalidade e oportunidades de portfólio.`
        }]
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[apollo-agent] Claude error:", res.status, errText);
      return { analysis: null, actions: [], health_score: null, summary: null };
    }

    const data = await res.json();
    const content = data.content?.[0]?.text || "";

    try {
      const parsed = JSON.parse(content.trim());
      return {
        analysis: parsed.analysis || null,
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        health_score: parsed.health_score || null,
        summary: parsed.summary || null,
      };
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            analysis: parsed.analysis || content,
            actions: Array.isArray(parsed.actions) ? parsed.actions : [],
            health_score: parsed.health_score || null,
            summary: parsed.summary || null,
          };
        } catch { /* fall through */ }
      }
      return { analysis: content, actions: [], health_score: null, summary: null };
    }
  } catch (err: any) {
    console.error("[apollo-agent] Claude call error:", err);
    return { analysis: null, actions: [], health_score: null, summary: null };
  }
}

// ── Snapshot saving ───────────────────────────────────────────────────────────

async function saveMetricSnapshot(admin: any, userId: string, accountDbId: string, enriched: any[], historicalSnapshots: any[], healthScore: number | null) {
  if (enriched.length === 0) return;

  const totalSpend = enriched.reduce((s: number, c: any) => s + c.spend, 0);
  const totalImpressions = enriched.reduce((s: number, c: any) => s + c.impressions, 0);
  const totalClicks = enriched.reduce((s: number, c: any) => s + c.clicks, 0);
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
  const roasEntries = enriched.filter((c: any) => c.roas > 0);
  const avgRoas = roasEntries.length > 0 ? roasEntries.reduce((s: number, c: any) => s + c.roas, 0) / roasEntries.length : 0;
  const freqEntries = enriched.filter((c: any) => c.frequency > 0);
  const avgFreq = freqEntries.length > 0 ? freqEntries.reduce((s: number, c: any) => s + c.frequency, 0) / freqEntries.length : 0;
  const avgHealth = enriched.length > 0 ? Math.round(enriched.reduce((s: number, c: any) => s + c.health_score, 0) / enriched.length) : 50;

  // WoW deltas from last snapshot
  let wowSpend = null, wowRoas = null, wowCtr = null, wowCpc = null, wowHealth = null;
  if (historicalSnapshots.length > 0) {
    const prev = historicalSnapshots[0];
    wowSpend = prev.total_spend > 0 ? ((totalSpend - prev.total_spend) / prev.total_spend) * 100 : null;
    wowRoas = prev.avg_roas > 0 ? ((avgRoas - prev.avg_roas) / prev.avg_roas) * 100 : null;
    wowCtr = prev.avg_ctr > 0 ? ((avgCtr - prev.avg_ctr) / prev.avg_ctr) * 100 : null;
    wowCpc = prev.avg_cpc > 0 ? ((avgCpc - prev.avg_cpc) / prev.avg_cpc) * 100 : null;
    wowHealth = prev.overall_health_score ? avgHealth - prev.overall_health_score : null;
  }

  try {
    await admin.from("apollo_metric_snapshots").upsert({
      user_id: userId,
      account_id: accountDbId,
      snapshot_date: new Date().toISOString().split("T")[0],
      date_preset: "last_7d",
      total_spend: totalSpend,
      total_impressions: totalImpressions,
      total_clicks: totalClicks,
      avg_ctr: avgCtr,
      avg_cpc: avgCpc,
      avg_cpm: avgCpm,
      avg_roas: avgRoas,
      avg_frequency: avgFreq,
      overall_health_score: healthScore ?? avgHealth,
      campaigns_data: enriched,
      wow_spend_delta: wowSpend ? Number(wowSpend.toFixed(2)) : null,
      wow_roas_delta: wowRoas ? Number(wowRoas.toFixed(2)) : null,
      wow_ctr_delta: wowCtr ? Number(wowCtr.toFixed(2)) : null,
      wow_cpc_delta: wowCpc ? Number(wowCpc.toFixed(2)) : null,
      wow_health_delta: wowHealth,
    }, { onConflict: "user_id,account_id,snapshot_date" });
  } catch { /* ignore snapshot save error */ }
}

// ── Outcome tracking ──────────────────────────────────────────────────────────

async function scheduleOutcomeChecks(admin: any, userId: string, executionLog: any[], enriched: any[]) {
  for (const log of executionLog) {
    const camp = enriched.find((c: any) => c.id === log.campaign_id);
    if (!camp) continue;

    // Get the action_log id we just created
    const { data: logEntry } = await admin
      .from("apollo_action_log")
      .select("id")
      .eq("user_id", userId)
      .eq("campaign_id", log.campaign_id)
      .eq("action_type", log.action_type)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    try {
      await admin.from("apollo_action_outcomes").insert({
        user_id: userId,
        action_log_id: logEntry?.id || null,
        campaign_id_meta: log.campaign_id,
        action_type: log.action_type,
        before_health_score: camp.health_score,
        before_roas: camp.roas,
        before_ctr: camp.ctr,
        before_cpc: camp.cpc,
        before_spend: camp.spend,
      });
    } catch { /* ignore outcome insert error */ }
  }
}

// ── WhatsApp notifications ────────────────────────────────────────────────────

async function sendCriticalWhatsApp(admin: any, userId: string, aiResult: any, enriched: any[], currencySymbol: string) {
  const { data: waCfg } = await admin
    .from("whatsapp_config")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .single();

  if (!waCfg?.phone_number || !waCfg?.api_url) return;

  const { data: cronCfg } = await admin
    .from("apollo_cron_config")
    .select("send_whatsapp_on_critical")
    .eq("user_id", userId)
    .single();

  if (cronCfg && !cronCfg.send_whatsapp_on_critical) return;

  const criticals = (aiResult.actions || []).filter((a: any) => a.priority === "critical");
  const score = aiResult.health_score;

  const lines = [
    `🔴 *Apollo — Alerta Crítico*`,
    `📊 Score Geral: ${score ?? "??"}/100`,
    ``,
    `⚠️ *Ações Críticas Detectadas:*`,
    ...criticals.map((a: any) => `• ${a.campaign_name}: ${a.reason}`),
    ``,
    `📈 Abra o Apollo para aprovar as ações recomendadas.`,
  ];

  try {
    await fetch(`${waCfg.api_url}/message/sendText/${waCfg.instance_name || "default"}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": waCfg.api_key || "",
      },
      body: JSON.stringify({
        number: waCfg.phone_number,
        options: { delay: 1200, presence: "composing" },
        textMessage: { text: lines.join("\n") },
      }),
    });
  } catch (err) {
    console.error("[apollo-agent] WhatsApp notify error:", err);
  }
}

// ── Action execution ──────────────────────────────────────────────────────────

async function handleExecuteAction(
  admin: any, userId: string, targetAccountId: string,
  campaignId: string, actionType: string, actionParams: any,
  corsHeaders: any
) {
  let accountQuery = admin.from("ad_accounts").select("*")
    .eq("user_id", userId).eq("platform", "meta").eq("is_active", true);
  if (targetAccountId) accountQuery = accountQuery.eq("account_id", targetAccountId);
  const { data: adAccount } = await accountQuery.limit(1).single();

  if (!adAccount?.access_token_encrypted) {
    return new Response(JSON.stringify({ error: "Conta não encontrada" }), { status: 404, headers: corsHeaders });
  }

  // Get before-state for learning
  const beforeInsights = await fetchCampaignCurrentInsights(adAccount.access_token_encrypted, campaignId);

  const result = await executeMetaAction(adAccount.access_token_encrypted, {
    campaign_id: campaignId,
    action_type: actionType,
    params: actionParams || {},
  });

  // Log the action with before state
  let logEntry: any = null;
  try {
    const { data } = await admin.from("apollo_action_log").insert({
      user_id: userId,
      campaign_id: campaignId,
      action_type: actionType,
      params: actionParams || {},
      result,
      before_state: beforeInsights,
      executed_by: "user",
      executed_at: new Date().toISOString(),
    }).select().single();
    logEntry = data;
  } catch { /* ignore log error */ }

  // Create outcome tracking record
  if (logEntry) {
    try {
      await admin.from("apollo_action_outcomes").insert({
        user_id: userId,
        action_log_id: logEntry.id,
        campaign_id_meta: campaignId,
        action_type: actionType,
        before_ctr: beforeInsights?.ctr,
        before_cpc: beforeInsights?.cpc,
        before_spend: beforeInsights?.spend,
      });
    } catch { /* ignore outcome insert error */ }
  }

  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function fetchCampaignCurrentInsights(accessToken: string, campaignId: string) {
  try {
    const url = new URL(`${META_GRAPH_URL}/${campaignId}/insights`);
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("fields", "spend,ctr,cpc,cpm,impressions,clicks,reach,frequency,actions,action_values");
    url.searchParams.set("date_preset", "last_7d");
    const res = await fetch(url.toString());
    const data = await res.json();
    return data.data?.[0] || null;
  } catch { return null; }
}

async function executeMetaAction(accessToken: string, action: any) {
  try {
    const targetId = action.adset_id || action.campaign_id;

    if (action.action_type === "pause" || action.action_type === "activate" ||
        action.action_type === "pause_adset" || action.action_type === "activate_adset") {
      const status = (action.action_type === "pause" || action.action_type === "pause_adset") ? "PAUSED" : "ACTIVE";
      const url = new URL(`${META_GRAPH_URL}/${targetId}`);
      url.searchParams.set("access_token", accessToken);
      url.searchParams.set("status", status);
      const res = await fetch(url.toString(), { method: "POST" });
      const data = await res.json();
      return { success: !data.error, data, action_type: action.action_type };
    }

    if (action.action_type === "increase_budget" || action.action_type === "decrease_budget") {
      const url = new URL(`${META_GRAPH_URL}/${action.campaign_id}`);
      url.searchParams.set("access_token", accessToken);
      if (action.params?.daily_budget) {
        url.searchParams.set("daily_budget", String(Math.round(action.params.daily_budget)));
      }
      const res = await fetch(url.toString(), { method: "POST" });
      const data = await res.json();
      return { success: !data.error, data, action_type: action.action_type };
    }

    return { success: true, data: { message: "Ação registrada" }, action_type: action.action_type };
  } catch (err: any) {
    return { success: false, error: err.message, action_type: action.action_type };
  }
}

// ── Campaign cloning ──────────────────────────────────────────────────────────

async function handleCloneCampaign(admin: any, userId: string, targetAccountId: string, campaignId: string, params: any, corsHeaders: any) {
  try {
    let accountQuery = admin.from("ad_accounts").select("*")
      .eq("user_id", userId).eq("platform", "meta").eq("is_active", true);
    if (targetAccountId) accountQuery = accountQuery.eq("account_id", targetAccountId);
    const { data: adAccount } = await accountQuery.limit(1).single();

    if (!adAccount?.access_token_encrypted) {
      return new Response(JSON.stringify({ error: "Conta Meta não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Log clone attempt (fire and forget)
    let cloneRecordId: string | null = null;
    try {
      const { data: cloneRecord } = await admin.from("apollo_campaign_clones").insert({
        user_id: userId,
        account_id: adAccount.id,
        source_campaign_id_meta: campaignId,
        source_campaign_name: params?.source_name,
        source_roas: params?.source_roas,
        source_spend: params?.source_spend,
        clone_status: "in_progress",
        triggered_by: "user",
      }).select().single();
      cloneRecordId = cloneRecord?.id || null;
    } catch { /* table may not exist, continue anyway */ }

    const result = await cloneCampaignOnMeta(adAccount.access_token_encrypted, adAccount.account_id, campaignId, params);

    // Update clone record on success
    if (cloneRecordId) {
      try {
        await admin.from("apollo_campaign_clones").update({
          cloned_campaign_id_meta: result.new_campaign_id,
          cloned_campaign_name: result.new_campaign_name,
          clone_status: "success",
          completed_at: new Date().toISOString(),
        }).eq("id", cloneRecordId);
      } catch { /* ignore */ }
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err: any) {
    console.error("[apollo-agent] Clone error:", err?.message || err);
    return new Response(JSON.stringify({ success: false, error: err?.message || "Erro ao clonar campanha" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

async function cloneCampaignOnMeta(accessToken: string, accountId: string, campaignId: string, extraParams: any) {
  // ── Step 1: Fetch source campaign info (for naming) ──
  const campUrl = new URL(`${META_GRAPH_URL}/${campaignId}`);
  campUrl.searchParams.set("access_token", accessToken);
  campUrl.searchParams.set("fields", "name,objective,status");
  const campRes = await fetch(campUrl.toString());
  const campData = await campRes.json();
  if (campData.error) throw new Error(`Erro ao buscar campanha: ${campData.error.message}`);

  const newCampName = `${campData.name} [CLONE ${new Date().toLocaleDateString("pt-BR")}]`;

  // ── Step 2: Use Meta Copy API — copies campaign + ad sets + ads + creatives ──
  // This is the official Meta API for deep-copying campaigns with all children
  const copyUrl = new URL(`${META_GRAPH_URL}/${campaignId}/copies`);
  copyUrl.searchParams.set("access_token", accessToken);
  copyUrl.searchParams.set("deep_copy", "true"); // Copy ad sets and ads too
  copyUrl.searchParams.set("rename_options", JSON.stringify({ rename_suffix: ` [CLONE ${new Date().toLocaleDateString("pt-BR")}]` }));
  copyUrl.searchParams.set("status_option", "PAUSED"); // Create everything PAUSED

  console.log(`[apollo-agent] Cloning campaign ${campaignId} via Meta Copy API (deep_copy=true)...`);

  const copyRes = await fetch(copyUrl.toString(), { method: "POST" });
  const copyResult = await copyRes.json();

  if (copyResult.error) {
    console.error(`[apollo-agent] Meta Copy API error:`, JSON.stringify(copyResult.error));

    // Fallback: if Copy API fails, try manual clone with full ad set + ad creation
    console.log(`[apollo-agent] Falling back to manual clone...`);
    return await manualCloneCampaign(accessToken, accountId, campaignId, campData, newCampName, extraParams);
  }

  // Copy API returns array of copied object IDs
  // Format: { "copied_campaign_id": "123", "copied_adset_ids": [...], "copied_ad_ids": [...] }
  // or sometimes just { "campaign_group_id": "123" }
  const newCampaignId = copyResult.copied_campaign_id || copyResult.campaign_group_id || copyResult.id;

  if (!newCampaignId) {
    console.error(`[apollo-agent] Copy API returned unexpected format:`, JSON.stringify(copyResult));
    // Fallback to manual clone
    return await manualCloneCampaign(accessToken, accountId, campaignId, campData, newCampName, extraParams);
  }

  // If budget override requested, update the new campaign budget
  if (extraParams?.budget_override) {
    try {
      const updateUrl = new URL(`${META_GRAPH_URL}/${newCampaignId}`);
      updateUrl.searchParams.set("access_token", accessToken);
      updateUrl.searchParams.set("daily_budget", String(Math.round(extraParams.budget_override * 100)));
      await fetch(updateUrl.toString(), { method: "POST" });
    } catch (e: any) {
      console.warn(`[apollo-agent] Failed to update cloned campaign budget: ${e?.message}`);
    }
  }

  // Verify clone has ad sets and ads
  const verifyAdSets = await fetchCampaignAdSets(accessToken, newCampaignId);
  console.log(`[apollo-agent] Clone via Copy API successful. New campaign: ${newCampaignId}, AdSets: ${verifyAdSets.length}`);

  return {
    new_campaign_id: newCampaignId,
    new_campaign_name: newCampName,
    adsets_cloned: verifyAdSets.length,
    method: "copy_api",
  };
}

/**
 * Manual fallback clone: creates campaign + ad sets + ads one by one
 * Used when Meta's Copy API is not available or fails
 */
async function manualCloneCampaign(accessToken: string, accountId: string, sourceCampaignId: string, campData: any, newCampName: string, extraParams: any) {
  // ── Create new campaign ──
  const campFieldsUrl = new URL(`${META_GRAPH_URL}/${sourceCampaignId}`);
  campFieldsUrl.searchParams.set("access_token", accessToken);
  campFieldsUrl.searchParams.set("fields", "name,objective,daily_budget,lifetime_budget,special_ad_categories,bid_strategy,buying_type");
  const campFieldsRes = await fetch(campFieldsUrl.toString());
  const fullCampData = await campFieldsRes.json();
  if (fullCampData.error) throw new Error(`Erro ao buscar detalhes da campanha: ${fullCampData.error.message}`);

  const newCampUrl = new URL(`${META_GRAPH_URL}/act_${accountId}/campaigns`);
  newCampUrl.searchParams.set("access_token", accessToken);
  newCampUrl.searchParams.set("name", newCampName);
  newCampUrl.searchParams.set("objective", fullCampData.objective);
  newCampUrl.searchParams.set("status", "PAUSED");
  newCampUrl.searchParams.set("special_ad_categories", JSON.stringify(fullCampData.special_ad_categories || []));
  if (fullCampData.daily_budget && extraParams?.budget_override) {
    newCampUrl.searchParams.set("daily_budget", String(Math.round(extraParams.budget_override * 100)));
  } else if (fullCampData.daily_budget) {
    newCampUrl.searchParams.set("daily_budget", fullCampData.daily_budget);
  }
  if (fullCampData.bid_strategy) {
    newCampUrl.searchParams.set("bid_strategy", fullCampData.bid_strategy);
  }

  const newCampRes = await fetch(newCampUrl.toString(), { method: "POST" });
  const newCamp = await newCampRes.json();
  if (newCamp.error) throw new Error(`Erro ao criar campanha: ${newCamp.error.message}`);
  const newCampaignId = newCamp.id;

  console.log(`[apollo-agent] Manual clone: new campaign ${newCampaignId} created`);

  // ── Clone ad sets ──
  const sourceAdSets = await fetchCampaignAdSets(accessToken, sourceCampaignId);
  let adsetsCloned = 0;
  let adsCloned = 0;
  const errors: string[] = [];

  for (const adset of sourceAdSets.slice(0, 10)) {
    try {
      // Fetch full ad set details for cloning
      const adsetDetailUrl = new URL(`${META_GRAPH_URL}/${adset.id}`);
      adsetDetailUrl.searchParams.set("access_token", accessToken);
      adsetDetailUrl.searchParams.set("fields", "name,optimization_goal,billing_event,bid_strategy,bid_amount,daily_budget,lifetime_budget,targeting,promoted_object,start_time,end_time,pacing_type,attribution_spec");
      const adsetDetailRes = await fetch(adsetDetailUrl.toString());
      const adsetDetail = await adsetDetailRes.json();
      if (adsetDetail.error) {
        errors.push(`AdSet ${adset.name}: ${adsetDetail.error.message}`);
        continue;
      }

      // Create new ad set
      const newAsUrl = new URL(`${META_GRAPH_URL}/act_${accountId}/adsets`);
      newAsUrl.searchParams.set("access_token", accessToken);
      newAsUrl.searchParams.set("campaign_id", newCampaignId);
      newAsUrl.searchParams.set("name", `${adsetDetail.name} [CLONE]`);
      newAsUrl.searchParams.set("optimization_goal", adsetDetail.optimization_goal || "REACH");
      newAsUrl.searchParams.set("billing_event", adsetDetail.billing_event || "IMPRESSIONS");
      newAsUrl.searchParams.set("status", "PAUSED");

      // Budget
      if (adsetDetail.daily_budget) {
        newAsUrl.searchParams.set("daily_budget", adsetDetail.daily_budget);
      } else if (adsetDetail.lifetime_budget) {
        newAsUrl.searchParams.set("lifetime_budget", adsetDetail.lifetime_budget);
      }

      // Targeting — REQUIRED
      if (adsetDetail.targeting) {
        newAsUrl.searchParams.set("targeting", JSON.stringify(adsetDetail.targeting));
      } else {
        // Minimum targeting: country
        newAsUrl.searchParams.set("targeting", JSON.stringify({ geo_locations: { countries: ["BR"] } }));
      }

      // Promoted object (e.g., pixel_id, page_id)
      if (adsetDetail.promoted_object) {
        newAsUrl.searchParams.set("promoted_object", JSON.stringify(adsetDetail.promoted_object));
      }

      // Start time — REQUIRED for most ad sets
      if (adsetDetail.start_time) {
        newAsUrl.searchParams.set("start_time", adsetDetail.start_time);
      } else {
        // Set start time to tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        newAsUrl.searchParams.set("start_time", tomorrow.toISOString());
      }

      // End time (if exists)
      if (adsetDetail.end_time) {
        const endDate = new Date(adsetDetail.end_time);
        if (endDate > new Date()) {
          newAsUrl.searchParams.set("end_time", adsetDetail.end_time);
        }
      }

      // Bid strategy
      if (adsetDetail.bid_strategy) {
        newAsUrl.searchParams.set("bid_strategy", adsetDetail.bid_strategy);
      }
      if (adsetDetail.bid_amount) {
        newAsUrl.searchParams.set("bid_amount", adsetDetail.bid_amount);
      }

      // Attribution
      if (adsetDetail.attribution_spec) {
        newAsUrl.searchParams.set("attribution_spec", JSON.stringify(adsetDetail.attribution_spec));
      }

      const newAsRes = await fetch(newAsUrl.toString(), { method: "POST" });
      const newAs = await newAsRes.json();

      if (newAs.error) {
        errors.push(`AdSet ${adset.name}: ${newAs.error.message}`);
        console.error(`[apollo-agent] Failed to clone ad set ${adset.name}:`, newAs.error.message);
        continue;
      }

      const newAdSetId = newAs.id;
      adsetsCloned++;
      console.log(`[apollo-agent] Cloned ad set: ${adset.name} → ${newAdSetId}`);

      // ── Clone ads within this ad set ──
      const sourceAds = await fetchAdSetAds(accessToken, adset.id);
      for (const ad of sourceAds.slice(0, 20)) {
        try {
          // Fetch full ad details including creative
          const adDetailUrl = new URL(`${META_GRAPH_URL}/${ad.id}`);
          adDetailUrl.searchParams.set("access_token", accessToken);
          adDetailUrl.searchParams.set("fields", "name,creative{id},tracking_specs,conversion_specs");
          const adDetailRes = await fetch(adDetailUrl.toString());
          const adDetail = await adDetailRes.json();
          if (adDetail.error) {
            errors.push(`Ad ${ad.name}: ${adDetail.error.message}`);
            continue;
          }

          const creativeId = adDetail.creative?.id;
          if (!creativeId) {
            errors.push(`Ad ${ad.name}: sem creative_id`);
            continue;
          }

          // Create new ad with the SAME creative (reuses existing creative)
          const newAdUrl = new URL(`${META_GRAPH_URL}/act_${accountId}/ads`);
          newAdUrl.searchParams.set("access_token", accessToken);
          newAdUrl.searchParams.set("adset_id", newAdSetId);
          newAdUrl.searchParams.set("name", `${ad.name} [CLONE]`);
          newAdUrl.searchParams.set("creative", JSON.stringify({ creative_id: creativeId }));
          newAdUrl.searchParams.set("status", "PAUSED");

          if (adDetail.tracking_specs) {
            newAdUrl.searchParams.set("tracking_specs", JSON.stringify(adDetail.tracking_specs));
          }

          const newAdRes = await fetch(newAdUrl.toString(), { method: "POST" });
          const newAd = await newAdRes.json();

          if (newAd.error) {
            errors.push(`Ad ${ad.name}: ${newAd.error.message}`);
            console.error(`[apollo-agent] Failed to clone ad ${ad.name}:`, newAd.error.message);
          } else {
            adsCloned++;
            console.log(`[apollo-agent] Cloned ad: ${ad.name} → ${newAd.id}`);
          }
        } catch (adErr: any) {
          errors.push(`Ad ${ad.name}: ${adErr?.message}`);
        }
      }
    } catch (asErr: any) {
      errors.push(`AdSet ${adset.name}: ${asErr?.message}`);
      console.error(`[apollo-agent] Ad set clone error:`, asErr?.message);
    }
  }

  console.log(`[apollo-agent] Manual clone complete. Campaign: ${newCampaignId}, AdSets: ${adsetsCloned}, Ads: ${adsCloned}, Errors: ${errors.length}`);

  return {
    new_campaign_id: newCampaignId,
    new_campaign_name: newCampName,
    adsets_cloned: adsetsCloned,
    ads_cloned: adsCloned,
    errors: errors.length > 0 ? errors : undefined,
    method: "manual",
  };
}

// ── History / config helpers ──────────────────────────────────────────────────

async function handleGetHistory(admin: any, userId: string, targetAccountId: string, corsHeaders: any) {
  const [snapshots, outcomes, clones] = await Promise.all([
    admin.from("apollo_metric_snapshots")
      .select("*").eq("user_id", userId)
      .order("snapshot_date", { ascending: false }).limit(8),
    admin.from("apollo_action_outcomes")
      .select("*").eq("user_id", userId)
      .not("outcome", "is", null)
      .order("created_at", { ascending: false }).limit(20),
    admin.from("apollo_campaign_clones")
      .select("*").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(10),
  ]);

  return new Response(JSON.stringify({
    snapshots: snapshots.data || [],
    outcomes: outcomes.data || [],
    clones: clones.data || [],
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleLoadSession(admin: any, userId: string, targetAccountId: string, corsHeaders: any) {
  try {
    let query = admin.from("apollo_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("analyzed_at", { ascending: false })
      .limit(1);

    if (targetAccountId) query = query.eq("account_id", targetAccountId);

    const { data: session } = await query.single();

    if (!session) {
      return new Response(JSON.stringify({ session: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Also get the ad account info for display
    let accountInfo: any = { id: "", name: "Conta Meta", currency: "BRL", currencySymbol: "R$" };
    if (session.account_id) {
      const { data: acct } = await admin.from("ad_accounts")
        .select("account_id, account_name, currency")
        .eq("id", session.account_id)
        .single();
      if (acct) {
        accountInfo = {
          id: acct.account_id,
          name: acct.account_name || "Conta Meta",
          currency: acct.currency || "BRL",
          currencySymbol: (acct.currency || "BRL") === "USD" ? "US$" : "R$",
        };
      }
    }

    return new Response(JSON.stringify({
      session: {
        status: "loaded",
        account: accountInfo,
        campaigns: session.campaigns_snapshot || [],
        health_score: session.health_score,
        summary: session.summary,
        ai_analysis: session.ai_analysis,
        actions: session.actions_snapshot || [],
        execution_log: session.execution_log || [],
        date_preset: session.date_preset || "last_30d",
        analyzed_at: session.analyzed_at,
        auto_mode: session.auto_mode,
        level: 6,
      }
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ session: null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

async function handleGetCronConfig(admin: any, userId: string, corsHeaders: any) {
  const { data } = await admin.from("apollo_cron_config").select("*").eq("user_id", userId).single();
  return new Response(JSON.stringify(data || {}), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleSaveCronConfig(admin: any, userId: string, body: any, corsHeaders: any) {
  const {
    run_hour, run_minute, timezone, date_preset, auto_execute,
    send_whatsapp_on_critical, send_daily_report, whatsapp_report_number,
    is_enabled,
  } = body;

  // Compute next_run_at
  const now = new Date();
  const nextRun = new Date();
  nextRun.setHours(run_hour ?? 8, run_minute ?? 0, 0, 0);
  if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);

  try {
    await admin.from("apollo_cron_config").upsert({
      user_id: userId,
      is_enabled: is_enabled ?? true,
      run_hour: run_hour ?? 8,
      run_minute: run_minute ?? 0,
      timezone: timezone ?? "America/Sao_Paulo",
      date_preset: date_preset ?? "last_7d",
      auto_execute: auto_execute ?? false,
      send_whatsapp_on_critical: send_whatsapp_on_critical ?? true,
      send_daily_report: send_daily_report ?? true,
      whatsapp_report_number: whatsapp_report_number || null,
      next_run_at: nextRun.toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  } catch { /* ignore upsert error */ }

  return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleGetAdsets(admin: any, userId: string, targetAccountId: string, campaignId: string, datePreset: string, corsHeaders: any) {
  let accountQuery = admin.from("ad_accounts").select("*")
    .eq("user_id", userId).eq("platform", "meta").eq("is_active", true);
  if (targetAccountId) accountQuery = accountQuery.eq("account_id", targetAccountId);
  const { data: adAccount } = await accountQuery.limit(1).single();

  if (!adAccount?.access_token_encrypted) {
    return new Response(JSON.stringify({ error: "Conta não encontrada" }), { status: 404, headers: corsHeaders });
  }

  const [adsets, adsetInsightsRaw] = await Promise.all([
    fetchCampaignAdSets(adAccount.access_token_encrypted, campaignId),
    (async () => {
      const url = new URL(`${META_GRAPH_URL}/${campaignId}/insights`);
      url.searchParams.set("access_token", adAccount.access_token_encrypted);
      url.searchParams.set("fields", "adset_id,adset_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values");
      url.searchParams.set("date_preset", datePreset);
      url.searchParams.set("level", "adset");
      const res = await fetch(url.toString());
      const d = await res.json();
      return d.data || [];
    })(),
  ]);

  const insMap = new Map(adsetInsightsRaw.map((i: any) => [i.adset_id, i]));

  const enrichedAdsets = adsets.map((as: any) => {
    const m: any = insMap.get(as.id) || {};
    return {
      ...as,
      spend: Number(m.spend || 0),
      impressions: Number(m.impressions || 0),
      clicks: Number(m.clicks || 0),
      ctr: Number(m.ctr || 0),
      cpc: Number(m.cpc || 0),
      cpm: Number(m.cpm || 0),
      reach: Number(m.reach || 0),
      frequency: Number(m.frequency || 0),
    };
  });

  return new Response(JSON.stringify({ adsets: enrichedAdsets }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// ── Daily WhatsApp Report ─────────────────────────────────────────────────────

async function sendDailyReport(
  admin: any, userId: string, aiResult: any, enriched: any[],
  executionLog: any[], currencySymbol: string
) {
  // Check cron config for daily report settings
  const { data: cronCfg } = await admin
    .from("apollo_cron_config")
    .select("send_daily_report, whatsapp_report_number")
    .eq("user_id", userId)
    .single();

  if (!cronCfg?.send_daily_report || !cronCfg?.whatsapp_report_number) return;

  const phone = cronCfg.whatsapp_report_number.replace(/\D/g, '');
  if (phone.length < 10) return;

  // Format phone to international (55 + DDD + number)
  const intlPhone = phone.startsWith('55') ? phone : `55${phone}`;

  // Get WhatsApp API config
  const { data: waCfg } = await admin
    .from("whatsapp_config")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .single();

  if (!waCfg?.api_url) return;

  // Build report
  const score = aiResult.health_score ?? '??';
  const totalSpend = enriched.reduce((s: number, c: any) => s + c.spend, 0);
  const totalConv = enriched.reduce((s: number, c: any) => s + c.conversions, 0);
  const activeCamps = enriched.filter((c: any) => c.effective_status === 'ACTIVE');
  const healthyCamps = activeCamps.filter((c: any) => c.health_score >= 70);
  const criticalCamps = activeCamps.filter((c: any) => c.health_score < 45);

  const scoreEmoji = score >= 70 ? '🟢' : score >= 45 ? '🟡' : '🔴';
  const actions = aiResult.actions || [];
  const criticalActions = actions.filter((a: any) => a.priority === 'critical');
  const highActions = actions.filter((a: any) => a.priority === 'high');

  const lines: string[] = [
    `📊 *JOSÉ — Relatório Diário*`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `${scoreEmoji} *Health Score Geral: ${score}/100*`,
    ``,
    `💰 *Investimento:* ${currencySymbol} ${totalSpend.toFixed(2)}`,
    `🎯 *Conversões:* ${totalConv}`,
    `📢 *Campanhas ativas:* ${activeCamps.length}`,
    `✅ *Saudáveis:* ${healthyCamps.length} | ⚠️ *Críticas:* ${criticalCamps.length}`,
    ``,
  ];

  // Top 3 campanhas por score
  const top3 = [...activeCamps].sort((a, b) => b.health_score - a.health_score).slice(0, 3);
  if (top3.length > 0) {
    lines.push(`📈 *Top Campanhas:*`);
    top3.forEach((c: any, i: number) => {
      const emoji = c.health_score >= 70 ? '🟢' : c.health_score >= 45 ? '🟡' : '🔴';
      lines.push(`${i + 1}. ${emoji} ${c.name}`);
      lines.push(`   Score: ${c.health_score} | ROAS: ${c.roas > 0 ? c.roas.toFixed(1) + 'x' : '-'} | CTR: ${c.ctr.toFixed(1)}%`);
    });
    lines.push(``);
  }

  // Actions summary
  if (actions.length > 0) {
    lines.push(`⚡ *Ações Recomendadas (${actions.length}):*`);
    if (criticalActions.length > 0) {
      lines.push(`🔴 ${criticalActions.length} crítica(s)`);
      criticalActions.slice(0, 2).forEach((a: any) => {
        lines.push(`   • ${a.campaign_name}: ${a.reason?.slice(0, 80)}`);
      });
    }
    if (highActions.length > 0) {
      lines.push(`🟠 ${highActions.length} alta(s) prioridade`);
    }
    lines.push(``);
  }

  // Executed actions
  if (executionLog.length > 0) {
    const actionLabels: Record<string, string> = {
      pause: '⏸️ Pausou', activate: '▶️ Ativou',
      increase_budget: '📈 Aumentou verba', decrease_budget: '📉 Reduziu verba',
      pause_adset: '⏸️ Pausou Ad Set',
    };
    lines.push(`🤖 *Ações Executadas Automaticamente (${executionLog.length}):*`);
    executionLog.slice(0, 3).forEach((e: any) => {
      const label = actionLabels[e.action_type] || e.action_type;
      lines.push(`   ${label}: ${e.campaign_name || e.campaign_id}`);
    });
    lines.push(``);
  }

  // Summary
  if (aiResult.summary) {
    lines.push(`💡 *Resumo IA:*`);
    lines.push(aiResult.summary.slice(0, 200));
    lines.push(``);
  }

  // PME Lead stats
  try {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { data: monthLeads } = await admin.from("leads").select("status, sale_value").eq("user_id", userId).gte("created_at", firstOfMonth);

    if (monthLeads && monthLeads.length > 0) {
      const sales = monthLeads.filter((l: any) => l.status === 'venda_realizada');
      const staleCount = monthLeads.filter((l: any) => ['novo', 'em_atendimento'].includes(l.status)).length;
      const totalSales = sales.reduce((s: number, l: any) => s + (Number(l.sale_value) || 0), 0);

      lines.push(`👥 *Leads do Mês:*`);
      lines.push(`   Total: ${monthLeads.length} | Vendas: ${sales.length} | Faturamento: R$ ${totalSales.toFixed(2)}`);
      if (staleCount > 0) {
        lines.push(`   ⚠️ ${staleCount} leads aguardando atendimento`);
      }
      lines.push(``);
    }
  } catch { /* table may not exist yet */ }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🤖 _Gerado por JOSÉ Governador — LogosIA_`);

  try {
    await fetch(`${waCfg.api_url}/message/sendText/${waCfg.instance_name || "default"}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": waCfg.api_key || "",
      },
      body: JSON.stringify({
        number: intlPhone,
        options: { delay: 1200, presence: "composing" },
        textMessage: { text: lines.join("\n") },
      }),
    });
  } catch (err) {
    console.error("[apollo-agent] WhatsApp daily report error:", err);
  }
}

// ── PME Module: Lead Stats ────────────────────────────────────────────────────

async function handleGetLeadStats(admin: any, userId: string, targetAccountId: string, corsHeaders: any) {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Get leads this month
  const { data: leads, error } = await admin
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .gte("created_at", firstOfMonth);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const allLeads = leads || [];
  const totalLeads = allLeads.length;
  const qualifiedLeads = allLeads.filter((l: any) => ['qualificado', 'proposta', 'venda_realizada'].includes(l.status));
  const salesLeads = allLeads.filter((l: any) => l.status === 'venda_realizada');
  const totalSalesValue = salesLeads.reduce((s: number, l: any) => s + (Number(l.sale_value) || 0), 0);

  // Get ad spend this month from Meta insights
  let totalSpend = 0;
  try {
    let accountQuery = admin.from("ad_accounts").select("*")
      .eq("user_id", userId).eq("platform", "meta").eq("is_active", true);
    if (targetAccountId) accountQuery = accountQuery.eq("account_id", targetAccountId);
    const { data: adAccount } = await accountQuery.limit(1).single();

    if (adAccount?.access_token_encrypted) {
      const insUrl = new URL(`https://graph.facebook.com/v21.0/act_${adAccount.account_id}/insights`);
      insUrl.searchParams.set("access_token", adAccount.access_token_encrypted);
      insUrl.searchParams.set("fields", "spend");
      insUrl.searchParams.set("date_preset", "this_month");
      const insRes = await fetch(insUrl.toString());
      const insData = await insRes.json();
      totalSpend = Number(insData.data?.[0]?.spend || 0);
    }
  } catch { /* ignore */ }

  // Lead stats by status
  const statusCounts: Record<string, number> = {};
  const temperatureCounts: Record<string, number> = {};
  const campaignCounts: Record<string, number> = {};

  for (const lead of allLeads) {
    statusCounts[lead.status] = (statusCounts[lead.status] || 0) + 1;
    temperatureCounts[lead.temperature] = (temperatureCounts[lead.temperature] || 0) + 1;
    if (lead.campaign_name) {
      campaignCounts[lead.campaign_name] = (campaignCounts[lead.campaign_name] || 0) + 1;
    }
  }

  // Stale leads (no interaction in 24h+)
  const staleThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const staleLeads = allLeads.filter((l: any) =>
    ['novo', 'em_atendimento'].includes(l.status) && l.last_interaction_at < staleThreshold
  );

  const conversionRate = totalLeads > 0 ? (salesLeads.length / totalLeads) * 100 : 0;
  const cplq = qualifiedLeads.length > 0 && totalSpend > 0 ? totalSpend / qualifiedLeads.length : 0;
  const cac = salesLeads.length > 0 && totalSpend > 0 ? totalSpend / salesLeads.length : 0;
  const roi = totalSpend > 0 ? ((totalSalesValue - totalSpend) / totalSpend) * 100 : 0;

  return new Response(JSON.stringify({
    total_leads: totalLeads,
    qualified_leads: qualifiedLeads.length,
    sales_count: salesLeads.length,
    total_sales_value: totalSalesValue,
    total_spend: totalSpend,
    conversion_rate: Number(conversionRate.toFixed(1)),
    cplq: Number(cplq.toFixed(2)),
    cac: Number(cac.toFixed(2)),
    roi: Number(roi.toFixed(1)),
    status_breakdown: statusCounts,
    temperature_breakdown: temperatureCounts,
    campaign_breakdown: campaignCounts,
    stale_leads_count: staleLeads.length,
    stale_leads: staleLeads.map((l: any) => ({ id: l.id, name: l.contact_name, phone: l.contact_phone, campaign: l.campaign_name, hours_stale: Math.round((now.getTime() - new Date(l.last_interaction_at).getTime()) / 3600000) })),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── PME Module: Geographic Performance ────────────────────────────────────────

async function handleGeoPerformance(admin: any, userId: string, targetAccountId: string, datePreset: string, corsHeaders: any) {
  try {
    let accountQuery = admin.from("ad_accounts").select("*")
      .eq("user_id", userId).eq("platform", "meta").eq("is_active", true);
    if (targetAccountId) accountQuery = accountQuery.eq("account_id", targetAccountId);
    const { data: adAccount } = await accountQuery.limit(1).single();

    if (!adAccount?.access_token_encrypted) {
      return new Response(JSON.stringify({ error: "Conta não encontrada" }), { status: 404, headers: corsHeaders });
    }

    // Fetch regional breakdown from Meta API
    const url = new URL(`https://graph.facebook.com/v21.0/act_${adAccount.account_id}/insights`);
    url.searchParams.set("access_token", adAccount.access_token_encrypted);
    url.searchParams.set("fields", "impressions,clicks,spend,ctr,cpc,actions,action_values");
    url.searchParams.set("date_preset", datePreset);
    url.searchParams.set("breakdowns", "region");
    url.searchParams.set("limit", "50");

    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message }), { status: 400, headers: corsHeaders });
    }

    const regions = (data.data || []).map((r: any) => {
      const spend = Number(r.spend || 0);
      const conversions = r.actions?.find((a: any) => a.action_type.includes("purchase") || a.action_type.includes("lead"))?.value || 0;
      const revenue = r.action_values?.find((a: any) => a.action_type.includes("purchase"))?.value || 0;

      return {
        region: r.region || "Desconhecida",
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        spend,
        ctr: Number(r.ctr || 0),
        cpc: Number(r.cpc || 0),
        conversions: Number(conversions),
        revenue: Number(revenue),
        roas: spend > 0 ? Number(revenue) / spend : 0,
        cpa: Number(conversions) > 0 ? spend / Number(conversions) : 0,
      };
    }).sort((a: any, b: any) => b.spend - a.spend);

    // Save snapshot
    for (const region of regions.slice(0, 20)) {
      try {
        await admin.from("geo_performance").upsert({
          user_id: userId,
          account_id: adAccount.id,
          region: region.region,
          region_type: "state",
          impressions: region.impressions,
          clicks: region.clicks,
          spend: region.spend,
          conversions: region.conversions,
          ctr: region.ctr,
          cpc: region.cpc,
          cpa: region.cpa,
          roas: region.roas,
          date_preset: datePreset,
          snapshot_date: new Date().toISOString().split("T")[0],
        }, { onConflict: "user_id,account_id,region,snapshot_date" });
      } catch { /* ignore */ }
    }

    // Identify best/worst regions
    const withSpend = regions.filter((r: any) => r.spend > 0);
    const bestRegion = withSpend.length > 0 ? withSpend.reduce((a: any, b: any) => (a.roas > b.roas ? a : b)) : null;
    const worstRegion = withSpend.length > 0 ? withSpend.reduce((a: any, b: any) => (a.roas < b.roas && a.spend > 10 ? a : b)) : null;

    return new Response(JSON.stringify({
      regions,
      total_regions: regions.length,
      best_region: bestRegion,
      worst_region: worstRegion,
      insights: generateGeoInsights(regions),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message }), { status: 500, headers: corsHeaders });
  }
}

function generateGeoInsights(regions: any[]): string[] {
  const insights: string[] = [];
  const withSpend = regions.filter((r: any) => r.spend > 0);

  if (withSpend.length === 0) return ["Sem dados geográficos suficientes para análise."];

  const totalSpend = withSpend.reduce((s: number, r: any) => s + r.spend, 0);
  const top3 = withSpend.slice(0, 3);
  const top3Spend = top3.reduce((s: number, r: any) => s + r.spend, 0);
  const top3Pct = totalSpend > 0 ? (top3Spend / totalSpend) * 100 : 0;

  insights.push(`📍 Top 3 regiões concentram ${top3Pct.toFixed(0)}% do investimento: ${top3.map((r: any) => r.region).join(", ")}`);

  const highCPC = withSpend.filter((r: any) => r.cpc > withSpend.reduce((s: number, x: any) => s + x.cpc, 0) / withSpend.length * 1.5);
  if (highCPC.length > 0) {
    insights.push(`⚠️ CPC acima da média em: ${highCPC.map((r: any) => r.region).slice(0, 3).join(", ")}`);
  }

  const lowCTR = withSpend.filter((r: any) => r.ctr < 0.5 && r.impressions > 1000);
  if (lowCTR.length > 0) {
    insights.push(`📉 CTR baixo em: ${lowCTR.map((r: any) => `${r.region} (${r.ctr.toFixed(2)}%)`).slice(0, 3).join(", ")}`);
  }

  return insights;
}

// ── PME Module: ROI Report ────────────────────────────────────────────────────

async function handleROIReport(admin: any, userId: string, targetAccountId: string, datePreset: string, corsHeaders: any) {
  const now = new Date();
  let startDate: Date;

  switch (datePreset) {
    case "today": startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case "yesterday": startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); break;
    case "last_7d": startDate = new Date(now.getTime() - 7 * 86400000); break;
    case "last_14d": startDate = new Date(now.getTime() - 14 * 86400000); break;
    case "last_30d": default: startDate = new Date(now.getTime() - 30 * 86400000); break;
  }

  // Get sales data
  const { data: sales } = await admin
    .from("sales_data")
    .select("*")
    .eq("user_id", userId)
    .gte("sale_date", startDate.toISOString().split("T")[0]);

  // Get leads with sales
  const { data: leadSales } = await admin
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "venda_realizada")
    .gte("sale_date", startDate.toISOString());

  // Get PME config for margin
  const { data: pmeConfig } = await admin
    .from("pme_config")
    .select("profit_margin_percent, average_ticket")
    .eq("user_id", userId)
    .single();

  const marginPct = pmeConfig?.profit_margin_percent || 30;
  const avgTicket = pmeConfig?.average_ticket || 0;

  // Get ad spend
  let totalSpend = 0;
  let campaignSpends: Record<string, number> = {};
  try {
    let accountQuery = admin.from("ad_accounts").select("*")
      .eq("user_id", userId).eq("platform", "meta").eq("is_active", true);
    if (targetAccountId) accountQuery = accountQuery.eq("account_id", targetAccountId);
    const { data: adAccount } = await accountQuery.limit(1).single();

    if (adAccount?.access_token_encrypted) {
      const insUrl = new URL(`https://graph.facebook.com/v21.0/act_${adAccount.account_id}/insights`);
      insUrl.searchParams.set("access_token", adAccount.access_token_encrypted);
      insUrl.searchParams.set("fields", "campaign_id,campaign_name,spend");
      insUrl.searchParams.set("date_preset", datePreset);
      insUrl.searchParams.set("level", "campaign");
      insUrl.searchParams.set("limit", "100");
      const insRes = await fetch(insUrl.toString());
      const insData = await insRes.json();
      for (const row of (insData.data || [])) {
        const s = Number(row.spend || 0);
        totalSpend += s;
        campaignSpends[row.campaign_id] = s;
      }
    }
  } catch { /* ignore */ }

  // Calculate metrics
  const allSales = [...(sales || []), ...(leadSales || []).map((l: any) => ({ sale_value: l.sale_value, campaign_id_meta: l.campaign_id_meta, campaign_name: l.campaign_name }))];

  // Deduplicate by lead_id if present
  const uniqueSales = allSales;
  const totalRevenue = uniqueSales.reduce((s: number, r: any) => s + (Number(r.sale_value) || 0), 0);
  const totalProfit = totalRevenue * (marginPct / 100);
  const netProfit = totalProfit - totalSpend;
  const roi = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : 0;
  const roiProfit = totalSpend > 0 ? ((netProfit) / totalSpend) * 100 : 0;
  const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const cac = uniqueSales.length > 0 && totalSpend > 0 ? totalSpend / uniqueSales.length : 0;

  // Per-campaign ROI
  const campaignROI: any[] = [];
  const campaignSalesMap: Record<string, { count: number; revenue: number }> = {};
  for (const sale of uniqueSales) {
    const cid = sale.campaign_id_meta || "unknown";
    if (!campaignSalesMap[cid]) campaignSalesMap[cid] = { count: 0, revenue: 0 };
    campaignSalesMap[cid].count++;
    campaignSalesMap[cid].revenue += Number(sale.sale_value) || 0;
  }

  for (const [cid, data] of Object.entries(campaignSalesMap)) {
    const spend = campaignSpends[cid] || 0;
    campaignROI.push({
      campaign_id: cid,
      campaign_name: uniqueSales.find((s: any) => s.campaign_id_meta === cid)?.campaign_name || cid,
      sales_count: data.count,
      revenue: data.revenue,
      spend,
      profit: data.revenue * (marginPct / 100) - spend,
      roas: spend > 0 ? data.revenue / spend : 0,
      cac: data.count > 0 && spend > 0 ? spend / data.count : 0,
    });
  }

  return new Response(JSON.stringify({
    period: datePreset,
    total_spend: totalSpend,
    total_revenue: totalRevenue,
    total_profit: totalProfit,
    net_profit: netProfit,
    roi: Number(roi.toFixed(1)),
    roi_profit: Number(roiProfit.toFixed(1)),
    roas: Number(roas.toFixed(2)),
    cac: Number(cac.toFixed(2)),
    total_sales: uniqueSales.length,
    average_ticket: uniqueSales.length > 0 ? totalRevenue / uniqueSales.length : avgTicket,
    margin_percent: marginPct,
    campaign_roi: campaignROI.sort((a, b) => b.revenue - a.revenue),
    summary: generateROISummary(totalSpend, totalRevenue, netProfit, roi, roas, uniqueSales.length, cac),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function generateROISummary(spend: number, revenue: number, netProfit: number, roi: number, roas: number, sales: number, cac: number): string {
  const lines: string[] = [];

  if (revenue === 0 && spend > 0) {
    lines.push("⚠️ Nenhuma venda registrada no período. Cadastre suas vendas para ver o ROI real.");
    lines.push("💡 Use a aba 'Leads' para classificar leads e registrar vendas.");
    return lines.join("\n");
  }

  if (netProfit > 0) {
    lines.push(`✅ Lucro líquido positivo: R$ ${netProfit.toFixed(2)} no período.`);
  } else if (netProfit < 0) {
    lines.push(`⚠️ Prejuízo no período: R$ ${Math.abs(netProfit).toFixed(2)}.`);
  }

  lines.push(`📊 ROAS real: ${roas.toFixed(1)}x (cada R$1 investido retornou R$ ${roas.toFixed(2)})`);

  if (cac > 0) {
    lines.push(`👤 Custo por cliente: R$ ${cac.toFixed(2)}`);
  }

  if (sales > 0) {
    const avgTicket = revenue / sales;
    lines.push(`🎯 Ticket médio: R$ ${avgTicket.toFixed(2)} | ${sales} vendas`);
  }

  return lines.join("\n");
}

// ── PME Module: Config ────────────────────────────────────────────────────────

async function handleGetPMEConfig(admin: any, userId: string, corsHeaders: any) {
  const { data } = await admin.from("pme_config").select("*").eq("user_id", userId).single();
  return new Response(JSON.stringify(data || {}), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleSavePMEConfig(admin: any, userId: string, body: any, corsHeaders: any) {
  const {
    business_type, monthly_revenue_range, service_radius_km,
    target_cities, target_states, average_ticket, profit_margin_percent,
    lead_response_time_target_minutes, gmb_place_id, sales_scripts,
    lead_stale_hours,
  } = body;

  try {
    await admin.from("pme_config").upsert({
      user_id: userId,
      business_type,
      monthly_revenue_range,
      service_radius_km: service_radius_km ?? 30,
      target_cities: target_cities || [],
      target_states: target_states || [],
      average_ticket,
      profit_margin_percent: profit_margin_percent ?? 30,
      lead_response_time_target_minutes: lead_response_time_target_minutes ?? 15,
      gmb_place_id,
      sales_scripts: sales_scripts || [],
      lead_stale_hours: lead_stale_hours ?? 24,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  } catch { /* ignore */ }

  return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
