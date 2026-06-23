/**
 * leadQuality.ts — José Cabine de Comando / Bloco D
 *
 * Verdade nível 2/3 da hierarquia: "de qual anúncio vêm os leads bons".
 * - mapQualidadeLead: deriva qualidade (bom/medio/ruim) + motivo dos sinais que o
 *   Pedro JÁ calcula no fechamento (temperatura + categoria SDR). Nada inventado.
 * - leadQualityByAd: query canônica por trás da view public.lead_quality_by_ad.
 *   É a MESMA função que o chat do José (Bloco B) vai usar como ferramenta — o
 *   painel e o chat leem a mesma camada de dados (anti-divergência).
 */

export type QualidadeLead = "bom" | "medio" | "ruim";

export interface QualidadeResult {
  qualidade: QualidadeLead;
  motivo: string;
}

/**
 * Deriva qualidade + motivo a partir da temperatura do cérebro do Pedro
 * (quente/morno/frio/desqualificado) e da categoria SDR persistida
 * (qualificado/pouco_qualificado/inativo). Mapa decidido no plano:
 *   desqualificado                -> ruim  (fora do perfil / golpe / hostil)
 *   quente | qualificado          -> bom
 *   morno  | pouco_qualificado    -> medio
 *   frio   | inativo              -> ruim
 * Retorna null quando não há sinal suficiente (não classifica à toa).
 */
export function mapQualidadeLead(
  temperatura: string | null | undefined,
  sdrCategoria: string | null | undefined,
): QualidadeResult | null {
  const t = String(temperatura || "").toLowerCase().trim();
  const c = String(sdrCategoria || "").toLowerCase().trim();

  if (t === "desqualificado") return { qualidade: "ruim", motivo: "fora_do_perfil" };
  if (c === "qualificado" || t === "quente") return { qualidade: "bom", motivo: "qualificado" };
  if (c === "pouco_qualificado" || t === "morno") return { qualidade: "medio", motivo: "curioso" };
  if (c === "inativo" || t === "frio") return { qualidade: "ruim", motivo: "sem_resposta" };

  return null;
}

export interface LeadQualityByAdRow {
  ad_key: string | null;
  ad_key_kind: "ad_id" | "titulo" | "sem_origem";
  ad_id: string | null;
  ad_name: string | null;
  leads_total: number;
  leads_bom: number;
  leads_medio: number;
  leads_ruim: number;
  vendas: number;
  leads_sem_classificacao: number;
  pct_bom: number | null;
}

/**
 * Lê a verdade por anúncio (a MESMA da view lead_quality_by_ad). Fonte única pros
 * cards (Bloco A) e pro chat (Bloco B). Ordena pelos piores primeiro (mais leads
 * ruins) pra o José priorizar o que pausar / re-segmentar.
 */
export async function leadQualityByAd(
  admin: any,
  userId: string,
  opts?: { minLeads?: number },
): Promise<LeadQualityByAdRow[]> {
  const { data, error } = await admin
    .from("lead_quality_by_ad")
    .select("ad_key, ad_key_kind, ad_id, ad_name, leads_total, leads_bom, leads_medio, leads_ruim, vendas, leads_sem_classificacao, pct_bom")
    .eq("user_id", userId);
  if (error || !data) return [];
  const min = opts?.minLeads ?? 1;
  return (data as LeadQualityByAdRow[])
    .filter((r) => Number(r.leads_total) >= min)
    .sort((a, b) => Number(b.leads_ruim) - Number(a.leads_ruim));
}

// Rótulos legíveis dos motivos que o Pedro grava no fechamento (motivo_classificacao).
// É o "porquê" do lead ser bom/ruim — em linguagem de gente, não em código.
export const MOTIVO_LABEL: Record<string, string> = {
  fora_do_perfil: "fora do perfil",
  curioso: "só curioso",
  sem_resposta: "sumiu / não respondeu",
  numero_errado: "número errado",
  sem_interesse: "sem interesse",
  comprou: "comprou",
  qualificado: "qualificado / quente",
};

