import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";

/**
 * apollo-measure-outcomes
 *
 * Runs daily at 06:00 UTC (called by apollo-cron-runner).
 * Finds action_log entries older than 7 days with no outcome yet.
 * Fetches current Meta metrics and computes improvement scores.
 * Writes to apollo_action_outcomes and aggregates to apollo_learning.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Find outcomes that need "after" metrics filled in
  const { data: pendingOutcomes } = await admin
    .from("apollo_action_outcomes")
    .select("*, apollo_action_log!inner(campaign_id, executed_at)")
    .is("after_ctr", null)
    .lt("created_at", sevenDaysAgo.toISOString())
    .limit(50);

  if (!pendingOutcomes?.length) {
    return new Response(JSON.stringify({ message: "No pending outcomes to measure", count: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  let measured = 0;

  for (const outcome of pendingOutcomes) {
    try {
      // Get the user's Meta account
      const { data: account } = await admin
        .from("ad_accounts")
        .select("access_token_encrypted, account_id")
        .eq("user_id", outcome.user_id)
        .eq("platform", "meta")
        .eq("is_active", true)
        .single();

      if (!account?.access_token_encrypted) continue;

      // Fetch current metrics for the campaign
      const url = new URL(`${META_GRAPH_URL}/${outcome.campaign_id_meta}/insights`);
      url.searchParams.set("access_token", account.access_token_encrypted);
      url.searchParams.set("fields", "spend,ctr,cpc,cpm,impressions,clicks,reach,frequency,actions,action_values");
      url.searchParams.set("date_preset", "last_7d");
      const res = await fetch(url.toString());
      const insData = await res.json();
      const afterMetrics = insData.data?.[0];

      if (!afterMetrics) continue;

      const afterCtr = Number(afterMetrics.ctr || 0);
      const afterCpc = Number(afterMetrics.cpc || 0);
      const afterSpend = Number(afterMetrics.spend || 0);
      let afterRoas = 0;
      if (afterMetrics.action_values?.length && afterSpend > 0) {
        const av = afterMetrics.action_values.find((x: any) => x.action_type.includes("purchase"));
        if (av) afterRoas = Number(av.value) / afterSpend;
      }

      // Calculate health improvement score (-100 to +100)
      let improvementScore = 0;
      const before = {
        ctr: outcome.before_ctr || 0,
        cpc: outcome.before_cpc || 0,
        roas: outcome.before_roas || 0,
      };

      if (before.ctr > 0) improvementScore += Math.min(50, Math.max(-50, ((afterCtr - before.ctr) / before.ctr) * 50));
      if (before.cpc > 0) improvementScore += Math.min(30, Math.max(-30, ((before.cpc - afterCpc) / before.cpc) * 30)); // lower cpc = better
      if (before.roas > 0) improvementScore += Math.min(20, Math.max(-20, ((afterRoas - before.roas) / before.roas) * 20));

      const outcome_verdict =
        improvementScore >= 10 ? "improved" :
        improvementScore <= -10 ? "declined" : "neutral";

      await admin.from("apollo_action_outcomes").update({
        after_ctr: afterCtr,
        after_cpc: afterCpc,
        after_spend: afterSpend,
        after_roas: afterRoas,
        outcome: outcome_verdict,
        improvement_score: Math.round(improvementScore),
        measured_at: new Date().toISOString(),
      }).eq("id", outcome.id);

      // Update apollo_learning with this new data point
      await updateLearningTable(admin, outcome.user_id, outcome.action_type, outcome_verdict, Math.round(improvementScore));

      measured++;
    } catch (err) {
      console.error("[apollo-measure-outcomes] error for outcome", outcome.id, err);
    }
  }

  return new Response(JSON.stringify({ message: "Outcomes measured", count: measured }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});

async function updateLearningTable(admin: any, userId: string, actionType: string, outcome: string, score: number) {
  // Upsert into apollo_learning — aggregate pattern data
  const { data: existing } = await admin
    .from("apollo_learning")
    .select("*")
    .eq("user_id", userId)
    .eq("pattern_type", `action_outcome_${actionType}`)
    .single();

  if (existing) {
    const newCount = (existing.occurrence_count || 0) + 1;
    const prevAvg = existing.avg_improvement_score || 0;
    const newAvg = ((prevAvg * (newCount - 1)) + score) / newCount;
    const successRate = ((existing.success_count || 0) + (outcome === "improved" ? 1 : 0)) / newCount;

    await admin.from("apollo_learning").update({
      occurrence_count: newCount,
      success_count: (existing.success_count || 0) + (outcome === "improved" ? 1 : 0),
      avg_improvement_score: Math.round(newAvg),
      success_rate: Math.round(successRate * 100),
      last_seen: new Date().toISOString(),
      confidence_score: Math.min(100, Math.round(newCount * 5)), // more data = more confidence
    }).eq("id", existing.id);
  } else {
    await admin.from("apollo_learning").insert({
      user_id: userId,
      pattern_type: `action_outcome_${actionType}`,
      description: `Resultado de executar ação "${actionType}"`,
      occurrence_count: 1,
      success_count: outcome === "improved" ? 1 : 0,
      avg_improvement_score: score,
      success_rate: outcome === "improved" ? 100 : 0,
      confidence_score: 5,
      last_seen: new Date().toISOString(),
    }).catch(() => {});
  }
}
