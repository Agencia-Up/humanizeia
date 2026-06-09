import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

type DatePreset = "today" | "yesterday" | "last_7d" | "last_14d" | "last_30d";
type Level = "campaign" | "adset" | "ad";

const AI_CLASSES = new Set(["qualificado", "pouco_qualificado", "inativo"]);
const FEEDBACKS = new Set(["lead_bom", "lead_ruim", "sem_interesse", "nao_respondeu", "agendou", "venda_realizada"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isServiceRoleJwt(token: string): boolean {
  try {
    const [, payload] = token.split(".");
    let normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4;
    if (padding) normalized += "=".repeat(4 - padding);
    const decoded = JSON.parse(atob(normalized));
    return decoded?.role === "service_role";
  } catch {
    return false;
  }
}

function normalizeMetaId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/^act_/, "");
  if (!/^\d{5,30}$/.test(text)) return null;
  return text;
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function parseDatePreset(preset: DatePreset = "last_7d") {
  const today = new Date();
  const yyyyMmDd = (date: Date) => date.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);

  if (preset === "today") return { since: yyyyMmDd(end), until: yyyyMmDd(end) };
  if (preset === "yesterday") {
    start.setUTCDate(start.getUTCDate() - 1);
    return { since: yyyyMmDd(start), until: yyyyMmDd(start) };
  }
  const days = preset === "last_30d" ? 29 : preset === "last_14d" ? 13 : 6;
  start.setUTCDate(start.getUTCDate() - days);
  return { since: yyyyMmDd(start), until: yyyyMmDd(end) };
}

function safeRate(num: number, den: number) {
  return den > 0 ? Number((num / den).toFixed(4)) : 0;
}

function getActionValue(actions: any[] | undefined, predicates: Array<string | RegExp>) {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, action) => {
    const type = String(action?.action_type || "").toLowerCase();
    const matches = predicates.some((predicate) =>
      typeof predicate === "string" ? type === predicate.toLowerCase() : predicate.test(type)
    );
    return matches ? sum + Number(action?.value || 0) : sum;
  }, 0);
}

function metaLeadCount(actions: any[] | undefined) {
  return getActionValue(actions, [
    "lead",
    "onsite_conversion.lead_grouped",
    "onsite_conversion.lead",
    "offsite_conversion.fb_pixel_lead",
    /(^|_)lead($|_)/,
  ]);
}

function conversationCount(actions: any[] | undefined) {
  // SOMENTE "Conversas por mensagem iniciadas" — o resultado que o Facebook
  // exibe na coluna "Resultados". O regex amplo antigo (/onsite_conversion.messaging/)
  // somava TODAS as ações de messaging (primeira resposta, profundidade de
  // conversa, etc.), inflando o número ~3,5x (ex.: 46 em vez de 13). Alinha com
  // o apollo-agent (José), que usa só esta ação.
  return getActionValue(actions, [
    "onsite_conversion.messaging_conversation_started_7d",
  ]);
}

async function getContext(req: Request, body: any) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Unauthorized");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const isSystem = token === serviceRoleKey || isServiceRoleJwt(token);
  if (isSystem) {
    const masterUserId = body?.master_user_id || body?.user_id;
    if (!masterUserId) throw new Error("master_user_id obrigatorio para chamada de sistema");
    return { admin, userId: masterUserId, authUserId: masterUserId, sellerId: null as string | null, isSystem };
  }

  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");

  const { data: seller } = await admin
    .from("ai_team_members")
    .select("id,user_id")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  return {
    admin,
    userId: seller?.user_id || user.id,
    authUserId: user.id,
    sellerId: seller?.id || null,
    isSystem,
  };
}

async function getMetaAccount(admin: any, userId: string, targetAccountId?: string | null) {
  let query = admin
    .from("ad_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", "meta")
    .eq("is_active", true);

  if (targetAccountId) query = query.eq("account_id", targetAccountId);
  const { data: account, error } = await query.order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!account?.access_token_encrypted || !account?.account_id) {
    throw new Error("Conta Meta Ads ativa nao encontrada ou sem token.");
  }
  return {
    row: account,
    accessToken: account.access_token_encrypted,
    accountId: String(account.account_id).replace(/^act_/, ""),
  };
}

