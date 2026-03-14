import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatMultiplier(value: number): string {
  return `${value.toFixed(2)}x`;
}

function formatMetricValue(value: number, formato: string): string {
  switch (formato) {
    case "currency": return formatCurrency(value);
    case "number": return formatNumber(value);
    case "percent": return formatPercent(value);
    case "multiplier": return formatMultiplier(value);
    default: return String(value);
  }
}

interface MetaInsightsData {
  spend: number;
  purchases: number;
  revenue: number;
  cpa: number;
  roas: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  frequency: number;
  impressions: number;
  clicks: number;
  campaigns: { name: string; purchases: number; cpa: number }[];
}

async function fetchMetaAdsData(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<MetaInsightsData> {
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: adAccount, error: accountError } = await adminClient
    .from("ad_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", "meta")
    .eq("is_active", true)
    .limit(1)
    .single();

  if (accountError || !adAccount) {
    throw new Error("NO_ACCOUNT: Nenhuma conta Meta Ads ativa encontrada.");
  }

  const accessToken = adAccount.access_token_encrypted;
  if (!accessToken) {
    throw new Error("NO_TOKEN: Token de acesso não encontrado.");
  }

  // Fetch account-level insights for today
  const insightsUrl = new URL(`${META_GRAPH_URL}/act_${adAccount.account_id}/insights`);
  insightsUrl.searchParams.set("access_token", accessToken);
  insightsUrl.searchParams.set("date_preset", "today");
  insightsUrl.searchParams.set("fields", "spend,impressions,clicks,ctr,cpc,cpm,actions,cost_per_action_type,action_values,frequency,reach");

  const insightsRes = await fetch(insightsUrl.toString());
  const insightsData = await insightsRes.json();

  if (insightsData.error) {
    throw new Error(`META_API_ERROR: ${insightsData.error.message}`);
  }

  const row = insightsData.data?.[0] || {};
  const spend = Number(row.spend) || 0;
  const impressions = Number(row.impressions) || 0;
  const clicks = Number(row.clicks) || 0;
  const ctr = Number(row.ctr) || 0;
  const cpc = Number(row.cpc) || 0;
  const cpm = Number(row.cpm) || 0;
  const reach = Number(row.reach) || 0;
  const frequency = Number(row.frequency) || 0;

  const purchaseAction = (row.actions || []).find((a: any) => a.action_type === "purchase");
  const purchases = Number(purchaseAction?.value) || 0;

  const revenueAction = (row.action_values || []).find((a: any) => a.action_type === "purchase");
  const revenue = Number(revenueAction?.value) || 0;

  const cpa = purchases > 0 ? spend / purchases : 0;
  const roas = spend > 0 ? revenue / spend : 0;

  // Fetch campaign-level breakdown (top 5 by spend)
  const campaignUrl = new URL(`${META_GRAPH_URL}/act_${adAccount.account_id}/insights`);
  campaignUrl.searchParams.set("access_token", accessToken);
  campaignUrl.searchParams.set("date_preset", "today");
  campaignUrl.searchParams.set("fields", "campaign_name,spend,actions,cost_per_action_type");
  campaignUrl.searchParams.set("level", "campaign");
  campaignUrl.searchParams.set("sort", "spend_descending");
  campaignUrl.searchParams.set("limit", "5");

  const campRes = await fetch(campaignUrl.toString());
  const campData = await campRes.json();

  const campaigns = (campData.data || []).map((c: any) => {
    const cPurchases = Number((c.actions || []).find((a: any) => a.action_type === "purchase")?.value) || 0;
    const cSpend = Number(c.spend) || 0;
    return {
      name: c.campaign_name,
      purchases: cPurchases,
      cpa: cPurchases > 0 ? cSpend / cPurchases : 0,
    };
  }).filter((c: any) => c.purchases > 0);

  return { spend, purchases, revenue, cpa, roas, ctr, cpc, cpm, reach, frequency, impressions, clicks, campaigns };
}

