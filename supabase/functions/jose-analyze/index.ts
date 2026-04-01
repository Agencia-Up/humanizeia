import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * apollo-analyze: Full diagnostic analysis engine
 * 
 * Collects campaign metrics → Calculates health scores → Runs diagnostic tree →
 * Generates recommendations → Creates alerts → Stores learnings
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders,
      });
    }
    const userId = userData.user.id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const { campaign_id, action } = body;

    // ===== Handle specific actions =====
    if (action === "approve_recommendation") {
      return await handleApproveRecommendation(admin, userId, body);
    }
    if (action === "dismiss_alert") {
      return await handleDismissAlert(admin, userId, body);
    }

    // ===== MAIN ANALYSIS FLOW =====

    // Step 1: Collect campaign metrics
    const metrics = await collectMetrics(admin, userId, campaign_id);
    if (!metrics.campaigns.length) {
      return new Response(JSON.stringify({
        status: "no_data",
        message: "Nenhuma campanha ativa encontrada para análise",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 2: Get/set benchmarks
    const benchmarks = await getOrCreateBenchmarks(admin, userId);

    // Step 3: Calculate health scores per stage
    const healthScores = await calculateHealthScores(admin, userId, metrics, benchmarks);

    // Step 4: Run diagnostic tree
    const diagnostics = await runDiagnosticTree(admin, userId, metrics, benchmarks, healthScores);

    // Step 5: Generate AI-powered recommendations
    const recommendations = await generateRecommendations(admin, userId, diagnostics);

    // Step 6: Create alerts for critical issues
    const alerts = await createAlerts(admin, userId, diagnostics, healthScores);

    // Step 7: AI deep analysis with Lovable AI
    let aiAnalysis = null;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (LOVABLE_API_KEY) {
      aiAnalysis = await getAIAnalysis(LOVABLE_API_KEY, metrics, healthScores, diagnostics);
    }

    return new Response(JSON.stringify({
      status: "analyzed",
      overall_score: Math.round(healthScores.reduce((s: number, h: any) => s + h.score, 0) / Math.max(healthScores.length, 1)),
      health_scores: healthScores,
      diagnostics_count: diagnostics.length,
      recommendations_count: recommendations.length,
      alerts_count: alerts.length,
      ai_analysis: aiAnalysis,
      campaigns_analyzed: metrics.campaigns.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[apollo-analyze] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
});

// ====================== METRICS COLLECTION ======================

async function collectMetrics(admin: any, userId: string, campaignId?: string) {
  let query = admin
    .from("campaigns")
    .select("id, name, platform, status, daily_budget, objective, external_id")
    .eq("user_id", userId)
    .in("status", ["active", "paused"]);

  if (campaignId) query = query.eq("id", campaignId);

  const { data: campaigns } = await query;
  if (!campaigns?.length) return { campaigns: [], metrics: [] };

  const campaignIds = campaigns.map((c: any) => c.id);

  // Get last 7 days of metrics
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const { data: metrics } = await admin
    .from("campaign_metrics")
    .select("*")
    .in("campaign_id", campaignIds)
    .gte("date", sevenDaysAgo)
    .order("date", { ascending: false });

  return { campaigns: campaigns || [], metrics: metrics || [] };
}

// ====================== BENCHMARKS ======================

async function getOrCreateBenchmarks(admin: any, userId: string) {
  const { data: existing } = await admin
    .from("apollo_benchmarks")
    .select("*")
    .eq("user_id", userId);

  if (existing?.length > 0) return existing;

  // Create default industry benchmarks
  const defaults = [
    { metric_name: "ctr", stage: "topo", benchmark_value: 1.5, platform: "meta" },
    { metric_name: "ctr", stage: "meio", benchmark_value: 2.0, platform: "meta" },
    { metric_name: "cpc", stage: "topo", benchmark_value: 2.5, platform: "meta" },
    { metric_name: "cpc", stage: "meio", benchmark_value: 3.0, platform: "meta" },
    { metric_name: "cpa", stage: "fundo", benchmark_value: 50, platform: "meta" },
    { metric_name: "roas", stage: "fundo", benchmark_value: 3.0, platform: "meta" },
    { metric_name: "conversion_rate", stage: "fundo", benchmark_value: 2.5, platform: "meta" },
    { metric_name: "frequency", stage: "topo", benchmark_value: 3.0, platform: "meta" },
  ];

  const records = defaults.map((d) => ({
    ...d,
    user_id: userId,
    source: "industry",
  }));

  await admin.from("apollo_benchmarks").insert(records);
  return records;
}

// ====================== HEALTH SCORES ======================

async function calculateHealthScores(admin: any, userId: string, metrics: any, benchmarks: any) {
  const { campaigns, metrics: metricRows } = metrics;
  if (!metricRows.length) return [];

  // Aggregate metrics
  const totals = metricRows.reduce((acc: any, m: any) => {
    acc.spend += Number(m.spend) || 0;
    acc.impressions += Number(m.impressions) || 0;
    acc.clicks += Number(m.clicks) || 0;
    acc.conversions += Number(m.conversions) || 0;
    acc.conversion_value += Number(m.conversion_value) || 0;
    acc.reach += Number(m.reach) || 0;
    return acc;
  }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, reach: 0 });

  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const cpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0;
  const roas = totals.spend > 0 ? totals.conversion_value / totals.spend : 0;
  const frequency = totals.reach > 0 ? totals.impressions / totals.reach : 0;
  const convRate = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;

  const getBenchmark = (metric: string, stage: string) => {
    const b = benchmarks.find((bm: any) => bm.metric_name === metric && bm.stage === stage);
    return b?.benchmark_value || null;
  };

  // Calculate scores per stage
  const stages = [
    {
      stage: "topo",
      score: calculateStageScore(ctr, getBenchmark("ctr", "topo"), frequency, getBenchmark("frequency", "topo")),
      metrics: { ctr, frequency, impressions: totals.impressions, reach: totals.reach },
    },
    {
      stage: "meio",
      score: calculateStageScore(ctr, getBenchmark("ctr", "meio"), cpc, getBenchmark("cpc", "meio"), true),
      metrics: { ctr, cpc, clicks: totals.clicks },
    },
    {
      stage: "fundo",
      score: calculateFundoScore(cpa, getBenchmark("cpa", "fundo"), roas, getBenchmark("roas", "fundo"), convRate, getBenchmark("conversion_rate", "fundo")),
      metrics: { cpa, roas, conversions: totals.conversions, conversion_value: totals.conversion_value, convRate },
    },
    {
      stage: "pos_venda",
      score: roas >= 2 ? Math.min(100, Math.round(roas * 25)) : 30,
      metrics: { roas, ltv_estimate: totals.conversion_value / Math.max(totals.conversions, 1) },
    },
  ];

  // Get previous scores for trend
  const { data: prevScores } = await admin
    .from("apollo_health_scores")
    .select("stage, score")
    .eq("user_id", userId)
    .order("calculated_at", { ascending: false })
    .limit(4);

  const prevMap: Record<string, number> = {};
  for (const ps of (prevScores || [])) {
    if (!prevMap[ps.stage]) prevMap[ps.stage] = ps.score;
  }

  const records = stages.map((s) => ({
    user_id: userId,
    stage: s.stage,
    score: Math.round(Math.max(0, Math.min(100, s.score))),
    previous_score: prevMap[s.stage] ?? null,
    metrics: s.metrics,
    trend: prevMap[s.stage] !== undefined
      ? s.score > prevMap[s.stage] + 5 ? "up" : s.score < prevMap[s.stage] - 5 ? "down" : "stable"
      : "stable",
    calculated_at: new Date().toISOString(),
  }));

  await admin.from("apollo_health_scores").insert(records);
  return records;
}

function calculateStageScore(ctr: number, ctrBench: number | null, secondary: number, secBench: number | null, invertSecondary = false) {
  let score = 50;
  if (ctrBench && ctr > 0) {
    const ratio = ctr / ctrBench;
    score = Math.min(100, Math.round(ratio * 50));
  }
  if (secBench && secondary > 0) {
    const ratio = invertSecondary ? secBench / secondary : secondary / secBench;
    const secScore = Math.min(100, Math.round(ratio * 50));
    score = Math.round((score + secScore) / 2);
  }
  return score;
}

function calculateFundoScore(cpa: number, cpaBench: number | null, roas: number, roasBench: number | null, convRate: number, convBench: number | null) {
  let scores: number[] = [];
  if (cpaBench && cpa > 0) scores.push(Math.min(100, Math.round((cpaBench / cpa) * 50)));
  if (roasBench && roas > 0) scores.push(Math.min(100, Math.round((roas / roasBench) * 50)));
  if (convBench && convRate > 0) scores.push(Math.min(100, Math.round((convRate / convBench) * 50)));
  return scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b) / scores.length) : 50;
}

// ====================== DIAGNOSTIC TREE ======================

async function runDiagnosticTree(admin: any, userId: string, metrics: any, benchmarks: any, healthScores: any) {
  const diagnostics: any[] = [];
  const { metrics: metricRows, campaigns } = metrics;

  if (!metricRows.length) return diagnostics;

  const totals = metricRows.reduce((acc: any, m: any) => {
    acc.spend += Number(m.spend) || 0;
    acc.impressions += Number(m.impressions) || 0;
    acc.clicks += Number(m.clicks) || 0;
    acc.conversions += Number(m.conversions) || 0;
    acc.conversion_value += Number(m.conversion_value) || 0;
    acc.reach += Number(m.reach) || 0;
    return acc;
  }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, reach: 0 });

  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const cpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0;
  const roas = totals.spend > 0 ? totals.conversion_value / totals.spend : 0;
  const frequency = totals.reach > 0 ? totals.impressions / totals.reach : 0;
  const convRate = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;

  // === DIAGNOSTIC TREE ===

  // 1. Creative Fatigue: CTR baixo + frequência alta
  if (ctr < 1.0 && frequency > 3.5) {
    diagnostics.push({
      problem: "Fadiga de Criativo Detectada",
      diagnosis: `CTR de ${ctr.toFixed(2)}% abaixo do mínimo e frequência de ${frequency.toFixed(1)} muito alta`,
      cause: "Os mesmos criativos estão sendo exibidos repetidamente para o mesmo público, causando 'banner blindness'",
      stage: "topo",
      severity: "critical",
      category: "creative_fatigue",
      evidence: { ctr, frequency, threshold_ctr: 1.0, threshold_frequency: 3.5 },
    });
  } else if (ctr < 1.5 && frequency > 2.5) {
    diagnostics.push({
      problem: "Sinais de Fadiga de Criativo",
      diagnosis: `CTR de ${ctr.toFixed(2)}% em queda e frequência de ${frequency.toFixed(1)} moderadamente alta`,
      cause: "Criativos começando a perder eficiência com aumento da frequência",
      stage: "topo",
      severity: "high",
      category: "creative_fatigue",
      evidence: { ctr, frequency },
    });
  }

  // 2. Audience Saturation: Frequência alta + CPA subindo
  if (frequency > 4.0) {
    diagnostics.push({
      problem: "Saturação de Audiência",
      diagnosis: `Frequência de ${frequency.toFixed(1)} indica que o público está esgotado`,
      cause: "O público-alvo é muito pequeno ou as campanhas estão rodando há muito tempo sem rotação de audiência",
      stage: "meio",
      severity: "high",
      category: "audience_saturation",
      evidence: { frequency },
    });
  }

  // 3. Budget Waste: Gasto alto + conversões baixas
  if (totals.spend > 100 && totals.conversions === 0) {
    diagnostics.push({
      problem: "Desperdício de Orçamento",
      diagnosis: `R$ ${totals.spend.toFixed(2)} gastos sem nenhuma conversão`,
      cause: "Segmentação incorreta, landing page com problemas ou oferta não atrativa",
      stage: "fundo",
      severity: "critical",
      category: "budget_waste",
      evidence: { spend: totals.spend, conversions: 0 },
    });
  } else if (cpa > 100 && totals.spend > 200) {
    diagnostics.push({
      problem: "CPA Muito Alto",
      diagnosis: `CPA de R$ ${cpa.toFixed(2)} está acima do aceitável`,
      cause: "Funil com vazamento entre clique e conversão. Verificar landing page e proposta de valor",
      stage: "fundo",
      severity: "high",
      category: "budget_waste",
      evidence: { cpa, spend: totals.spend },
    });
  }

  // 4. Landing Page Issue: Cliques altos + conversão baixa
  if (totals.clicks > 100 && convRate < 1.0) {
    diagnostics.push({
      problem: "Problema na Landing Page",
      diagnosis: `${totals.clicks} cliques mas taxa de conversão de apenas ${convRate.toFixed(2)}%`,
      cause: "A landing page não está convertendo. Possíveis causas: tempo de carregamento, formulário longo, falta de prova social, CTA fraco",
      stage: "fundo",
      severity: "high",
      category: "landing_page",
      evidence: { clicks: totals.clicks, convRate },
    });
  }

  // 5. Low ROAS
  if (roas > 0 && roas < 1.5 && totals.spend > 100) {
    diagnostics.push({
      problem: "ROAS Abaixo do Ponto de Equilíbrio",
      diagnosis: `ROAS de ${roas.toFixed(2)}x não cobre custos operacionais`,
      cause: "Valor médio de compra baixo, ticket médio insuficiente ou público frio demais",
      stage: "fundo",
      severity: "critical",
      category: "bid_strategy",
      evidence: { roas, spend: totals.spend, revenue: totals.conversion_value },
    });
  }

  // 6. Good performance detection
  if (roas > 3.0 && ctr > 2.0) {
    diagnostics.push({
      problem: "Performance Excelente 🎉",
      diagnosis: `ROAS de ${roas.toFixed(2)}x e CTR de ${ctr.toFixed(2)}% estão acima dos benchmarks`,
      cause: "Estratégia bem alinhada entre criativo, audiência e oferta",
      stage: "fundo",
      severity: "low",
      category: "performance",
      evidence: { roas, ctr },
    });
  }

  // Save diagnostics
  if (diagnostics.length > 0) {
    const records = diagnostics.map((d) => ({
      user_id: userId,
      ...d,
    }));
    await admin.from("apollo_diagnostics").insert(records);
  }

  return diagnostics;
}

// ====================== RECOMMENDATIONS ======================

async function generateRecommendations(admin: any, userId: string, diagnostics: any[]) {
  const recommendations: any[] = [];

  for (const diag of diagnostics) {
    if (diag.severity === "low") continue; // Skip positive diagnostics

    const recs = getRecommendationsForDiagnostic(diag);
    for (const rec of recs) {
      recommendations.push({
        user_id: userId,
        title: rec.title,
        description: rec.description,
        action_type: rec.action_type,
        action_config: rec.action_config || {},
        priority: diag.severity === "critical" ? 9 : diag.severity === "high" ? 7 : 5,
        impact_estimate: rec.impact_estimate,
      });
    }
  }

  if (recommendations.length > 0) {
    await admin.from("apollo_recommendations").insert(recommendations);
  }
  return recommendations;
}

function getRecommendationsForDiagnostic(diag: any) {
  const recs: any[] = [];

  switch (diag.category) {
    case "creative_fatigue":
      recs.push({
        title: "Renovar criativos",
        description: "Crie 3-5 novos criativos com ângulos diferentes. Teste variações de headline, imagem e CTA.",
        action_type: "change_creative",
        impact_estimate: "CTR pode melhorar 30-50%",
      });
      recs.push({
        title: "Reduzir frequência",
        description: "Aumente o tamanho do público ou reduza o orçamento para diminuir a frequência abaixo de 3x.",
        action_type: "adjust_audience",
        impact_estimate: "Redução de fadiga em 1-2 dias",
      });
      break;

    case "audience_saturation":
      recs.push({
        title: "Expandir audiência",
        description: "Crie Lookalike audiences de 3-5% ou adicione novos interesses para expandir o alcance.",
        action_type: "adjust_audience",
        impact_estimate: "Alcance pode dobrar",
      });
      recs.push({
        title: "Testar novo público",
        description: "Lance um teste A/B com um público completamente novo para encontrar novas oportunidades.",
        action_type: "manual",
        impact_estimate: "Descoberta de novos segmentos lucrativos",
      });
      break;

    case "budget_waste":
      recs.push({
        title: "Pausar campanhas sem conversão",
        description: "Campanhas com gasto significativo e zero conversões devem ser pausadas para análise.",
        action_type: "pause",
        impact_estimate: "Economia imediata do orçamento",
      });
      recs.push({
        title: "Revisar segmentação",
        description: "Verifique se o público está alinhado com o produto. Teste exclusões de audiência.",
        action_type: "adjust_audience",
        impact_estimate: "Melhoria de qualidade dos leads",
      });
      break;

    case "landing_page":
      recs.push({
        title: "Otimizar landing page",
        description: "Reduza tempo de carregamento, simplifique formulário e adicione prova social (depoimentos, números).",
        action_type: "manual",
        impact_estimate: "Taxa de conversão pode melhorar 50-100%",
      });
      break;

    case "bid_strategy":
      recs.push({
        title: "Ajustar estratégia de lance",
        description: "Mude para 'Custo por Resultado' ou 'ROAS Mínimo' para controlar melhor o retorno.",
        action_type: "change_bid",
        impact_estimate: "ROAS pode melhorar 20-40%",
      });
      recs.push({
        title: "Aumentar ticket médio",
        description: "Considere upsell, bundles ou oferta premium para aumentar o valor médio de conversão.",
        action_type: "manual",
        impact_estimate: "Melhoria direta no ROAS",
      });
      break;
  }

  return recs;
}

// ====================== ALERTS ======================

async function createAlerts(admin: any, userId: string, diagnostics: any[], healthScores: any[]) {
  const alerts: any[] = [];

  for (const diag of diagnostics) {
    if (diag.severity === "low") continue;

    alerts.push({
      user_id: userId,
      level: diag.severity === "critical" ? "critical" : "warning",
      title: diag.problem,
      description: diag.diagnosis,
      metric: diag.category,
      current_value: JSON.stringify(diag.evidence),
      actions: diag.category === "creative_fatigue"
        ? ["Renovar criativos", "Ver biblioteca"]
        : diag.category === "budget_waste"
        ? ["Pausar campanha", "Revisar segmentação"]
        : ["Ver detalhes", "Gerar recomendação"],
    });
  }

  // Score drop alerts
  for (const hs of healthScores) {
    if (hs.previous_score && hs.score < hs.previous_score - 15) {
      alerts.push({
        user_id: userId,
        level: "warning",
        title: `Score ${hs.stage} caiu ${hs.previous_score - hs.score} pontos`,
        description: `Health Score do estágio "${hs.stage}" caiu de ${hs.previous_score} para ${hs.score}`,
        metric: "health_score",
        current_value: String(hs.score),
        benchmark_value: String(hs.previous_score),
        deviation: `-${hs.previous_score - hs.score}`,
      });
    }
  }

  if (alerts.length > 0) {
    await admin.from("apollo_alerts").insert(alerts);
  }
  return alerts;
}

// ====================== AI ANALYSIS ======================

async function getAIAnalysis(apiKey: string, metrics: any, healthScores: any, diagnostics: any) {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Você é o Apollo, um agente especialista em tráfego pago e diagnóstico de funis. 
Analise os dados fornecidos e dê um resumo executivo em português brasileiro.
Seja direto, use emojis, e foque em ações práticas. Máximo 300 palavras.
Formato: 
1. Resumo da saúde geral
2. Top 3 problemas prioritários  
3. Top 3 ações recomendadas
4. Previsão para próximos 7 dias`,
          },
          {
            role: "user",
            content: JSON.stringify({
              campaigns_count: metrics.campaigns.length,
              health_scores: healthScores,
              diagnostics: diagnostics.map((d: any) => ({
                problem: d.problem,
                severity: d.severity,
                category: d.category,
              })),
              metrics_summary: {
                total_spend: metrics.metrics.reduce((s: number, m: any) => s + (Number(m.spend) || 0), 0),
                total_conversions: metrics.metrics.reduce((s: number, m: any) => s + (Number(m.conversions) || 0), 0),
                days_analyzed: 7,
              },
            }),
          },
        ],
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      console.error("[apollo-analyze] AI error:", res.status);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("[apollo-analyze] AI analysis error:", err);
    return null;
  }
}

// ====================== ACTION HANDLERS ======================

async function handleApproveRecommendation(admin: any, userId: string, body: any) {
  const { recommendation_id } = body;
  await admin
    .from("apollo_recommendations")
    .update({ status: "approved", executed_at: new Date().toISOString() })
    .eq("id", recommendation_id)
    .eq("user_id", userId);

  await admin.from("apollo_action_log").insert({
    user_id: userId,
    recommendation_id,
    action_type: "approve",
    executed_by: "user",
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleDismissAlert(admin: any, userId: string, body: any) {
  const { alert_id } = body;
  await admin
    .from("apollo_alerts")
    .update({ is_dismissed: true })
    .eq("id", alert_id)
    .eq("user_id", userId);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