async function captureOrigin(admin: any, userId: string, body: any) {
  const leadId = cleanText(body.lead_id);
  const remoteJid = cleanText(body.remote_jid);
  if (!leadId && !remoteJid) throw new Error("lead_id ou remote_jid obrigatorio");

  const metaLeadId = normalizeMetaId(body.meta_lead_id || body.leadgen_id || body.meta?.lead_id);
  const campaignId = normalizeMetaId(body.campaign_id || body.utm_campaign_id || body.meta?.campaign_id);
  const adsetId = normalizeMetaId(body.adset_id || body.utm_adset_id || body.meta?.adset_id);
  const adId = normalizeMetaId(body.ad_id || body.utm_ad_id || body.meta?.ad_id);

  const patch: Record<string, unknown> = {
    meta_lead_id: metaLeadId,
    campaign_id: campaignId,
    campaign_name: cleanText(body.campaign_name || body.utm_campaign || body.meta?.campaign_name),
    adset_id: adsetId,
    adset_name: cleanText(body.adset_name || body.utm_adset || body.meta?.adset_name),
    ad_id: adId,
    ad_name: cleanText(body.ad_name || body.utm_content || body.meta?.ad_name),
    entry_channel: cleanText(body.entry_channel || body.channel || body.source) || "WhatsApp",
    entry_datetime: cleanText(body.entry_datetime) || new Date().toISOString(),
    paid_origin_payload: body,
    updated_at: new Date().toISOString(),
  };

  Object.keys(patch).forEach((key) => patch[key] === null && delete patch[key]);

  let query = admin.from("ai_crm_leads").update(patch).eq("user_id", userId);
  query = leadId ? query.eq("id", leadId) : query.eq("remote_jid", remoteJid);
  const { data, error } = await query.select("id,campaign_id,adset_id,ad_id,status_crm").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Lead nao encontrado para capturar origem.");

  if (AI_CLASSES.has(data.status_crm)) {
    await admin.from("lead_qualifications").upsert({
      user_id: userId,
      lead_id: data.id,
      ai_classification: data.status_crm,
      ai_classification_datetime: new Date().toISOString(),
      campaign_id: data.campaign_id,
      adset_id: data.adset_id,
      ad_id: data.ad_id,
      source: "pedro_origin_capture",
      updated_at: new Date().toISOString(),
    }, { onConflict: "lead_id" });
  }

  return { success: true, lead: data };
}

