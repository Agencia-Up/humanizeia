import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ====================== DIAGNOSTIC TREE ======================

interface DiagnosticRule {
  symptom: string;
  metric: string;
  threshold: number;
  comparison: "below" | "above";
  stage: string;
  diagnoses: {
    problem: string;
    cause: string;
    severity: "low" | "medium" | "high" | "critical";
    category: string;
    actions: { title: string; action_type: string; description: string; impact: string }[];
    secondaryCheck?: { metric: string; comparison: "below" | "above"; threshold: number };
  }[];
}

const DIAGNOSTIC_TREE: DiagnosticRule[] = [
  {
    symptom: "CTR Baixo",
    metric: "ctr",
    threshold: 1.0,
    comparison: "below",
    stage: "topo",
    diagnoses: [
      {
        problem: "CTR abaixo do benchmark",
        cause: "Criativo fraco ou desalinhado com o público",
        severity: "high",
        category: "creative",
        actions: [
          { title: "Criar novos criativos", action_type: "create_creative", description: "Testar 3-5 novos criativos com hooks diferentes", impact: "+30-50% CTR esperado" },
          { title: "Testar novos ângulos de copy", action_type: "update_copy", description: "Reescrever headlines focando em dores e desejos", impact: "+20-40% CTR esperado" },
        ],
        secondaryCheck: { metric: "frequency", comparison: "above", threshold: 3 },
      },
      {
        problem: "Público desalinhado",
        cause: "Segmentação muito ampla ou errada",
        severity: "medium",
        category: "audience",
        actions: [
          { title: "Refinar público-alvo", action_type: "update_audience", description: "Criar lookalike de compradores ou leads qualificados", impact: "+25% CTR esperado" },
          { title: "Testar interesses específicos", action_type: "test_audience", description: "Segmentar por interesses de nicho relacionados", impact: "+15-30% CTR esperado" },
        ],
      },
    ],
  },
  {
    symptom: "CPA Alto",
    metric: "cpa",
    threshold: 100,
    comparison: "above",
    stage: "fundo",
    diagnoses: [
      {
        problem: "CPA acima do target",
        cause: "Funil de conversão quebrado ou Landing Page ineficiente",
        severity: "high",
        category: "funnel",
        actions: [
          { title: "Revisar Landing Page", action_type: "review_landing_page", description: "Verificar velocidade, CTA, formulário e prova social", impact: "-20-40% CPA esperado" },
          { title: "Ativar CAPI", action_type: "enable_capi", description: "Configurar Conversions API para melhorar atribuição", impact: "-15-25% CPA esperado" },
        ],
      },
      {
        problem: "Lead desqualificado convertendo",
        cause: "Copy atraindo público errado",
        severity: "medium",
        category: "copy",
        actions: [
          { title: "Qualificar copy", action_type: "update_copy", description: "Adicionar qualificadores na copy para filtrar leads ruins", impact: "-20% CPA esperado" },
        ],
      },
    ],
  },
  {
    symptom: "Frequência Alta",
    metric: "frequency",
    threshold: 3.0,
    comparison: "above",
    stage: "topo",
    diagnoses: [
      {
        problem: "Criativo fatigado",
        cause: "Público já viu o anúncio muitas vezes",
        severity: "high",
        category: "creative",
        actions: [
          { title: "Rotacionar criativos", action_type: "rotate_creative", description: "Substituir criativos com frequência >3 por novos", impact: "Restaurar CTR original" },
          { title: "Expandir público", action_type: "expand_audience", description: "Ampliar segmentação ou criar novos públicos", impact: "-30% frequência" },
        ],
      },
    ],
  },
  {
    symptom: "CPM Alto",
    metric: "cpm",
    threshold: 40,
    comparison: "above",
    stage: "topo",
    diagnoses: [
      {
        problem: "CPM acima do benchmark",
        cause: "Alta competição no leilão ou público premium",
        severity: "medium",
        category: "budget",
        actions: [
          { title: "Ajustar horários de veiculação", action_type: "schedule_ads", description: "Concentrar budget nos horários com menor competição", impact: "-15-25% CPM" },
          { title: "Testar placements alternativos", action_type: "test_placements", description: "Adicionar Stories, Reels e Audience Network", impact: "-20% CPM médio" },
        ],
      },
    ],
  },
  {
    symptom: "ROAS Baixo",
    metric: "roas",
    threshold: 2.0,
    comparison: "below",
    stage: "fundo",
    diagnoses: [
      {
        problem: "ROAS abaixo do target",
        cause: "Atribuição incompleta ou produto errado sendo promovido",
        severity: "critical",
        category: "revenue",
        actions: [
          { title: "Ativar CAPI completo", action_type: "enable_capi", description: "Configurar server-side tracking para capturar todas as conversões", impact: "+20-50% ROAS atribuído" },
          { title: "Promover bestseller", action_type: "update_product", description: "Focar budget no produto com maior margem e conversão", impact: "+30% ROAS" },
          { title: "Revisar estratégia de preço", action_type: "review_pricing", description: "Ajustar oferta e ticket médio para melhorar retorno", impact: "+15-25% ROAS" },
        ],
      },
    ],
  },
  {
    symptom: "Taxa de Conversão Baixa",
    metric: "conversion_rate",
    threshold: 2.0,
    comparison: "below",
    stage: "meio",
    diagnoses: [
      {
        problem: "Conversão baixa no funil",
        cause: "Desconexão entre anúncio e página de destino",
        severity: "high",
        category: "funnel",
        actions: [
          { title: "Alinhar mensagem", action_type: "align_message", description: "Garantir que a LP entrega o que o anúncio promete", impact: "+30% conversão" },
          { title: "Adicionar prova social", action_type: "add_social_proof", description: "Depoimentos, cases e números na LP", impact: "+20% conversão" },
        ],
      },
    ],
  },
];