function buildReportMessage(
  template: any,
  data: MetaInsightsData,
): string {
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const monthName = monthNames[now.getMonth()];

  let header = (template.header_template || "📊 *Report Meta Ads — {{data}}*")
    .replace(/\{\{data\}\}/g, dateStr)
    .replace(/\{\{mes\}\}/g, monthName);

  const metricas = template.metricas || [];
  const lines: string[] = [header, ""];

  for (const m of metricas) {
    if (m.tipo === "campaign_breakdown") {
      if (data.campaigns.length > 0) {
        lines.push("");
        lines.push("🎯 *Top Campanhas*");
        data.campaigns.forEach((c, i) => {
          lines.push(`  ${i + 1}. ${c.name}: ${c.purchases} compras | CPA ${formatCurrency(c.cpa)}`);
        });
      }
      continue;
    }

    const metricMap: Record<string, number> = {
      spend: data.spend,
      purchases: data.purchases,
      revenue: data.revenue,
      cpa: data.cpa,
      roas: data.roas,
      ctr: data.ctr,
      cpc: data.cpc,
      cpm: data.cpm,
      reach: data.reach,
      frequency: data.frequency,
      impressions: data.impressions,
      clicks: data.clicks,
    };

    const value = metricMap[m.tipo];
    if (value !== undefined) {
      lines.push(`${m.emoji || "📊"} ${m.label || m.tipo}: ${formatMetricValue(value, m.formato || "number")}`);
    }
  }

  lines.push("");
  lines.push(template.footer_template || "✅ Report gerado por Apollo AI");

  return lines.join("\n");
}