async function saveSellerFeedback(admin: any, userId: string, sellerId: string | null, body: any) {
  const feedback = cleanText(body.feedback);
  if (!feedback || !FEEDBACKS.has(feedback)) throw new Error("feedback invalido");
  const leadId = cleanText(body.lead_id);
  if (!leadId) throw new Error("lead_id obrigatorio");

  const { data: lead, error: leadErr } = await admin
    .from("ai_crm_leads")
    .select("id,user_id,campaign_id,ad_id,assigned_to_id,assigned_to_member_id")
    .eq("id", leadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (leadErr) throw new Error(leadErr.message);
  if (!lead?.id) throw new Error("Lead nao encontrado");

  const resolvedSellerId = sellerId || body.seller_id || lead.assigned_to_id || lead.assigned_to_member_id || null;
  const { data, error } = await admin.from("seller_feedbacks").upsert({
    user_id: userId,
    lead_id: lead.id,
    campaign_id: lead.campaign_id || normalizeMetaId(body.campaign_id),
    ad_id: lead.ad_id || normalizeMetaId(body.ad_id),
    seller_id: resolvedSellerId,
    feedback,
    notes: cleanText(body.notes),
    datetime: cleanText(body.datetime) || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "lead_id" }).select("*").single();
  if (error) throw new Error(error.message);
  return { success: true, feedback: data };
}

async function fetchInsights(accessToken: string, accountId: string, level: Level, since: string, until: string, daily = true) {
  const fields = [
    "date_start",
    "date_stop",
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "spend",
    "impressions",
    "clicks",
    "actions",
  ].join(",");

  const rows: any[] = [];
  let nextUrl: string | null = null;
  const first = new URL(`${META_GRAPH_URL}/act_${accountId}/insights`);
  first.searchParams.set("access_token", accessToken);
  first.searchParams.set("fields", fields);
  first.searchParams.set("level", level);
  first.searchParams.set("time_range", JSON.stringify({ since, until }));
  // daily=true: uma linha por dia (histórico). daily=false: AGREGADO do período
  // inteiro numa linha por campanha = o número que o Facebook exibe (atribuição
  // deduplicada). Somar as linhas diárias NÃO bate com o agregado do Meta.
  if (daily) first.searchParams.set("time_increment", "1");
  first.searchParams.set("limit", "500");
  nextUrl = first.toString();

  while (nextUrl) {
    const res = await fetch(nextUrl);
    const data = await res.json();
    if (data.error) throw new Error(`Meta API ${level}: ${data.error.message}`);
    rows.push(...(data.data || []));
    nextUrl = data.paging?.next || null;
  }
  return rows;
}

async function syncCosts(admin: any, userId: string, body: any) {
  const { row: account, accessToken, accountId } = await getMetaAccount(admin, userId, body.targetAccountId);
  const { since, until } = body.period_start && body.period_end
    ? { since: body.period_start, until: body.period_end }
    : parseDatePreset((body.date_preset || "today") as DatePreset);

  const levels: Level[] = ["campaign", "adset", "ad"];
  let upserted = 0;
  for (const level of levels) {
    const insights = await fetchInsights(accessToken, accountId, level, since, until);
    const records = insights.map((row) => {
      const entityId = level === "campaign" ? row.campaign_id : level === "adset" ? row.adset_id : row.ad_id;
      return {
        user_id: userId,
        account_id: account.id,
        entity_level: level,
        entity_id: entityId,
        campaign_id: row.campaign_id || null,
        campaign_name: row.campaign_name || null,
        adset_id: row.adset_id || null,
        adset_name: row.adset_name || null,
        ad_id: row.ad_id || null,
        ad_name: row.ad_name || null,
        date: row.date_start,
        spend: Number(row.spend || 0),
        impressions: Number(row.impressions || 0),
        clicks: Number(row.clicks || 0),
        leads_meta: metaLeadCount(row.actions),
        conversations_started: conversationCount(row.actions),
        raw_payload: row,
        updated_at: new Date().toISOString(),
      };
    }).filter((row) => normalizeMetaId(row.entity_id));

    if (records.length > 0) {
      const { error } = await admin
        .from("campaign_costs")
        .upsert(records, { onConflict: "user_id,account_id,entity_level,entity_id,date" });
      if (error) throw new Error(error.message);
      upserted += records.length;
    }
  }

  await admin.from("ad_accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", account.id);
  return { success: true, period: { since, until }, rows: upserted, graph_version: META_GRAPH_VERSION };
}

function aggregate(rows: any[], keyFn: (row: any) => string | null, nameFn: (row: any) => string | null) {
  const map = new Map<string, any>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        name: nameFn(row) || key,
        leads_total: 0,
        leads_qualificados: 0,
        leads_pouco_qualificados: 0,
        leads_inativos: 0,
        feedback_positivo: 0,
        feedback_negativo: 0,
        divergencia_ia_vendedor: 0,
        investimento_total: 0,
        impressions: 0,
        clicks: 0,
        leads_meta: 0,
        conversas_iniciadas: 0,
      });
    }
    const item = map.get(key);
    item.leads_total += Number(row.leads_total || 0);
    item.leads_qualificados += Number(row.leads_qualificados || 0);
    item.leads_pouco_qualificados += Number(row.leads_pouco_qualificados || 0);
    item.leads_inativos += Number(row.leads_inativos || 0);
    item.feedback_positivo += Number(row.feedback_positivo || 0);
    item.feedback_negativo += Number(row.feedback_negativo || 0);
    item.divergencia_ia_vendedor += Number(row.divergencia_ia_vendedor || 0);
    item.investimento_total += Number(row.investimento_total || 0);
    item.impressions += Number(row.impressions || 0);
    item.clicks += Number(row.clicks || 0);
    item.leads_meta += Number(row.leads_meta || 0);
    item.conversas_iniciadas += Number(row.conversas_iniciadas || 0);
  }

  return [...map.values()].map((item) => ({
    ...item,
    taxa_qualificacao: safeRate(item.leads_qualificados, item.leads_total),
    taxa_aproveitamento: safeRate(item.feedback_positivo, item.leads_total),
    conversao: safeRate(item.feedback_positivo, item.leads_total),
    cpl: safeRate(item.investimento_total, item.leads_total),
    custo_por_qualificado: safeRate(item.investimento_total, item.leads_qualificados),
    custo_por_iniciacao_conversa: safeRate(item.investimento_total, item.conversas_iniciadas),
    eficiencia: item.investimento_total > 0 ? Number((item.leads_qualificados / item.investimento_total).toFixed(4)) : 0,
  })).sort((a, b) => b.investimento_total - a.investimento_total);
}