// "5 fora do perfil, 3 só curioso, 2 sumiu" — top 3 motivos de um balde, em PT.
export function formatMotivos(counts: Record<string, number>): string | null {
  const entries = Object.entries(counts || {})
    .filter(([k]) => k && k !== "sem_motivo")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (!entries.length) return null;
  return entries.map(([k, n]) => `${n} ${MOTIVO_LABEL[k] || k.replace(/_/g, " ")}`).join(", ");
}

export interface AdMotivos { ruim: Record<string, number>; medio: Record<string, number>; bom: Record<string, number>; }

/**
 * Agrega o PORQUÊ (motivo_classificacao do Pedro) por anúncio. A chave bate com o
 * ad_key da view lead_quality_by_ad (ad_id; senão o título normalizado). É o "porquê"
 * por trás das contagens — deixa o José explicar POR QUE um anúncio traz lead ruim/bom
 * ("traz muita gente fora da praça / só curiosa"), não só QUANTOS. Agrega em JS pra não
 * precisar de migration; só leads JÁ classificados pelo Pedro entram.
 */
export async function leadMotivosByAd(admin: any, userId: string): Promise<Map<string, AdMotivos>> {
  const { data, error } = await admin
    .from("ai_crm_leads")
    .select("ad_id, ad_name, qualidade_lead, motivo_classificacao")
    .eq("user_id", userId)
    .not("qualidade_lead", "is", null);
  const map = new Map<string, AdMotivos>();
  if (error || !data) return map;
  for (const l of data as any[]) {
    const key = l.ad_id || (l.ad_name ? String(l.ad_name).trim().toLowerCase() : null);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { ruim: {}, medio: {}, bom: {} });
    const b = map.get(key)!;
    const q = String(l.qualidade_lead || "");
    const m = String(l.motivo_classificacao || "sem_motivo");
    const bucket = q === "ruim" ? b.ruim : q === "medio" ? b.medio : q === "bom" ? b.bom : null;
    if (bucket) bucket[m] = (bucket[m] || 0) + 1;
  }
  return map;
}

export interface SellerFeedbackAgg { alta: number; normal: number; baixa: number; total: number; reasons: string[]; }

/**
 * Agrega o FEEDBACK DO VENDEDOR (pedro_manager_feedback) por anúncio — a VERDADE de quem
 * ATENDEU o lead, mais forte que o palpite da IA do Pedro. priority = high|normal|low (alta/
 * normal/baixa); reason = o porquê que o vendedor deu (guardamos os das BAIXAS, que é o que o
 * José precisa pra cortar verba). Pega o ÚLTIMO feedback de cada lead, mapeia lead -> ad_key
 * (ad_id senão título — mesma chave de leadQualityByAd). Vazio quando não há feedback.
 */
export async function sellerFeedbackByAd(admin: any, userId: string): Promise<Map<string, SellerFeedbackAgg>> {
  const map = new Map<string, SellerFeedbackAgg>();
  const { data: fbs } = await admin.from("pedro_manager_feedback")
    .select("lead_id, priority, reason, created_at")
    .eq("user_id", userId)
    .not("lead_id", "is", null)
    .order("created_at", { ascending: false });
  const latest = new Map<string, { priority: string; reason: string | null }>();
  for (const f of (fbs || []) as any[]) {
    if (f.lead_id && !latest.has(f.lead_id)) {
      latest.set(f.lead_id, { priority: String(f.priority || "").toLowerCase().trim(), reason: f.reason ? String(f.reason) : null });
    }
  }
  if (latest.size === 0) return map;
  const { data: leads } = await admin.from("ai_crm_leads")
    .select("id, ad_id, ad_name").eq("user_id", userId).in("id", Array.from(latest.keys()));
  for (const l of (leads || []) as any[]) {
    const key = l.ad_id || (l.ad_name ? String(l.ad_name).trim().toLowerCase() : null);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { alta: 0, normal: 0, baixa: 0, total: 0, reasons: [] });
    const agg = map.get(key)!;
    const lf = latest.get(l.id)!;
    if (lf.priority === "high" || lf.priority === "alta") agg.alta++;
    else if (lf.priority === "low" || lf.priority === "baixa") { agg.baixa++; if (lf.reason && agg.reasons.length < 5) agg.reasons.push(lf.reason); }
    else agg.normal++;
    agg.total++;
  }
  return map;
}
