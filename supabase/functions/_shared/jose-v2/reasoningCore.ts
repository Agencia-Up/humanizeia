/**
 * reasoningCore.ts — José v3.1 / Fase 1 (Núcleo de Julgamento)
 *
 * Hierarquia de VERDADE (não de métrica):
 *   Nível 3 (Negócio): venda fechada + lead qualificado pelo Pedro  -> veredito
 *   Nível 2 (Sinal):   % qualificado, taxa de iniciação, avanço de funil
 *   Nível 1 (Vitrine): CPM, CTR, CPC, CPL de vitrine, volume         -> hipótese
 *
 * Regra inviolável: nenhuma conclusão é válida sem confirmação no nível mais alto
 * DISPONÍVEL. Vitrine é hipótese, não veredito. Volume de lead não é resultado.
 *
 * Inteligência vem de DADO (jose_knowledge_base por nicho), não de prompt. A
 * justificativa final é escrita pelo gateway de IA (Juiz) — isso também alimenta
 * o jose_usage_ledger (custo).
 */

import { callAiGateway } from "./aiGateway.ts";

export type Veredito = "bom" | "atencao" | "ruim" | "dados_insuficientes";

export interface Nivel1 { cpm?: number; ctr?: number; cpc?: number; cpl_vitrine?: number; volume?: number; spend?: number; }

function startOfWindowISO(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}
function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function pct(a: number, b: number): number { return b > 0 ? a / b : 0; }

// Nicho da conta de anúncio (cliente). Default 'generico'.
async function resolveNicho(admin: any, ad_account_id?: string | null): Promise<"automoveis" | "imoveis" | "generico"> {
  if (!ad_account_id) return "generico";
  try {
    const { data } = await admin.from("ad_accounts").select("nicho").eq("id", ad_account_id).maybeSingle();
    return (data?.nicho as any) || "generico";
  } catch (_e) { return "generico"; }
}

// RAG enxuto: top-N do conhecimento do nicho (global + do tenant), ativo, por confiança.
async function fetchKnowledge(admin: any, userId: string, nicho: string, topN = 8): Promise<any[]> {
  try {
    const { data } = await admin.from("jose_knowledge_base")
      .select("id, tipo, titulo, conteudo, origem, confianca")
      .eq("nicho", nicho).eq("ativo", true)
      .or(`user_id.is.null,user_id.eq.${userId}`)
      .order("confianca", { ascending: false })
      .limit(topN);
    return data || [];
  } catch (_e) { return []; }
}

// Nível 2 (sinal do Pedro) — nível CONTA na janela (proxy; atribuição por campanha
// é refinamento futuro). % qualificado + taxa de iniciação + avanço de funil.
async function computeNivel2(admin: any, userId: string, sinceISO: string) {
  let total = 0, qualif = 0, avanco = 0, iniciou = 0, capiTotal = 0, capiIniciou = 0;
  try {
    const { data: leads } = await admin.from("ai_crm_leads")
      .select("status_crm, last_user_reply_at").eq("user_id", userId).gte("created_at", sinceISO).limit(5000);
    for (const l of (leads || []) as any[]) {
      total++;
      const s = String(l.status_crm || "");
      if (["qualificado", "negociacao", "fechado"].includes(s)) qualif++;
      if (["negociacao", "fechado"].includes(s)) avanco++;
      if (l.last_user_reply_at) iniciou++;
    }
  } catch (_e) { /* ignore */ }
  try {
    const { data: capi } = await admin.from("wa_capi_funnel")
      .select("event_sent").eq("user_id", userId).gte("created_at", sinceISO).limit(5000);
    for (const c of (capi || []) as any[]) { capiTotal++; if (c.event_sent) capiIniciou++; }
  } catch (_e) { /* ignore */ }
  const taxa_iniciacao = capiTotal > 0 ? pct(capiIniciou, capiTotal) : pct(iniciou, total);
  return {
    total_leads: total,
    pct_qualificado: pct(qualif, total),
    avanco_funil: pct(avanco, total),
    taxa_iniciacao_conversa: taxa_iniciacao,
  };
}

// Nível 3 (negócio) — vendas + leads qualificados na janela; custo por venda /
// por lead qualificado (usando o spend da vitrine).
async function computeNivel3(admin: any, userId: string, sinceISO: string, spend: number) {
  let vendas = 0, qualificados = 0;
  try {
    const { count } = await admin.from("comercial_vendas")
      .select("id", { count: "exact", head: true }).eq("user_id", userId).gte("data_venda", sinceISO.slice(0, 10));
    vendas = count || 0;
  } catch (_e) { /* ignore */ }
  try {
    const { count } = await admin.from("ai_crm_leads")
      .select("id", { count: "exact", head: true }).eq("user_id", userId)
      .in("status_crm", ["qualificado", "negociacao", "fechado"]).gte("created_at", sinceISO);
    qualificados = count || 0;
  } catch (_e) { /* ignore */ }
  return {
    vendas,
    leads_qualificados: qualificados,
    custo_por_venda: vendas > 0 ? spend / vendas : null,
    custo_por_lead_qualificado: qualificados > 0 ? spend / qualificados : null,
  };
}