async function sendWhatsApp(
  config: any,
  numero: string,
  message: string,
): Promise<void> {
  const evolutionUrl = `${config.api_url.replace(/\/$/, "")}/message/sendText/${config.instance_name}`;
  const res = await fetch(evolutionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.api_key },
    body: JSON.stringify({ number: numero, text: message }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Evolution API [${res.status}]: ${JSON.stringify(errData)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const body = await req.json();
    const { action, template_id, user_id: bodyUserId, destinatario_ids } = body;

    let userId: string;

    // Support both authenticated calls (manual) and service calls (cron via service role key)
    const authHeader = req.headers.get("Authorization");
    const bearerToken = authHeader?.replace("Bearer ", "") || "";
    
    if (authHeader?.startsWith("Bearer ") && bearerToken !== serviceRoleKey) {
      // User JWT - validate properly
      const supabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: corsHeaders,
        });
      }
      userId = userData.user.id;
    } else if (bearerToken === serviceRoleKey && bodyUserId) {
      // Internal service-role call (cron) - trust user_id from body
      userId = bodyUserId;
    } else {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders,
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // ── Action: cron_check — called by pg_cron every hour ──
    if (action === "cron_check") {
      const now = new Date();
      const currentHour = `${String(now.getHours()).padStart(2, "0")}:00`;
      const currentDay = now.getDay(); // 0=Sunday

      const { data: templates, error: tplError } = await adminClient
        .from("report_templates")
        .select("*, report_template_destinatarios(destinatario_id)")
        .eq("agendamento_ativo", true)
        .eq("ativo", true);

      if (tplError) throw tplError;

      const results: any[] = [];
      for (const tpl of templates || []) {
        const tplHour = (tpl.horario_envio || "08:00").substring(0, 5);
        const tplDays: number[] = tpl.dias_envio || [1, 2, 3, 4, 5];

        if (tplHour !== currentHour || !tplDays.includes(currentDay)) continue;

        try {
          const metaData = await fetchMetaAdsData(supabaseUrl, serviceRoleKey, tpl.user_id);
          const message = buildReportMessage(tpl, metaData);

          // Get destinatarios
          const destIds = (tpl.report_template_destinatarios || []).map((d: any) => d.destinatario_id);
          if (destIds.length === 0) continue;

          const { data: dests } = await adminClient
            .from("whatsapp_destinatarios")
            .select("*")
            .in("id", destIds)
            .eq("ativo", true);

          // Get WhatsApp config
          const { data: whatsConfig } = await adminClient
            .from("whatsapp_config")
            .select("*")
            .eq("user_id", tpl.user_id)
            .eq("is_active", true)
            .maybeSingle();

          if (!whatsConfig) continue;

          for (const dest of dests || []) {
            try {
              await sendWhatsApp(whatsConfig, dest.numero, message);
              await adminClient.from("historico_reports").insert({
                user_id: tpl.user_id,
                template_id: tpl.id,
                status: "sucesso",
                canal: "whatsapp",
                mensagem: message,
                detalhes: { destinatario: dest.nome, numero: dest.numero },
              });
            } catch (sendErr: any) {
              await adminClient.from("historico_reports").insert({
                user_id: tpl.user_id,
                template_id: tpl.id,
                status: "erro",
                canal: "whatsapp",
                mensagem: message,
                detalhes: { destinatario: dest.nome, error: sendErr.message },
              });
            }
          }
          results.push({ template: tpl.nome, sent: true });
        } catch (err: any) {
          results.push({ template: tpl.nome, error: err.message });
        }
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Action: send_manual — triggered by user ──
    if (action === "send_manual") {
      if (!template_id) {
        return new Response(JSON.stringify({ error: "template_id é obrigatório" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const { data: template } = await adminClient
        .from("report_templates")
        .select("*")
        .eq("id", template_id)
        .eq("user_id", userId)
        .single();

      if (!template) {
        return new Response(JSON.stringify({ error: "Template não encontrado" }), {
          status: 404, headers: corsHeaders,
        });
      }

      const metaData = await fetchMetaAdsData(supabaseUrl, serviceRoleKey, userId);
      const message = buildReportMessage(template, metaData);

      // Get destinatarios
      let destIds = destinatario_ids;
      if (!destIds || destIds.length === 0) {
        const { data: links } = await adminClient
          .from("report_template_destinatarios")
          .select("destinatario_id")
          .eq("template_id", template_id);
        destIds = (links || []).map((l: any) => l.destinatario_id);
      }

      if (!destIds || destIds.length === 0) {
        return new Response(JSON.stringify({ error: "Nenhum destinatário selecionado" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const { data: dests } = await adminClient
        .from("whatsapp_destinatarios")
        .select("*")
        .in("id", destIds)
        .eq("ativo", true);

      const { data: whatsConfig } = await adminClient
        .from("whatsapp_config")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (!whatsConfig) {
        return new Response(JSON.stringify({ error: "WhatsApp não configurado" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const results: any[] = [];
      for (const dest of dests || []) {
        try {
          await sendWhatsApp(whatsConfig, dest.numero, message);
          await adminClient.from("historico_reports").insert({
            user_id: userId,
            template_id: template.id,
            status: "sucesso",
            canal: "whatsapp",
            mensagem: message,
            detalhes: { destinatario: dest.nome, numero: dest.numero },
          });
          results.push({ destinatario: dest.nome, status: "sucesso" });
        } catch (sendErr: any) {
          await adminClient.from("historico_reports").insert({
            user_id: userId,
            template_id: template.id,
            status: "erro",
            canal: "whatsapp",
            mensagem: message,
            detalhes: { destinatario: dest.nome, error: sendErr.message },
          });
          results.push({ destinatario: dest.nome, status: "erro", error: sendErr.message });
        }
      }

      return new Response(JSON.stringify({ success: true, message, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Action: preview — returns formatted message without sending ──
    if (action === "preview") {
      if (!template_id) {
        return new Response(JSON.stringify({ error: "template_id é obrigatório" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const { data: template } = await adminClient
        .from("report_templates")
        .select("*")
        .eq("id", template_id)
        .eq("user_id", userId)
        .single();

      if (!template) {
        return new Response(JSON.stringify({ error: "Template não encontrado" }), {
          status: 404, headers: corsHeaders,
        });
      }

      const metaData = await fetchMetaAdsData(supabaseUrl, serviceRoleKey, userId);
      const message = buildReportMessage(template, metaData);

      return new Response(JSON.stringify({ success: true, message, data: metaData }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Ação inválida. Use: send_manual, preview, cron_check" }), {
      status: 400, headers: corsHeaders,
    });
  } catch (err: any) {
    console.error("Error in enviar-report-midas:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
});