async function buildReport(admin: any, userId: string, body: any, persist = true) {
  const { row: account } = await getMetaAccount(admin, userId, body.targetAccountId).catch(() => ({ row: null }));
  const { since, until } = body.period_start && body.period_end
    ? { since: body.period_start, until: body.period_end }
    : parseDatePreset((body.date_preset || "last_7d") as DatePreset);
  const startAt = new Date(`${since}T00:00:00.000Z`).getTime();
  const endAt = new Date(`${until}T23:59:59.999Z`).getTime();

  const { data: rawLeads, error: leadErr } = await admin
    .from("ai_crm_leads")
    .select("id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,entry_channel,entry_datetime,created_at,status_crm")
    .eq("user_id", userId);
  if (leadErr) throw new Error(leadErr.message);
  const leads = (rawLeads || []).filter((lead: any) => {
    const timestamp = new Date(lead.entry_datetime || lead.created_at).getTime();
    return Number.isFinite(timestamp) && timestamp >= startAt && timestamp <= endAt;
  });

  const leadIds = (leads || []).map((l: any) => l.id);
  const [{ data: quals }, { data: feedbacks }, { data: costs }] = await Promise.all([
    leadIds.length
      ? admin.from("lead_qualifications").select("*").in("lead_id", leadIds)
      : Promise.resolve({ data: [] }),
    leadIds.length
      ? admin.from("seller_feedbacks").select("*").in("lead_id", leadIds)
      : Promise.resolve({ data: [] }),
    admin.from("campaign_costs")
      .select("*")
      .eq("user_id", userId)
      .gte("date", since)
      .lte("date", until),
  ]);

  const qByLead = new Map((quals || []).map((q: any) => [q.lead_id, q]));
  const fByLead = new Map((feedbacks || []).map((f: any) => [f.lead_id, f]));

  const costCampaign = new Map<string, any>();
  const costAdset = new Map<string, any>();
  const costAd = new Map<string, any>();
  for (const cost of costs || []) {
    const map = cost.entity_level === "campaign" ? costCampaign : cost.entity_level === "adset" ? costAdset : costAd;
    const key = cost.entity_id;
    const item = map.get(key) || { spend: 0, impressions: 0, clicks: 0, leads_meta: 0, conversations_started: 0 };
    item.spend += Number(cost.spend || 0);
    item.impressions += Number(cost.impressions || 0);
    item.clicks += Number(cost.clicks || 0);
    item.leads_meta += Number(cost.leads_meta || 0);
    item.conversations_started += Number(cost.conversations_started || 0);
    map.set(key, item);
  }

  const detailRows = (leads || []).map((lead: any) => {
    const q = qByLead.get(lead.id);
    const f = fByLead.get(lead.id);
    const campaignCost = lead.campaign_id ? costCampaign.get(lead.campaign_id) : null;
    const adsetCost = lead.adset_id ? costAdset.get(lead.adset_id) : null;
    const adCost = lead.ad_id ? costAd.get(lead.ad_id) : null;
    const cost = adCost || adsetCost || campaignCost || {};
    const ai = q?.ai_classification || (AI_CLASSES.has(lead.status_crm) ? lead.status_crm : null);
    const fb = f?.feedback || null;
    const feedbackPositive = fb === "agendou" || fb === "venda_realizada";
    const feedbackNegative = fb && !feedbackPositive;
    return {
      lead_id: lead.id,
      campaign_id: lead.campaign_id,
      campaign_name: lead.campaign_name,
      adset_id: lead.adset_id,
      adset_name: lead.adset_name,
      ad_id: lead.ad_id,
      ad_name: lead.ad_name,
      ai_classification: ai,
      seller_feedback: fb,
      leads_total: 1,
      leads_qualificados: ai === "qualificado" ? 1 : 0,
      leads_pouco_qualificados: ai === "pouco_qualificado" ? 1 : 0,
      leads_inativos: ai === "inativo" ? 1 : 0,
      feedback_positivo: feedbackPositive ? 1 : 0,
      feedback_negativo: feedbackNegative ? 1 : 0,
      divergencia_ia_vendedor: ai === "qualificado" && feedbackNegative ? 1 : 0,
      investimento_total: 0,
      impressions: 0,
      clicks: 0,
      leads_meta: 0,
      conversas_iniciadas: 0,
      _cost: cost,
    };
  });

  const campaigns = aggregate(detailRows, (r) => r.campaign_id, (r) => r.campaign_name);
  const adsets = aggregate(detailRows, (r) => r.adset_id, (r) => r.adset_name);
  const ads = aggregate(detailRows, (r) => r.ad_id, (r) => r.ad_name);

  for (const item of campaigns) {
    const c = costCampaign.get(item.id);
    if (!c) continue;
    item.investimento_total = Number(c.spend.toFixed(2));
    item.impressions = c.impressions;
    item.clicks = c.clicks;
    item.leads_meta = c.leads_meta;
    item.conversas_iniciadas = c.conversations_started;
    item.cpl = safeRate(item.investimento_total, item.leads_total);
    item.custo_por_qualificado = safeRate(item.investimento_total, item.leads_qualificados);
    item.custo_por_iniciacao_conversa = safeRate(item.investimento_total, item.conversas_iniciadas);
  }
  for (const item of adsets) {
    const c = costAdset.get(item.id);
    if (c) Object.assign(item, { investimento_total: Number(c.spend.toFixed(2)), impressions: c.impressions, clicks: c.clicks, leads_meta: c.leads_meta, conversas_iniciadas: c.conversations_started });
    item.cpl = safeRate(item.investimento_total, item.leads_total);
    item.custo_por_qualificado = safeRate(item.investimento_total, item.leads_qualificados);
    item.custo_por_iniciacao_conversa = safeRate(item.investimento_total, item.conversas_iniciadas);
    item.eficiencia = item.investimento_total > 0 ? Number((item.leads_qualificados / item.investimento_total).toFixed(4)) : 0;
  }
  for (const item of ads) {
    const c = costAd.get(item.id);
    if (c) Object.assign(item, { investimento_total: Number(c.spend.toFixed(2)), impressions: c.impressions, clicks: c.clicks, leads_meta: c.leads_meta, conversas_iniciadas: c.conversations_started });
    item.cpl = safeRate(item.investimento_total, item.leads_total);
    item.custo_por_qualificado = safeRate(item.investimento_total, item.leads_qualificados);
    item.custo_por_iniciacao_conversa = safeRate(item.investimento_total, item.conversas_iniciadas);
    item.eficiencia = item.investimento_total > 0 ? Number((item.leads_qualificados / item.investimento_total).toFixed(4)) : 0;
  }

  const total = {
    leads_total: detailRows.length,
    leads_qualificados: detailRows.reduce((s, r) => s + r.leads_qualificados, 0),
    leads_pouco_qualificados: detailRows.reduce((s, r) => s + r.leads_pouco_qualificados, 0),
    leads_inativos: detailRows.reduce((s, r) => s + r.leads_inativos, 0),
    feedback_positivo: detailRows.reduce((s, r) => s + r.feedback_positivo, 0),
    feedback_negativo: detailRows.reduce((s, r) => s + r.feedback_negativo, 0),
    divergencia_ia_vendedor: detailRows.reduce((s, r) => s + r.divergencia_ia_vendedor, 0),
    investimento_total: campaigns.reduce((s, r) => s + Number(r.investimento_total || 0), 0),
  };

  const report = {
    generated_at: new Date().toISOString(),
    period: { start: since, end: until },
    account: account ? { id: account.account_id, name: account.account_name, currency: account.currency || "BRL" } : null,
    total: {
      ...total,
      taxa_qualificacao: safeRate(total.leads_qualificados, total.leads_total),
      taxa_aproveitamento: safeRate(total.feedback_positivo, total.leads_total),
      cpl: safeRate(total.investimento_total, total.leads_total),
      custo_por_qualificado: safeRate(total.investimento_total, total.leads_qualificados),
    },
    campanhas: campaigns,
    conjuntos: adsets,
    anuncios: ads,
    feedback_vendedores: (feedbacks || []).map((f: any) => ({
      lead_id: f.lead_id,
      campaign_id: f.campaign_id,
      ad_id: f.ad_id,
      seller_id: f.seller_id,
      feedback: f.feedback,
      datetime: f.datetime,
    })),
    custos: costs || [],
  };

  if (!persist) return { report, reportRow: null };
  const { data: row, error } = await admin.from("reports").insert({
    user_id: userId,
    account_id: account?.id || null,
    period_start: since,
    period_end: until,
    json_data: report,
    status: "generated",
  }).select("*").single();
  if (error) throw new Error(error.message);
  return { report, reportRow: row };
}

