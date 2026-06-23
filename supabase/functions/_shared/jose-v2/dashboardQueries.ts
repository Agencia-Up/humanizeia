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

import { leadQualityByAd, leadMotivosByAd, formatMotivos, sellerFeedbackByAd, type LeadQualityByAdRow } from "./leadQuality.ts";

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
  const nameField = opts.level === "adset" ? ",adset_name" : opts.level === "ad" ? ",ad_name" : "";
  url.searchParams.set("fields", "spend,cpm,cpc,ctr,impressions,clicks,reach,actions" + nameField);
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

// Limpa o nome do anúncio pra exibir: tira ** e extensão de arquivo (.png/.jpg) e _ —
// o lojista costuma nomear o anúncio com o nome do arquivo do criativo.
function cleanAdName(name: string): string {
  return String(name || "—")
    .replace(/\*\*/g, "")
    .replace(/\.(png|jpe?g|mp4|gif|webp)$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "—";
}

// Galeria correta: UMA chamada que já traz, por anúncio ATIVO, a arte (creative) + as
// métricas (insights: gasto/conversas/CPM) JUNTAS, keyed por anúncio. Acaba com o bug de
// casar arte x gasto por NOME (que deixava metade "sem arte"). Best-effort.
async function fetchActiveAdsWithInsights(
  acc: MetaAccount,
  opts: { datePreset?: string; timeRange?: { since: string; until: string } },
): Promise<any[]> {
  const insSpec = (opts.timeRange?.since && opts.timeRange?.until)
    ? `insights.time_range(${JSON.stringify({ since: opts.timeRange.since, until: opts.timeRange.until })})`
    : `insights.date_preset(${opts.datePreset || "last_7d"})`;
  const first = new URL(`${META_GRAPH_URL}/${acc.accountId}/ads`);
  first.searchParams.set("access_token", acc.accessToken);
  first.searchParams.set("fields", `id,name,effective_status,creative{thumbnail_url,image_url},${insSpec}{spend,impressions,actions,cpm}`);
  first.searchParams.set("filtering", JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]));
  first.searchParams.set("limit", "100");
  // PAGINA até acabar (segue paging.next) -> pega TODOS os anúncios ATIVOS que a Meta tiver
  // (a conta diz o número real, ex. 68), sem teto chutado. guard só pra não rodar pra sempre.
  let next: string | null = first.toString();
  const out: any[] = [];
  let guard = 0;
  try {
    while (next && guard < 30) {
      guard++;
      const res = await fetch(next);
      const data = await res.json();
      if (data?.error) { console.warn("[dashboardQueries] active ads erro:", data.error?.message); break; }
      if (Array.isArray(data?.data)) out.push(...data.data);
      next = data?.paging?.next || null;
    }
  } catch (e) { console.warn("[dashboardQueries] active ads fetch falhou:", e); }
  return out;
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
  leads_recebidos: number; // leads que entraram no período (funil)
  leads_bom: number; leads_classificados: number; vendas: number;
  custo_por_lead_bom: number | null; // gasto / leads_bom (a verdade ao lado do CPL)
  custo_por_venda: number | null;    // gasto / vendas (o topo da hierarquia de verdade)
  // breakdowns
  idade: Array<{ faixa: string; gasto: number; conversas: number; cpl: number | null }>;
  regiao_entrega: Array<{ regiao: string; gasto: number; conversas: number }>;
  regiao_origem: Array<{ cidade: string; leads: number; leads_bom: number }>;
  por_publico: Array<{ nome: string; gasto: number; conversas: number }>;
  por_criativo: Array<{ nome: string; gasto: number; conversas: number; cpm: number; custo_conversa: number | null; status: string | null; thumbnail_url: string | null; leads_bom: number | null; leads_ruim: number | null; pct_bom: number | null; por_que_ruim: string | null; fb_alta: number | null; fb_baixa: number | null }>;
  anuncios: Array<{ ad_name: string | null; ad_key_kind: string; leads_total: number; leads_bom: number; leads_ruim: number; vendas: number; pct_bom: number | null }>;
  atribuicao: { por_ad_id: number; por_titulo: number; sem_origem: number };
}