// Veredito DETERMINÍSTICO pela hierarquia (a IA só justifica depois). Nunca decide
// só pela vitrine (nível 1).
function decideVerdict(n2: any, n3: any): { veredito: Veredito; confianca: number; base: string } {
  const maduro3 = num(n3.vendas) >= 1;
  if (maduro3) {
    // Negócio confirmou. Qualidade não-terrível + venda = bom.
    const v: Veredito = num(n2.pct_qualificado) >= 0.10 ? "bom" : "atencao";
    return { veredito: v, confianca: 0.85, base: "nivel3_venda" };
  }
  if (num(n2.total_leads) > 0) {
    const q = num(n2.pct_qualificado), ini = num(n2.taxa_iniciacao_conversa);
    if (q >= 0.25 && ini >= 0.4) return { veredito: "bom", confianca: 0.6, base: "nivel2_sinal_bom" };
    if (q < 0.10 || ini < 0.2) return { veredito: "ruim", confianca: 0.6, base: "nivel2_sinal_ruim" };
    return { veredito: "atencao", confianca: 0.5, base: "nivel2_misto" };
  }
  return { veredito: "dados_insuficientes", confianca: 0.3, base: "sem_dado_negocio" };
}

async function justificativaIA(admin: any, userId: string, ctx: any): Promise<string> {
  const system = [
    "Você é o JUIZ do José, gestor de tráfego sênior. Escreva uma justificativa CURTA (2-4 frases),",
    "em português de gestor, para o veredito de uma campanha. Regra: a VERDADE é o negócio (venda > lead",
    "qualificado pelo Pedro) — a métrica de vitrine (CPM/CTR/CPL) é hipótese, nunca veredito. Explique POR QUE",
    "a vitrine foi subordinada ao negócio. Use o conhecimento do nicho quando ajudar. Não invente números.",
  ].join(" ");
  const user = JSON.stringify(ctx);
  try {
    const r = await callAiGateway(admin, {
      user_id: userId, capability: "llm",
      input: { system, messages: [{ role: "user", content: `Dados do julgamento:\n${user}\n\nEscreva a justificativa.` }], max_tokens: 300 },
      ref_tipo: "campaign_verdict",
    });
    return (r.ok && r.text) ? r.text.trim() : "";
  } catch (_e) { return ""; }
}

export interface VerdictInput {
  user_id: string;
  ad_account_id?: string | null;
  campaign_id: string;
  nivel1?: Nivel1;
  period_days?: number;
}

export async function computeCampaignVerdict(admin: any, input: VerdictInput) {
  const n1: Nivel1 = input.nivel1 || {};
  // janela: automóvel ~30d; imóvel ~60d (ciclo longo).
  const nicho = await resolveNicho(admin, input.ad_account_id);
  const days = input.period_days || (nicho === "imoveis" ? 60 : 30);
  const sinceISO = startOfWindowISO(days);
  const spend = num(n1.spend);

  const [knowledge, n2, n3] = await Promise.all([
    fetchKnowledge(admin, input.user_id, nicho),
    computeNivel2(admin, input.user_id, sinceISO),
    computeNivel3(admin, input.user_id, sinceISO, spend),
  ]);

  const { veredito, confianca, base } = decideVerdict(n2, n3);

  const justificativa = await justificativaIA(admin, input.user_id, {
    nicho, janela_dias: days, base_da_decisao: base, veredito,
    nivel1_vitrine: n1, nivel2_sinal: n2, nivel3_negocio: n3,
    conhecimento: knowledge.map((k) => ({ tipo: k.tipo, titulo: k.titulo })),
  });

  // grava o veredito (auditável)
  let verdictId: string | null = null;
  try {
    const { data } = await admin.from("jose_campaign_verdict").insert({
      user_id: input.user_id, ad_account_id: input.ad_account_id || null, campaign_id: input.campaign_id, nicho,
      nivel1: n1, nivel2: n2, nivel3: n3, veredito, confianca,
      justificativa: justificativa || null, conhecimento_usado: knowledge.map((k) => k.id),
    }).select("id").maybeSingle();
    verdictId = data?.id || null;
  } catch (_e) { /* ignore */ }

  return {
    ok: true, verdict_id: verdictId, nicho, janela_dias: days,
    veredito, confianca, base, justificativa,
    nivel1: n1, nivel2: n2, nivel3: n3,
    conhecimento_usado: knowledge.map((k) => ({ id: k.id, tipo: k.tipo, titulo: k.titulo, origem: k.origem })),
  };
}