function deterministicJoseRecommendations(report: any) {
  const campaigns = report.campanhas || [];
  const avgCpl = report.total?.cpl || 0;
  const lowQuality = campaigns.filter((c: any) => c.cpl > avgCpl * 1.25 && c.taxa_qualificacao < 0.2);
  const winners = campaigns.filter((c: any) => c.cpl > 0 && c.cpl <= avgCpl && c.taxa_qualificacao >= 0.4);
  const badAds = (report.anuncios || []).filter((a: any) => a.investimento_total > 0 && a.taxa_qualificacao < 0.15);
  const bestAdsets = [...(report.conjuntos || [])].sort((a: any, b: any) => b.eficiencia - a.eficiencia).slice(0, 5);
  const volumeLowQuality = campaigns.filter((c: any) => c.leads_total >= 10 && c.taxa_qualificacao < 0.25);

  return {
    pausar_campanhas: lowQuality.map((c: any) => ({ campaign_id: c.id, campaign_name: c.name, reason: "CPL alto e baixa taxa de qualificacao" })),
    escalar_campanhas: winners.map((c: any) => ({ campaign_id: c.id, campaign_name: c.name, reason: "CPL abaixo da media e qualidade alta" })),
    pausar_anuncios: badAds.map((a: any) => ({ ad_id: a.id, ad_name: a.name, reason: "Investimento com baixa qualificacao" })),
    melhores_conjuntos: bestAdsets.map((a: any) => ({ adset_id: a.id, adset_name: a.name, eficiencia: a.eficiencia })),
    alto_volume_baixa_qualidade: volumeLowQuality.map((c: any) => ({ campaign_id: c.id, campaign_name: c.name, leads_total: c.leads_total, taxa_qualificacao: c.taxa_qualificacao })),
  };
}