// Data YYYY-MM-DD em America/Sao_Paulo (BRT), com deslocamento de dias — casa com o
// fuso da conta de anúncios da Meta (o date_preset da Meta usa o tz da conta).
function brtDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
}
function presetToRange(preset: string): { since: string; until: string } {
  const until = brtDateStr(0);
  if (preset === "yesterday") { const y = brtDateStr(-1); return { since: y, until: y }; }
  if (preset === "last_30d") return { since: brtDateStr(-29), until };
  if (preset === "last_7d")  return { since: brtDateStr(-6), until };
  return { since: until, until }; // today
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
    .gte("created_at", `${since}T00:00:00-03:00`)
    .lte("created_at", `${until}T23:59:59-03:00`);
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
  const [base, byAge, byRegion, byAdset, activeAds] = await Promise.all([
    fi(), fi("age"), fi("region"),
    fetchInsights(acc, { datePreset, timeRange, level: "adset" }),
    fetchActiveAdsWithInsights(acc, { datePreset, timeRange }),
  ]);

  const b0 = base[0] || {};
  const gasto = num(b0.spend), impressoes = num(b0.impressions), cliques = num(b0.clicks);
  const conversas = conversasFromActions(b0.actions);
  const cpl = conversas > 0 ? gasto / conversas : null;

  // 2) Verdade — qualidade por anúncio (DB)
  const lq: LeadQualityByAdRow[] = await leadQualityByAd(admin, userId, { minLeads: 1 });
  // motivos (porquê) + índice por título normalizado, pra ligar o criativo à qualidade real.
  const motivos = await leadMotivosByAd(admin, userId);
  const sellerFb = await sellerFeedbackByAd(admin, userId); // verdade do vendedor por anúncio
  const lqByName = new Map<string, LeadQualityByAdRow>();
  for (const r of lq) { if (r.ad_name) lqByName.set(String(r.ad_name).trim().toLowerCase(), r); }
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

  // 5b) Por PÚBLICO (adset) e por CRIATIVO (anúncio) — vitrine da Meta (conversas/gasto).
  const por_publico = byAdset.map((r: any) => ({
    nome: String(r.adset_name || "—"), gasto: num(r.spend), conversas: conversasFromActions(r.actions),
  })).sort((a, b) => (b.conversas - a.conversas) || (b.gasto - a.gasto)).slice(0, 8);
  const por_criativo = activeAds.map((ad: any) => {
    const ins = ad.insights?.data?.[0] || {};
    const gasto = num(ins.spend);
    const conversas = conversasFromActions(ins.actions);
    const key = String(ad.name || "").trim().toLowerCase(); // casa qualidade pelo nome ORIGINAL (~título)
    const q = lqByName.get(key);
    const mv = q?.ad_key ? motivos.get(q.ad_key) : null;
    const sf = q?.ad_key ? sellerFb.get(q.ad_key) : null;
    return {
      nome: cleanAdName(ad.name),                          // nome limpo (sem ** / .png)
      gasto, conversas,
      cpm: num(ins.cpm),                                   // CPM da peça
      custo_conversa: conversas > 0 ? gasto / conversas : null, // custo por conversa
      status: ad.effective_status || null,
      thumbnail_url: ad.creative?.image_url || ad.creative?.thumbnail_url || null, // arte na MESMA chamada -> some o "sem arte" à toa
      leads_bom: q ? num(q.leads_bom) : null,
      leads_ruim: q ? num(q.leads_ruim) : null,
      pct_bom: q ? q.pct_bom : null,
      por_que_ruim: mv ? formatMotivos(mv.ruim) : null,
      fb_alta: sf?.alta ?? null,                           // verdade do vendedor: leads marcados ALTA
      fb_baixa: sf?.baixa ?? null,                         // ... e BAIXA (sinal de anúncio ruim)
    };
  }).sort((a, b) => (b.gasto - a.gasto) || (b.conversas - a.conversas)); // todos os ativos (sem corte)

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
    leads_recebidos: pq.total, leads_bom, leads_classificados: leads_classif, vendas, custo_por_lead_bom, custo_por_venda,
    idade, regiao_entrega, regiao_origem, por_publico, por_criativo, anuncios, atribuicao: atrib,
  };
}
