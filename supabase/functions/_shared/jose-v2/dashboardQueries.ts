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

import { leadQualityByAd, leadQualityByAdPeriod, leadMotivosByAd, formatMotivos, sellerFeedbackByAd, type LeadQualityByAdRow } from "./leadQuality.ts";

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
  const nameField = opts.level === "adset" ? ",adset_name" : opts.level === "ad" ? ",ad_name,ad_id" : "";
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

// Normaliza nome de anúncio/veículo pra casar a tabela de QUALIDADE (chaveada por veículo/
// título do lead) com os anúncios ATIVOS da Meta (chaveados pelo nome do anúncio). ALTA
// PRECISÃO de propósito (igualdade ou substring, NÃO token solto): só marca "ativo" quando
// tem certeza — nunca rotula um anúncio que roda como "fora do ar" por causa de nome diferente.
function normAd(s: string | null): string {
  return String(s || "").toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/\.(png|jpe?g|mp4|gif|webp)$/i, " ")
    .replace(/[^a-z0-9áàâãéêíóôõúüç ]/gi, " ")
    .replace(/\s+/g, " ").trim();
}
// Um anúncio da tabela de qualidade está ATIVO se o nome dele casa (igual/substring) com algum
// anúncio ativo na Meta. Mínimo de 4 chars dos dois lados pra não casar fragmento à toa.
function isAtivoNaMeta(rowName: string | null, activeNorms: string[]): boolean {
  const rn = normAd(rowName);
  if (rn.length < 4) return false;
  return activeNorms.some((an) => an === rn || an.includes(rn) || rn.includes(an));
}

// Galeria correta: UMA chamada que já traz, por anúncio ATIVO, a arte (creative) + as
// métricas (insights: gasto/conversas/CPM) JUNTAS, keyed por anúncio. Acaba com o bug de
// casar arte x gasto por NOME (que deixava metade "sem arte"). Best-effort.
// Lista LEVE dos anúncios ATIVOS (só id/nome/status/arte — SEM insights, senão a Meta encolhe
// a página e a paginação fica lenta e incompleta -> era a causa de "os anúncios sumiram"). As
// métricas vêm de fetchInsights(level:"ad") e a gente junta por ad_id. Leve = página cheia = rápido.
async function fetchActiveAds(acc: MetaAccount): Promise<any[]> {
  const first = new URL(`${META_GRAPH_URL}/${acc.accountId}/ads`);
  first.searchParams.set("access_token", acc.accessToken);
  first.searchParams.set("fields", "id,name,effective_status,creative{thumbnail_url,image_url}");
  first.searchParams.set("filtering", JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]));
  first.searchParams.set("limit", "200");
  let next: string | null = first.toString();
  const out: any[] = [];
  const seen = new Set<string>();
  let guard = 0;
  try {
    while (next && guard < 20) {
      guard++;
      const res = await fetch(next);
      const data = await res.json();
      if (data?.error) { console.warn("[dashboardQueries] active ads erro:", data.error?.message); break; }
      // BLINDAGEM (definitiva): a paginação da Meta REPETE anúncios entre páginas e às vezes
      // PERDE o filtro (devolve não-ativo) -> contava 174 quando havia ~54 ativos de verdade.
      // Dedupe por id + exige effective_status ACTIVE no nosso lado; não confia só no filtro da Meta.
      for (const ad of (Array.isArray(data?.data) ? data.data : [])) {
        const id = String(ad?.id || "");
        if (!id || seen.has(id)) continue;
        if (ad?.effective_status !== "ACTIVE") continue;
        seen.add(id);
        out.push(ad);
      }
      next = data?.paging?.next || null;
    }
  } catch (e) { console.warn("[dashboardQueries] active ads fetch falhou:", e); }
  return out;
}

// Busca metadados (nome/status/arte) de anúncios ESPECÍFICOS por id (lotes de 50),
// inclusive PAUSADOS — usado pelo HISTÓRICO da área de Feedbacks (Facebook devolve
// os objetos mesmo pausados; só não devolve os DELETADOS, aí caímos no ad_name do insight).
async function fetchAdsByIds(acc: MetaAccount, ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const uniq = Array.from(new Set(ids.filter(Boolean).map(String)));
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    const url = new URL(`${META_GRAPH_URL}/`);
    url.searchParams.set("ids", chunk.join(","));
    url.searchParams.set("fields", "name,effective_status,creative{thumbnail_url,image_url}");
    url.searchParams.set("access_token", acc.accessToken);
    try {
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data?.error) { console.warn("[dashboardQueries] adsByIds erro:", data.error?.message); continue; }
      for (const id of Object.keys(data || {})) map.set(String(id), data[id]);
    } catch (e) { console.warn("[dashboardQueries] adsByIds fetch falhou:", e); }
  }
  return map;
}