async function sendToJose(admin: any, userId: string, body: any) {
  const { report, reportRow } = await buildReport(admin, userId, body, true);
  const instruction = `Voce e o Agente Jose, Gestor de Trafego IA. Com base nos dados abaixo, gere recomendacoes de otimizacao indicando:
1. Quais campanhas pausar (alto CPL + baixa qualidade)
2. Quais campanhas escalar (baixo CPL + alta qualidade)
3. Quais anuncios pausar
4. Quais conjuntos tem melhor desempenho
5. Campanhas com volume alto mas qualidade baixa

Dados: ${JSON.stringify(report)}`;

  let joseRecommendations: any = deterministicJoseRecommendations(report);
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (anthropicKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: Deno.env.get("ANTHROPIC_MODEL") || "claude-3-5-sonnet-20241022",
          max_tokens: 1800,
          temperature: 0.2,
          messages: [{ role: "user", content: instruction }],
        }),
      });
      const data = await res.json();
      const text = data?.content?.[0]?.text;
      if (text) joseRecommendations = { ...joseRecommendations, analise_texto: text };
    } catch (error) {
      console.warn("[meta-lead-quality] Jose AI fallback:", error);
    }
  }

  await admin.from("reports").update({
    jose_recommendations: joseRecommendations,
    status: "sent_to_jose",
  }).eq("id", reportRow.id);

  return { success: true, report_id: reportRow.report_id, report, jose_recommendations: joseRecommendations };
}

