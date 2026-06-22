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
    .select("ad_key, ad_key_kind, ad_id, ad_name, leads_total, leads_bom, leads_medio, leads_ruim, leads_sem_classificacao, pct_bom")
    .eq("user_id", userId);
  if (error || !data) return [];
  const min = opts?.minLeads ?? 1;
  return (data as LeadQualityByAdRow[])
    .filter((r) => Number(r.leads_total) >= min)
    .sort((a, b) => Number(b.leads_ruim) - Number(a.leads_ruim));
}
