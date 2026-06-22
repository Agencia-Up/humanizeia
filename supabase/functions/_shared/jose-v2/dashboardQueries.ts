/**
 * dashboardQueries.ts — José Cabine de Comando / Bloco A (cards) — FONTE ÚNICA
 *
 * As funções aqui são a ÚNICA fonte dos números da Cabine: os cards do painel E
 * (no Bloco B) as ferramentas do chat do José importam DAQUI. Painel e chat nunca
 * divergem porque leem a MESMA camada de dados (princípio anti-divergência).
 *
 * Mistura a VITRINE (Meta Insights: CPL/CPM/CPC, idade, região de entrega) com a
 * VERDADE (lead_quality_by_ad: custo por lead BOM, anúncios por qualidade real).
 */

import { leadQualityByAd, type LeadQualityByAdRow } from "./leadQuality.ts";

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";
const CURRENCY_SYMBOL: Record<string, string> = { BRL: "R$", USD: "$", EUR: "€" };

export interface MetaAccount {
  accessToken: string;
  accountId: string;   // act_...
  accountDbId: string; // uuid em ad_accounts
  currency: string;
  moeda: string;       // símbolo
}

export async function resolveMetaAccount(
  admin: any,
  userId: string,
  adAccountId?: string,
): Promise<MetaAccount | null> {
  let q = admin.from("ad_accounts")
    .select("id, account_id, currency, access_token_encrypted, is_active, platform")
    .eq("user_id", userId).eq("platform", "meta").eq("is_active", true);
  if (adAccountId) q = q.eq("id", adAccountId);
  const { data } = await q.limit(1).maybeSingle();
  if (!data?.access_token_encrypted || !data?.account_id) return null;
  const currency = data.currency || "BRL";
  const acct = String(data.account_id);
  return {
    accessToken: data.access_token_encrypted,
    accountId: acct.startsWith("act_") ? acct : `act_${acct}`,
    accountDbId: data.id,
    currency,
    moeda: CURRENCY_SYMBOL[currency] || currency,
  };
}

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Resultado primário no nível da CONTA, alinhado ao relatório do José (pickResult do
// apollo-agent): mensagens (WhatsApp) + leads de formulário, por PRIORIDADE — sem somar
// variantes do mesmo evento (evita dupla contagem). Concessionária = ~só messaging.
// Assim o CPL da Cabine bate com o "Custo por conversa" do relatório (ex.: 883/50=17,66).
function conversasFromActions(actions: any[]): number {
  if (!Array.isArray(actions)) return 0;
  const val = (t: string) => { const a = actions.find((x: any) => x?.action_type === t); return a ? num(a.value) : 0; };
  const mensagens = val("onsite_conversion.messaging_conversation_started_7d");
  const leads = val("onsite_conversion.lead_grouped") || val("lead")
    || val("offsite_conversion.fb_pixel_lead") || val("onsite_conversion.lead") || val("onsite_web_lead");
  return mensagens + leads;
}

async function fetchInsights(
  acc: MetaAccount,
  opts: { datePreset?: string; timeRange?: { since: string; until: string }; breakdowns?: string; level?: string },
): Promise<any[]> {
  const url = new URL(`${META_GRAPH_URL}/${acc.accountId}/insights`);
  url.searchParams.set("access_token", acc.accessToken);
  if (opts.timeRange?.since && opts.timeRange?.until) {
    url.searchParams.set("time_range", JSON.stringify({ since: opts.timeRange.since, until: opts.timeRange.until }));
  } else {
    url.searchParams.set("date_preset", opts.datePreset || "last_7d");
  }
  url.searchParams.set("fields", "spend,cpm,cpc,ctr,impressions,clicks,reach,actions");
  if (opts.level) url.searchParams.set("level", opts.level);
  if (opts.breakdowns) url.searchParams.set("breakdowns", opts.breakdowns);
  url.searchParams.set("limit", "500");
  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    if (data?.error) { console.warn("[dashboardQueries] insights erro:", data.error?.message); return []; }
    return Array.isArray(data?.data) ? data.data : [];
  } catch (e) { console.warn("[dashboardQueries] insights fetch falhou:", e); return []; }
}