// Total AGREGADO do período direto da Meta (sem somar os dias) = os números que
// o Facebook exibe. Usado pelo Painel ao Vivo pra mostrar verba + conversas
// REAIS por período (Hoje/Ontem/7d/30d/Personalizado), batendo com o Meta Ads.
async function metaPeriodTotal(admin: any, userId: string, body: any) {
  const { accessToken, accountId } = await getMetaAccount(admin, userId, body.targetAccountId);
  const { since, until } = body.period_start && body.period_end
    ? { since: body.period_start, until: body.period_end }
    : parseDatePreset((body.date_preset || "last_7d") as DatePreset);
  // daily=false => agregado do período inteiro (uma linha por campanha).
  const rows = await fetchInsights(accessToken, accountId, "campaign", since, until, false);
  let spend = 0, conversations = 0, leadsMeta = 0, impressions = 0, clicks = 0;
  for (const r of rows) {
    spend += Number(r.spend || 0);
    impressions += Number(r.impressions || 0);
    clicks += Number(r.clicks || 0);
    conversations += conversationCount(r.actions);
    leadsMeta += metaLeadCount(r.actions);
  }
  return {
    since, until,
    spend: Number(spend.toFixed(2)),
    impressions, clicks,
    conversations_started: conversations,
    leads_meta: leadsMeta,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "report";
    const { admin, userId, sellerId } = await getContext(req, body);

    if (action === "capture_origin") return json(await captureOrigin(admin, userId, body));
    if (action === "seller_feedback") return json(await saveSellerFeedback(admin, userId, sellerId, body));
    if (action === "sync_costs") return json(await syncCosts(admin, userId, body));
    if (action === "meta_period_total") return json(await metaPeriodTotal(admin, userId, body));
    if (action === "send_to_jose") return json(await sendToJose(admin, userId, body));
    if (action === "report") {
      const { report, reportRow } = await buildReport(admin, userId, body, body.persist !== false);
      return json({ success: true, report_id: reportRow?.report_id || null, report });
    }

    return json({ error: "acao invalida" }, 400);
  } catch (error: any) {
    console.error("[meta-lead-quality]", error?.message || error);
    return json({ error: error?.message || "Erro interno" }, error?.message === "Unauthorized" ? 401 : 500);
  }
});
