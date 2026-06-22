/**
 * joseTools.ts — José Cabine de Comando / Bloco B (chat)
 *
 * As ferramentas que o José pode chamar no chat. Cada uma usa a MESMA função que
 * renderiza os cards do painel (dashboardQueries / leadQuality) -> o chat e o painel
 * leem a mesma camada de dados e NUNCA divergem. Fase 1 = consultivo (só leitura);
 * propor_acao (ação sob gate) entra num incremento seguinte.
 */

import { getDashboardCards } from "./dashboardQueries.ts";
import { leadQualityByAd } from "./leadQuality.ts";

// Definições no formato de tools da Anthropic (function-calling).
export const JOSE_TOOLS = [
  {
    name: "consultar_cabine",
    description:
      "Indicadores gerais da conta de anúncios (a Cabine): investido, CPL da vitrine, " +
      "CUSTO POR LEAD BOM (a verdade), CPM, CPC, conversas, quebra por idade e por região " +
      "(entrega x origem real). Use para QUALQUER pergunta sobre números gerais da conta.",
    input_schema: {
      type: "object",
      properties: {
        periodo: {
          type: "string",
          enum: ["today", "yesterday", "last_7d", "last_30d"],
          description: "Janela de tempo. Padrão last_7d.",
        },
      },
    },
  },
  {
    name: "consultar_qualidade_por_anuncio",
    description:
      "A VERDADE por anúncio: quantos leads bons / médios / ruins cada anúncio trouxe, " +
      "classificados pelo Pedro no atendimento. Use para 'de qual anúncio vêm os leads " +
      "bons/ruins', 'qual anúncio pausar', 'qual anúncio escalar'.",
    input_schema: { type: "object", properties: {} },
  },
];

export async function executeJoseTool(
  admin: any,
  userId: string,
  name: string,
  args: any,
): Promise<any> {
  if (name === "consultar_cabine") {
    const cards = await getDashboardCards(admin, userId, { datePreset: args?.periodo || "last_7d" });
    if (!cards) return { erro: "Nenhuma conta de anúncios da Meta ativa." };
    // Resumo enxuto (não o objeto inteiro) pra economizar tokens no loop.
    return {
      periodo: cards.periodo, moeda: cards.moeda,
      investido: cards.gasto, conversas_meta: cards.conversas,
      leads_recebidos: cards.leads_recebidos, qualificados: cards.leads_bom,
      cpl_vitrine: cards.cpl, custo_por_lead_bom: cards.custo_por_lead_bom, leads_bom: cards.leads_bom,
      vendas: cards.vendas, custo_por_venda: cards.custo_por_venda,
      cpm: cards.cpm, cpc: cards.cpc,
      por_idade: cards.idade.slice(0, 5),
      por_publico: cards.por_publico.slice(0, 6),
      por_criativo: cards.por_criativo.slice(0, 6),
      regiao_entrega: cards.regiao_entrega.slice(0, 5),
      regiao_origem_real: cards.regiao_origem.slice(0, 5),
      atribuicao: cards.atribuicao,
    };
  }
  if (name === "consultar_qualidade_por_anuncio") {
    const rows = await leadQualityByAd(admin, userId, { minLeads: 1 });
    return {
      total_anuncios: rows.length,
      anuncios: rows.slice(0, 20).map((r) => ({
        anuncio: r.ad_name, origem: r.ad_key_kind,
        leads: r.leads_total, bons: r.leads_bom, medios: r.leads_medio, ruins: r.leads_ruim,
        vendas: (r as any).vendas, sem_classificacao: r.leads_sem_classificacao, pct_bom: r.pct_bom,
      })),
    };
  }
  return { erro: `ferramenta desconhecida: ${name}` };
}