// ====================== HEALTH SCORE CALCULATION ======================

interface MetricData {
  ctr?: number;
  cpa?: number;
  cpm?: number;
  roas?: number;
  frequency?: number;
  conversion_rate?: number;
  spend?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
}

function calculateHealthScore(metrics: MetricData, benchmarks: Record<string, number>): number {
  let score = 100;
  const deductions: { reason: string; points: number }[] = [];

  // CTR check
  if (metrics.ctr !== undefined && benchmarks.ctr) {
    const ratio = metrics.ctr / benchmarks.ctr;
    if (ratio < 0.5) { deductions.push({ reason: "CTR crítico", points: 25 }); }
    else if (ratio < 0.75) { deductions.push({ reason: "CTR baixo", points: 15 }); }
    else if (ratio < 1.0) { deductions.push({ reason: "CTR abaixo benchmark", points: 5 }); }
  }

  // CPA check
  if (metrics.cpa !== undefined && benchmarks.cpa) {
    const ratio = metrics.cpa / benchmarks.cpa;
    if (ratio > 2.0) { deductions.push({ reason: "CPA crítico", points: 25 }); }
    else if (ratio > 1.5) { deductions.push({ reason: "CPA alto", points: 15 }); }
    else if (ratio > 1.2) { deductions.push({ reason: "CPA acima benchmark", points: 5 }); }
  }

  // Frequency check
  if (metrics.frequency !== undefined && metrics.frequency > 4) {
    deductions.push({ reason: "Frequência muito alta", points: 20 });
  } else if (metrics.frequency !== undefined && metrics.frequency > 3) {
    deductions.push({ reason: "Frequência alta", points: 10 });
  }

  // ROAS check
  if (metrics.roas !== undefined && benchmarks.roas) {
    const ratio = metrics.roas / benchmarks.roas;
    if (ratio < 0.3) { deductions.push({ reason: "ROAS crítico", points: 30 }); }
    else if (ratio < 0.6) { deductions.push({ reason: "ROAS baixo", points: 15 }); }
    else if (ratio < 0.9) { deductions.push({ reason: "ROAS abaixo benchmark", points: 5 }); }
  }

  // CPM check
  if (metrics.cpm !== undefined && benchmarks.cpm) {
    const ratio = metrics.cpm / benchmarks.cpm;
    if (ratio > 2.0) { deductions.push({ reason: "CPM muito alto", points: 15 }); }
    else if (ratio > 1.5) { deductions.push({ reason: "CPM alto", points: 8 }); }
  }

  for (const d of deductions) {
    score -= d.points;
  }

  return Math.max(0, Math.min(100, score));
}

function classifyStage(metrics: MetricData): string {
  if (!metrics.conversions && !metrics.clicks) return "topo";
  if (metrics.conversions && metrics.conversions > 0) return "fundo";
  if (metrics.clicks && metrics.clicks > 0) return "meio";
  return "topo";
}