// Insights no nível de ANÚNCIO, ORDENADOS por maior gasto, paginando só o topo. A conta
// tem MILHARES de cópias de anúncio em 60-90 dias (level=ad sem paginar trava e subconta);
// mas o gasto é super concentrado (os maiores gastadores = ~todo o valor). Pegamos as
// primeiras páginas por gasto desc e paramos cedo quando o gasto vira centavo (irrelevante
// pra decisão). Assim bate ~100% do total sem explodir. sort=spend_descending (testado).
async function fetchTopAdSpend(
  acc: MetaAccount,
  opts: { datePreset?: string; timeRange?: { since: string; until: string } },
  maxPages = 4,
): Promise<any[]> {
  const first = new URL(`${META_GRAPH_URL}/${acc.accountId}/insights`);
  first.searchParams.set("access_token", acc.accessToken);
  if (opts.timeRange?.since && opts.timeRange?.until) {
    first.searchParams.set("time_range", JSON.stringify({ since: opts.timeRange.since, until: opts.timeRange.until }));
  } else {
    first.searchParams.set("date_preset", opts.datePreset || "last_30d");
  }
  first.searchParams.set("level", "ad");
  first.searchParams.set("fields", "ad_id,ad_name,spend,impressions,actions");
  first.searchParams.set("sort", "spend_descending");
  first.searchParams.set("limit", "500");
  let next: string | null = first.toString();
  const out: any[] = [];
  let pages = 0;
  try {
    while (next && pages < maxPages) {
      pages++;
      const res = await fetch(next);
      const data = await res.json();
      if (data?.error) { console.warn("[dashboardQueries] topAdSpend erro:", data.error?.message); break; }
      const rows = Array.isArray(data?.data) ? data.data : [];
      out.push(...rows);
      // ordenado desc: se o último da página já é < R$1, o resto é cauda irrelevante -> para.
      const last = rows[rows.length - 1];
      if (!last || num(last.spend) < 1) break;
      next = data?.paging?.next || null;
    }
  } catch (e) { console.warn("[dashboardQueries] topAdSpend fetch falhou:", e); }
  return out;
}