// De onde os leads REALMENTE vieram (cidade declarada) + quantos bons por cidade.
async function leadOriginByCity(
  admin: any,
  userId: string,
): Promise<Array<{ cidade: string; leads: number; leads_bom: number }>> {
  const { data } = await admin.from("ai_crm_leads")
    .select("client_city, qualidade_lead")
    .eq("user_id", userId)
    .not("client_city", "is", null);
  const map = new Map<string, { leads: number; leads_bom: number }>();
  for (const r of (data || []) as any[]) {
    const city = String(r.client_city || "").trim();
    if (!city) continue;
    const m = map.get(city) || { leads: 0, leads_bom: 0 };
    m.leads += 1;
    if (r.qualidade_lead === "bom") m.leads_bom += 1;
    map.set(city, m);
  }
  return Array.from(map.entries())
    .map(([cidade, v]) => ({ cidade, ...v }))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 12);
}

export interface DashboardCards {
  periodo: string;
  ad_account_id: string; // uuid da conta em ad_accounts (p/ dedupe do snapshot)
  moeda: string;
  // vitrine
  gasto: number; impressoes: number; cliques: number;
  cpm: number; cpc: number; ctr: number;
  conversas: number;            // resultado da Meta
  cpl: number | null;           // gasto / conversas (vitrine)
  // verdade
  leads_bom: number; leads_classificados: number; vendas: number;
  custo_por_lead_bom: number | null; // gasto / leads_bom (a verdade ao lado do CPL)
  custo_por_venda: number | null;    // gasto / vendas (o topo da hierarquia de verdade)
  // breakdowns
  idade: Array<{ faixa: string; gasto: number; conversas: number; cpl: number | null }>;
  regiao_entrega: Array<{ regiao: string; gasto: number; conversas: number }>;
  regiao_origem: Array<{ cidade: string; leads: number; leads_bom: number }>;
  anuncios: Array<{ ad_name: string | null; ad_key_kind: string; leads_total: number; leads_bom: number; leads_ruim: number; vendas: number; pct_bom: number | null }>;
  atribuicao: { por_ad_id: number; por_titulo: number; sem_origem: number };
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function presetToRange(preset: string): { since: string; until: string } {
  const since = new Date(); const until = new Date();
  if (preset === "yesterday") { since.setDate(since.getDate() - 1); until.setDate(until.getDate() - 1); }
  else if (preset === "last_30d") since.setDate(since.getDate() - 29);
  else if (preset === "last_7d") since.setDate(since.getDate() - 6);
  // "today" => since = until = hoje
  return { since: ymd(since), until: ymd(until) };
}
function efetivaStatus(status: string, ia: string | null): "venda" | "bom" | "medio" | "ruim" | null {
  if (status === "fechado") return "venda";
  if (["negociacao", "qualificado", "agendamento"].includes(status)) return "bom";
  if (["em_atendimento", "pouco_qualificado", "carro_nao_disponivel"].includes(status)) return "medio";
  if (["perdido", "inativo"].includes(status)) return "ruim";
  return (ia === "bom" || ia === "medio" || ia === "ruim") ? ia : null;
}
// Conta leads BONS e VENDAS na janela (created_at), coerente com o gasto do período.
async function periodLeadQuality(
  admin: any, userId: string, since: string, until: string,
): Promise<{ leads_bom: number; vendas: number; total: number }> {
  const { data } = await admin.from("ai_crm_leads")
    .select("status_crm, qualidade_lead, created_at")
    .eq("user_id", userId)
    .gte("created_at", `${since}T00:00:00`)
    .lte("created_at", `${until}T23:59:59`);
  let bom = 0, vendas = 0, total = 0;
  for (const l of (data || []) as any[]) {
    total++;
    const ef = efetivaStatus(String(l.status_crm || ""), l.qualidade_lead);
    if (ef === "venda") { vendas++; bom++; } else if (ef === "bom") bom++;
  }
  return { leads_bom: bom, vendas, total };
}

/**
 * Calcula TODOS os cards da Cabine. Fonte única (cards do painel + tools do chat).
 */
export async function getDashboardCards(
  admin: any,
  userId: string,
  opts?: { adAccountId?: string; datePreset?: string; timeRange?: { since: string; until: string } },
): Promise<DashboardCards | null> {
  const timeRange = (opts?.timeRange?.since && opts?.timeRange?.until) ? opts.timeRange : undefined;
  const datePreset = timeRange ? undefined : (opts?.datePreset || "last_7d");
  const acc = await resolveMetaAccount(admin, userId, opts?.adAccountId);
  if (!acc) return null;

  // 1) Vitrine — base + idade + região, em paralelo
  const fi = (breakdowns?: string) => fetchInsights(acc, { datePreset, timeRange, breakdowns });
  const [base, byAge, byRegion] = await Promise.all([fi(), fi("age"), fi("region")]);

  const b0 = base[0] || {};
  const gasto = num(b0.spend), impressoes = num(b0.impressions), cliques = num(b0.clicks);
  const conversas = conversasFromActions(b0.actions);
  const cpl = conversas > 0 ? gasto / conversas : null;

  // 2) Verdade — qualidade por anúncio (DB)
  const lq: LeadQualityByAdRow[] = await leadQualityByAd(admin, userId, { minLeads: 1 });
  let leads_classif = 0;
  const atrib = { por_ad_id: 0, por_titulo: 0, sem_origem: 0 };
  for (const r of lq) {
    leads_classif += num(r.leads_bom) + num(r.leads_medio) + num(r.leads_ruim);
    if (r.ad_key_kind === "ad_id") atrib.por_ad_id += num(r.leads_total);
    else if (r.ad_key_kind === "titulo") atrib.por_titulo += num(r.leads_total);
    else atrib.sem_origem += num(r.leads_total);
  }
  // Hero (custo por lead BOM / por VENDA): conta os leads NO MESMO período do gasto
  // (created_at na janela) — senão dividiria gasto-do-período por leads-de-sempre.
  const range = timeRange ?? presetToRange(datePreset || "last_7d");
  const pq = await periodLeadQuality(admin, userId, range.since, range.until);
  const leads_bom = pq.leads_bom;
  const vendas = pq.vendas;
  const custo_por_lead_bom = leads_bom > 0 ? gasto / leads_bom : null;
  const custo_por_venda = vendas > 0 ? gasto / vendas : null;

  // 3) Idade (vitrine)
  const idade = byAge.map((r: any) => {
    const g = num(r.spend), c = conversasFromActions(r.actions);
    return { faixa: String(r.age || "—"), gasto: g, conversas: c, cpl: c > 0 ? g / c : null };
  }).sort((a, b) => b.gasto - a.gasto);

  // 4) Região de ENTREGA (Meta) — onde o anúncio aparece (proxy do alvo)
  const regiao_entrega = byRegion.map((r: any) => ({
    regiao: String(r.region || "—"), gasto: num(r.spend), conversas: conversasFromActions(r.actions),
  })).sort((a, b) => b.gasto - a.gasto).slice(0, 12);

  // 5) Região de ORIGEM — de onde os leads REALMENTE vêm (cidade declarada)
  const regiao_origem = await leadOriginByCity(admin, userId);

  // 6) Anúncios por QUALIDADE REAL (não CTR)
  const anuncios = lq
    .filter((r) => r.ad_key_kind !== "sem_origem")
    .sort((a, b) => (num(b.pct_bom) - num(a.pct_bom)) || (num(b.leads_total) - num(a.leads_total)))
    .slice(0, 12)
    .map((r) => ({
      ad_name: r.ad_name, ad_key_kind: r.ad_key_kind,
      leads_total: num(r.leads_total), leads_bom: num(r.leads_bom),
      leads_ruim: num(r.leads_ruim), vendas: num((r as any).vendas), pct_bom: r.pct_bom,
    }));

  return {
    periodo: timeRange ? `${timeRange.since} a ${timeRange.until}` : (datePreset || "last_7d"), ad_account_id: acc.accountDbId, moeda: acc.moeda,
    gasto, impressoes, cliques,
    cpm: num(b0.cpm), cpc: num(b0.cpc), ctr: num(b0.ctr),
    conversas, cpl,
    leads_bom, leads_classificados: leads_classif, vendas, custo_por_lead_bom, custo_por_venda,
    idade, regiao_entrega, regiao_origem, anuncios, atribuicao: atrib,
  };
}