// ====================== MAIN HANDLER ======================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { user_id, campaign_id, metrics, action } = body;

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: run full diagnostic
    if (action === "diagnose" || !action) {
      return await runDiagnostic(supabase, user_id, campaign_id, metrics);
    }

    // Action: get summary
    if (action === "summary") {
      return await getSummary(supabase, user_id);
    }

    // Action: execute recommendation
    if (action === "execute_recommendation") {
      const { recommendation_id } = body;
      return await executeRecommendation(supabase, user_id, recommendation_id);
    }

    // Action: dismiss alert
    if (action === "dismiss_alert") {
      const { alert_id } = body;
      await supabase.from("apollo_alerts").update({ is_dismissed: true }).eq("id", alert_id).eq("user_id", user_id);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[apollo-analyze] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function runDiagnostic(supabase: any, userId: string, campaignId: string | null, metricsInput: MetricData | null) {
  // Get benchmarks
  const { data: userBenchmarks } = await supabase
    .from("apollo_benchmarks")
    .select("*")
    .eq("user_id", userId);

  const benchmarks: Record<string, number> = {
    ctr: 1.5,
    cpa: 50,
    cpm: 25,
    roas: 3.0,
    frequency: 3.0,
    conversion_rate: 3.0,
  };

  // Override with user benchmarks
  if (userBenchmarks?.length) {
    for (const b of userBenchmarks) {
      benchmarks[b.metric_name] = b.benchmark_value;
    }
  }

  // Get metrics from campaigns if not provided
  let metrics: MetricData = metricsInput || {};
  if (!metricsInput && campaignId) {
    const { data: campaignMetrics } = await supabase
      .from("campaign_metrics")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("date", { ascending: false })
      .limit(7);

    if (campaignMetrics?.length) {
      const totals = campaignMetrics.reduce((acc: any, m: any) => ({
        spend: (acc.spend || 0) + (m.spend || 0),
        impressions: (acc.impressions || 0) + (m.impressions || 0),
        clicks: (acc.clicks || 0) + (m.clicks || 0),
        conversions: (acc.conversions || 0) + (m.conversions || 0),
        conversion_value: (acc.conversion_value || 0) + (m.conversion_value || 0),
      }), {});

      metrics = {
        ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
        cpa: totals.conversions > 0 ? totals.spend / totals.conversions : 0,
        cpm: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0,
        roas: totals.spend > 0 ? totals.conversion_value / totals.spend : 0,
        spend: totals.spend,
        impressions: totals.impressions,
        clicks: totals.clicks,
        conversions: totals.conversions,
      };
    }
  }

  // Calculate health score
  const stage = classifyStage(metrics);
  const score = calculateHealthScore(metrics, benchmarks);

  // Get previous score for trend
  const { data: prevScores } = await supabase
    .from("apollo_health_scores")
    .select("score")
    .eq("user_id", userId)
    .order("calculated_at", { ascending: false })
    .limit(1);

  const previousScore = prevScores?.[0]?.score || null;
  const trend = previousScore !== null
    ? score > previousScore ? "up" : score < previousScore ? "down" : "stable"
    : "stable";

  // Save health score
  const { data: healthScore } = await supabase
    .from("apollo_health_scores")
    .insert({
      user_id: userId,
      campaign_id: campaignId || null,
      score,
      stage,
      previous_score: previousScore,
      trend,
      metrics,
    })
    .select()
    .single();

  // Run diagnostic tree
  const diagnostics: any[] = [];
  const recommendations: any[] = [];
  const alerts: any[] = [];

  for (const rule of DIAGNOSTIC_TREE) {
    const metricValue = (metrics as any)[rule.metric];
    if (metricValue === undefined || metricValue === null) continue;

    let triggered = false;
    if (rule.comparison === "below" && metricValue < rule.threshold) triggered = true;
    if (rule.comparison === "above" && metricValue > rule.threshold) triggered = true;

    if (!triggered) continue;

    for (const diag of rule.diagnoses) {
      // Optional secondary check
      if (diag.secondaryCheck) {
        const secValue = (metrics as any)[diag.secondaryCheck.metric];
        if (secValue !== undefined) {
          const secTriggered = diag.secondaryCheck.comparison === "above"
            ? secValue > diag.secondaryCheck.threshold
            : secValue < diag.secondaryCheck.threshold;
          // If secondary check fails, reduce severity
          if (!secTriggered) continue;
        }
      }

      // Save diagnostic
      const { data: savedDiag } = await supabase
        .from("apollo_diagnostics")
        .insert({
          user_id: userId,
          campaign_id: campaignId || null,
          health_score_id: healthScore?.id || null,
          stage: rule.stage,
          severity: diag.severity,
          category: diag.category,
          problem: diag.problem,
          cause: diag.cause,
          diagnosis: `${rule.symptom}: ${diag.problem}`,
          evidence: { metric: rule.metric, value: metricValue, threshold: rule.threshold, benchmarks },
        })
        .select()
        .single();

      diagnostics.push(savedDiag);

      // Save recommendations
      for (const action of diag.actions) {
        const { data: savedRec } = await supabase
          .from("apollo_recommendations")
          .insert({
            user_id: userId,
            campaign_id: campaignId || null,
            diagnostic_id: savedDiag?.id || null,
            title: action.title,
            description: action.description,
            action_type: action.action_type,
            impact_estimate: action.impact,
            priority: diag.severity === "critical" ? 1 : diag.severity === "high" ? 3 : diag.severity === "medium" ? 5 : 7,
            status: "pending",
          })
          .select()
          .single();
        recommendations.push(savedRec);
      }

      // Create alert for high/critical
      if (diag.severity === "high" || diag.severity === "critical") {
        const { data: savedAlert } = await supabase
          .from("apollo_alerts")
          .insert({
            user_id: userId,
            campaign_id: campaignId || null,
            diagnostic_id: savedDiag?.id || null,
            level: diag.severity === "critical" ? "critical" : "warning",
            title: rule.symptom,
            description: `${diag.problem}: ${diag.cause}`,
            metric: rule.metric,
            current_value: String(metricValue),
            benchmark_value: String(rule.threshold),
            deviation: String(((metricValue - rule.threshold) / rule.threshold * 100).toFixed(1)) + "%",
            actions: diag.actions.map(a => a.title),
          })
          .select()
          .single();
        alerts.push(savedAlert);
      }
    }
  }

  // Save learning if we found issues
  if (diagnostics.length > 0) {
    await supabase.from("apollo_learning").insert({
      user_id: userId,
      category: "diagnostic",
      insight: `Diagnóstico encontrou ${diagnostics.length} problema(s): ${diagnostics.map(d => d.problem).join(", ")}`,
      confidence: 0.8,
      source_campaigns: campaignId ? [campaignId] : [],
      evidence: { metrics, diagnostics_count: diagnostics.length, score },
    });
  }

  return new Response(JSON.stringify({
    health_score: { score, stage, trend, previous_score: previousScore },
    diagnostics,
    recommendations,
    alerts,
    metrics,
    benchmarks,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getSummary(supabase: any, userId: string) {
  const [healthRes, diagRes, recRes, alertRes] = await Promise.all([
    supabase.from("apollo_health_scores").select("*").eq("user_id", userId).order("calculated_at", { ascending: false }).limit(5),
    supabase.from("apollo_diagnostics").select("*").eq("user_id", userId).eq("is_resolved", false).order("created_at", { ascending: false }).limit(20),
    supabase.from("apollo_recommendations").select("*").eq("user_id", userId).eq("status", "pending").order("priority", { ascending: true }).limit(10),
    supabase.from("apollo_alerts").select("*").eq("user_id", userId).eq("is_dismissed", false).order("created_at", { ascending: false }).limit(10),
  ]);

  return new Response(JSON.stringify({
    health_scores: healthRes.data || [],
    diagnostics: diagRes.data || [],
    recommendations: recRes.data || [],
    alerts: alertRes.data || [],
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function executeRecommendation(supabase: any, userId: string, recommendationId: string) {
  const { data: rec } = await supabase
    .from("apollo_recommendations")
    .select("*")
    .eq("id", recommendationId)
    .eq("user_id", userId)
    .single();

  if (!rec) {
    return new Response(JSON.stringify({ error: "Recommendation not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Log the action
  await supabase.from("apollo_action_log").insert({
    user_id: userId,
    campaign_id: rec.campaign_id,
    recommendation_id: recommendationId,
    action_type: rec.action_type,
    action_details: { title: rec.title, description: rec.description },
    before_state: {},
    success: true,
    executed_by: "user",
  });

  // Mark recommendation as executed
  await supabase.from("apollo_recommendations").update({
    status: "executed",
    executed_at: new Date().toISOString(),
    result: "Ação executada pelo usuário",
  }).eq("id", recommendationId);

  // Resolve related diagnostic
  if (rec.diagnostic_id) {
    await supabase.from("apollo_diagnostics").update({
      is_resolved: true,
      resolved_at: new Date().toISOString(),
    }).eq("id", rec.diagnostic_id);
  }

  return new Response(JSON.stringify({ ok: true, action_type: rec.action_type }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