export interface SpendByCreative {
  periodo: string; ad_account_id: string; moeda: string; gasto_total: number;
  criativos: Array<{ nome: string; gasto: number; conversas: number; cpm: number; custo_conversa: number | null; status: string | null; thumbnail_url: string | null }>;
}
// HISTÓRICO por criativo (área de Feedbacks): gasto por CARRO no período, incluindo
// anúncios PAUSADOS que gastaram — o que o por_criativo dos cards (só ATIVOS) não dá.
// Estratégia: pega os anúncios por MAIOR gasto (fetchTopAdSpend), agrupa por nome (=carro);
// status vem de quem ainda está ATIVO na Meta (fetchActiveAds); a arte dos pausados vem de
// um anúncio representativo por carro (poucas chamadas). Bate ~o total sem explodir volume.
export async function getSpendByCreative(
  admin: any, userId: string,
  opts?: { adAccountId?: string; datePreset?: string; timeRange?: { since: string; until: string } },
): Promise<SpendByCreative | null> {
  const timeRange = (opts?.timeRange?.since && opts?.timeRange?.until) ? opts.timeRange : undefined;
  const datePreset = timeRange ? undefined : (opts?.datePreset || "last_30d");
  const acc = await resolveMetaAccount(admin, userId, opts?.adAccountId);
  if (!acc) return null;

  const [byAd, activeAds] = await Promise.all([
    fetchTopAdSpend(acc, { datePreset, timeRange }),
    fetchActiveAds(acc),
  ]);
  // nome (normalizado p/ chave) -> arte do anúncio ATIVO (pra status + thumbnail dos ativos)
  const activeByName = new Map<string, string | null>();
  for (const ad of activeAds) {
    const key = String(ad?.name || "").trim().toLowerCase();
    if (key && !activeByName.has(key)) activeByName.set(key, ad?.creative?.image_url || ad?.creative?.thumbnail_url || null);
  }

  const byName = new Map<string, any>();
  let gasto_total = 0;
  for (const r of byAd) {
    const spend = num(r.spend);
    gasto_total += spend;
    const rawName = r.ad_name || "—";
    const key = String(rawName).trim().toLowerCase();
    if (!key) continue;
    let g = byName.get(key);
    if (!g) { g = { nome: cleanAdName(rawName), gasto: 0, conversas: 0, impressoes: 0, repId: String(r.ad_id || ""), thumbnail_url: null }; byName.set(key, g); }
    g.gasto += spend;
    g.conversas += conversasFromActions(r.actions);
    g.impressoes += num(r.impressions);
  }
  // status + arte: ativo se o nome casa com um anúncio ativo; senão busca a arte do representativo
  const semArte: any[] = [];
  for (const [key, g] of byName) {
    g.ativo = activeByName.has(key);
    g.thumbnail_url = activeByName.get(key) || null;
    if (!g.thumbnail_url && g.repId) semArte.push(g);
  }
  if (semArte.length) {
    const meta = await fetchAdsByIds(acc, semArte.map((g) => g.repId));
    for (const g of semArte) {
      const m = meta.get(String(g.repId));
      if (m) g.thumbnail_url = m.creative?.image_url || m.creative?.thumbnail_url || null;
    }
  }

  const criativos = Array.from(byName.values())
    .map((g: any) => ({
      nome: g.nome, gasto: g.gasto, conversas: g.conversas,
      cpm: g.impressoes > 0 ? (g.gasto / g.impressoes) * 1000 : 0,
      custo_conversa: g.conversas > 0 ? g.gasto / g.conversas : null,
      status: g.ativo ? "ACTIVE" : "PAUSED", thumbnail_url: g.thumbnail_url,
    }))
    .sort((a, b) => b.gasto - a.gasto);
  return {
    periodo: timeRange ? `${timeRange.since} a ${timeRange.until}` : (datePreset || "last_30d"),
    ad_account_id: acc.accountDbId, moeda: acc.moeda, gasto_total, criativos,
  };
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
  anuncios: Array<{ ad_name: string | null; ad_key_kind: string; leads_total: number; leads_bom: number; leads_ruim: number; vendas: number; pct_bom: number | null; ativo: boolean }>;
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
  const [base, byAge, byRegion, byAdset, byAd, activeAds] = await Promise.all([
    fi(), fi("age"), fi("region"),
    fetchInsights(acc, { datePreset, timeRange, level: "adset" }),
    fetchInsights(acc, { datePreset, timeRange, level: "ad" }),
    fetchActiveAds(acc),
  ]);
  // métricas por anúncio (insights level=ad) indexadas por ad_id -> junta com a lista LEVE de ativos.
  const insByAdId = new Map<string, any>();
  for (const r of byAd) { if (r.ad_id) insByAdId.set(String(r.ad_id), r); }

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
  // Hero (custo por lead BOM / por VENDA): conta os leads NO MESMO período do gasto
  // (created_at na janela) — senão dividiria gasto-do-período por leads-de-sempre.
  const range = timeRange ?? presetToRange(datePreset || "last_7d");
  const pq = await periodLeadQuality(admin, userId, range.since, range.until);
  // Qualidade por anúncio NO PERÍODO -> a tabela ANÚNCIO e a atribuição respeitam o filtro
  // geral; anúncio sem lead no período some (aproxima "só os anúncios ativos").
  const lqPeriodo = await leadQualityByAdPeriod(admin, userId, range.since, range.until);
  let leads_classif = 0;
  const atrib = { por_ad_id: 0, por_titulo: 0, sem_origem: 0 };
  for (const r of lqPeriodo) {
    leads_classif += num(r.leads_bom) + num(r.leads_medio) + num(r.leads_ruim);
    if (r.ad_key_kind === "ad_id") atrib.por_ad_id += num(r.leads_total);
    else if (r.ad_key_kind === "titulo") atrib.por_titulo += num(r.leads_total);
    else atrib.sem_origem += num(r.leads_total);
  }
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
  // AGRUPA por CRIATIVO (nome do anúncio): a Meta cria MUITAS cópias do mesmo anúncio em adsets
  // diferentes -> ~349 ids ATIVOS para só ~54 criativos distintos. O dono quer ver os CRIATIVOS,
  // não as cópias. Soma gasto/conversas/impressões das cópias e mostra 1 card por criativo.
  const critByName = new Map<string, any>();
  for (const ad of activeAds) {
    const key = String(ad?.name || "").trim().toLowerCase(); // casa qualidade pelo nome ORIGINAL (~título)
    if (!key) continue;
    const ins = insByAdId.get(String(ad.id)) || {};
    let g = critByName.get(key);
    if (!g) {
      const q = lqByName.get(key);
      const mv = q?.ad_key ? motivos.get(q.ad_key) : null;
      const sf = q?.ad_key ? sellerFb.get(q.ad_key) : null;
      g = {
        nome: cleanAdName(ad.name),                          // nome limpo (sem ** / .png)
        gasto: 0, conversas: 0, impressoes: 0,
        status: ad.effective_status || null,
        thumbnail_url: ad.creative?.image_url || ad.creative?.thumbnail_url || null, // arte na MESMA chamada
        leads_bom: q ? num(q.leads_bom) : null,
        leads_ruim: q ? num(q.leads_ruim) : null,
        pct_bom: q ? q.pct_bom : null,
        por_que_ruim: mv ? formatMotivos(mv.ruim) : null,
        fb_alta: sf?.alta ?? null,                           // verdade do vendedor: leads ALTA
        fb_baixa: sf?.baixa ?? null,                         // ... e BAIXA (sinal de anúncio ruim)
      };
      critByName.set(key, g);
    }
    g.gasto += num(ins.spend);
    g.conversas += conversasFromActions(ins.actions);
    g.impressoes += num(ins.impressions);
    if (!g.thumbnail_url) g.thumbnail_url = ad.creative?.image_url || ad.creative?.thumbnail_url || null;
  }
  const por_criativo = Array.from(critByName.values())
    .map((g: any) => ({
      nome: g.nome, gasto: g.gasto, conversas: g.conversas,
      cpm: g.impressoes > 0 ? (g.gasto / g.impressoes) * 1000 : 0, // CPM do criativo (do total somado)
      custo_conversa: g.conversas > 0 ? g.gasto / g.conversas : null,
      status: g.status, thumbnail_url: g.thumbnail_url,
      leads_bom: g.leads_bom, leads_ruim: g.leads_ruim, pct_bom: g.pct_bom,
      por_que_ruim: g.por_que_ruim, fb_alta: g.fb_alta, fb_baixa: g.fb_baixa,
    }))
    .sort((a, b) => (b.gasto - a.gasto) || (b.conversas - a.conversas)); // 1 card por criativo distinto

  // 6) Anúncios por QUALIDADE REAL (não CTR). Marca quem ainda está ATIVO na Meta (casa o
  //    nome com a lista de ativos) e ordena ATIVOS primeiro — a otimização é feita nos ativos;
  //    o resto fica como histórico (consulta), não como alvo de ação.
  const activeNorms = activeAds.map((a: any) => normAd(a?.name)).filter((s: string) => s.length >= 4);
  const anuncios = lqPeriodo
    .filter((r) => r.ad_key_kind !== "sem_origem")
    .map((r) => ({
      ad_name: r.ad_name, ad_key_kind: r.ad_key_kind,
      leads_total: num(r.leads_total), leads_bom: num(r.leads_bom),
      leads_ruim: num(r.leads_ruim), vendas: num((r as any).vendas), pct_bom: r.pct_bom,
      ativo: isAtivoNaMeta(r.ad_name, activeNorms),
    }))
    .sort((a, b) => {
      if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;           // ativos primeiro
      return (num(b.pct_bom) - num(a.pct_bom)) || (num(b.leads_total) - num(a.leads_total));
    })
    .slice(0, 12);

  return {
    periodo: timeRange ? `${timeRange.since} a ${timeRange.until}` : (datePreset || "last_7d"), ad_account_id: acc.accountDbId, moeda: acc.moeda,
    gasto, impressoes, cliques,
    cpm: num(b0.cpm), cpc: num(b0.cpc), ctr: num(b0.ctr),
    conversas, cpl,
    leads_recebidos: pq.total, leads_bom, leads_classificados: leads_classif, vendas, custo_por_lead_bom, custo_por_venda,
    idade, regiao_entrega, regiao_origem, por_publico, por_criativo, anuncios, atribuicao: atrib,
  };
}
