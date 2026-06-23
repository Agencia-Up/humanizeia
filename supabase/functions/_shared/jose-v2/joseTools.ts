/**
 * joseTools.ts — José Cabine de Comando / Bloco B (chat)
 *
 * As ferramentas que o José pode chamar no chat. As de LEITURA usam a MESMA função
 * que renderiza os cards do painel (dashboardQueries / leadQuality) -> chat e painel
 * leem a mesma camada de dados e NUNCA divergem.
 *
 * As de AÇÃO (listar_campanhas + propor_acao) só entram quando a flag `jose_acao`
 * está ligada pra conta. propor_acao NUNCA executa direto: passa pelos guardrails e
 * cria um GATE de aprovação (jose_action_approvals) — o dono autoriza no painel
 * (botão) ou no WhatsApp (SIM/NÃO). Reusa toda a infra da Fase 0.
 */

import { getDashboardCards, resolveMetaAccount, type MetaAccount } from "./dashboardQueries.ts";
import { leadQualityByAd } from "./leadQuality.ts";
import { checkGuardrails } from "./guardrails.ts";
import { sendApprovalWhatsApp } from "./approvalGate.ts";

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";
const APPROVAL_TTL_MS = (Number(Deno.env.get("JOSE_APPROVAL_TTL_HORAS")) || 2) * 60 * 60 * 1000;

// ── Ferramentas de LEITURA (sempre disponíveis no chat) ─────────────────────
const READ_TOOLS = [
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
  {
    name: "listar_campanhas",
    description:
      "Lista as campanhas da conta com nome, ID, status (ativa/pausada), verba diária, gasto " +
      "e conversas dos últimos 7 dias. Use pra ANALISAR as campanhas, ver o que gasta muito " +
      "e decidir o que pausar/escalar — cruzando com consultar_qualidade_por_anuncio (lead bom).",
    input_schema: { type: "object", properties: {} },
  },
];

// ── Ferramentas de AÇÃO (só com a flag jose_acao ligada) ────────────────────
const ACTION_TOOLS = [
  {
    name: "propor_acao",
    description:
      "Propõe uma ação na conta de anúncios (pausar/reativar uma campanha, subir/baixar a " +
      "verba diária). NÃO executa nada — cria uma PROPOSTA que o DONO autoriza (SIM/NÃO). " +
      "Use só DEPOIS de olhar os números (listar_campanhas + consultar_qualidade_por_anuncio) " +
      "e quando houver um motivo claro. SEMPRE preencha 'motivo' explicando o porquê.",
    input_schema: {
      type: "object",
      properties: {
        action_type: {
          type: "string",
          enum: ["pause", "activate", "increase_budget", "decrease_budget"],
          description: "pause=pausar campanha; activate=reativar; increase_budget/decrease_budget=mudar a verba diária.",
        },
        campaign_id: { type: "string", description: "ID da campanha alvo (pegue em listar_campanhas)." },
        daily_budget: {
          type: "number",
          description: "Nova verba diária EM REAIS (só para increase_budget/decrease_budget). Ex.: 80 = R$80/dia.",
        },
        motivo: {
          type: "string",
          description: "Explicação curta e clara do porquê — aparece pro dono aprovar. Ex.: 'gastou R$420 em 7 dias e só trouxe leads ruins'.",
        },
      },
      required: ["action_type", "campaign_id", "motivo"],
    },
  },
];

/** Monta a lista de ferramentas conforme a permissão de agir (flag jose_acao). */
export function getJoseTools(canAct: boolean) {
  return canAct ? [...READ_TOOLS, ...ACTION_TOOLS] : READ_TOOLS;
}

// Compat: importadores antigos que esperam a lista de leitura.
export const JOSE_TOOLS = READ_TOOLS;

// ── Helpers locais (espelham o jose-agent, sem importar o edge) ─────────────
function mapTipoAcao(actionType: string): string {
  const t = String(actionType || "");
  if (t.includes("pause") || t.includes("activate")) return "pausar_campanha"; // liga/desliga = mesma permissão
  if (t.includes("increase_budget")) return "escalar_orcamento";
  if (t.includes("decrease_budget")) return "reduzir_orcamento";
  return t || "acao_generica";
}
function riscoDaAcao(actionType: string, gastoAlterado: number): string {
  const t = String(actionType || "");
  if (t.includes("budget")) return gastoAlterado >= 200 ? "alto" : "medio";
  if (t.includes("pause")) return "baixo";
  if (t.includes("activate")) return "medio";
  return "medio";
}
function explicaBloqueio(reason: string): string {
  if (reason === "kill_switch_ligado") return "O botão de emergência (kill-switch) está ligado — nenhuma ação roda até desligar nas configurações.";
  if (reason === "permissao_desligada") return "As ações do José estão desligadas nas configurações desta conta.";
  if (reason === "permissao_so_analisa") return "Esta conta está em modo 'só analisar' — o José pode recomendar, mas não propor ação executável.";
  if (reason === "teto_custo_ia_mes_estourado") return "O teto de custo de IA do mês foi atingido.";
  return "Ação bloqueada pelas regras de segurança (" + reason + ").";
}

// Campanhas com ID + status + verba + gasto 7d (pra o José saber o que pausar).
async function fetchCampaignsForAction(acc: MetaAccount): Promise<any[]> {
  const cu = new URL(`${META_GRAPH_URL}/${acc.accountId}/campaigns`);
  cu.searchParams.set("access_token", acc.accessToken);
  cu.searchParams.set("fields", "id,name,status,effective_status,daily_budget,lifetime_budget");
  cu.searchParams.set("limit", "100");
  let campaigns: any[] = [];
  try {
    const r = await fetch(cu.toString());
    const d = await r.json();
    campaigns = Array.isArray(d?.data) ? d.data : [];
  } catch (_e) { /* */ }

  const iu = new URL(`${META_GRAPH_URL}/${acc.accountId}/insights`);
  iu.searchParams.set("access_token", acc.accessToken);
  iu.searchParams.set("level", "campaign");
  iu.searchParams.set("fields", "campaign_id,spend");
  iu.searchParams.set("date_preset", "last_7d");
  iu.searchParams.set("limit", "300");
  const spend = new Map<string, number>();
  try {
    const r = await fetch(iu.toString());
    const d = await r.json();
    for (const row of (d?.data || [])) spend.set(String(row.campaign_id), Number(row.spend) || 0);
  } catch (_e) { /* */ }

  return campaigns.map((c: any) => ({
    campaign_id: c.id,
    nome: c.name,
    status: c.effective_status || c.status,
    verba_diaria: c.daily_budget ? Number(c.daily_budget) / 100 : null, // Meta dá em centavos
    gasto_7d: Math.round((spend.get(String(c.id)) || 0) * 100) / 100,
  }));
}

export async function executeJoseTool(
  admin: any,
  userId: string,
  name: string,
  args: any,
  ctx?: { ad_account_id?: string | null },
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

  if (name === "listar_campanhas") {
    const acc = await resolveMetaAccount(admin, userId, ctx?.ad_account_id || undefined);
    if (!acc) return { erro: "Nenhuma conta de anúncios da Meta ativa." };
    const camps = (await fetchCampaignsForAction(acc)).sort((a, b) => b.gasto_7d - a.gasto_7d).slice(0, 25);
    return {
      moeda: acc.moeda, total: camps.length, campanhas: camps,
      obs: "verba_diaria e gasto_7d em " + acc.currency + ". status ACTIVE=ativa, PAUSED=pausada. Use o campaign_id no propor_acao.",
    };
  }

  if (name === "propor_acao") {
    const action_type = String(args?.action_type || "");
    const campaign_id = args?.campaign_id ? String(args.campaign_id) : null;
    const motivo = String(args?.motivo || "").trim();
    if (!action_type) return { erro: "action_type obrigatório (pause|activate|increase_budget|decrease_budget)." };
    if (!campaign_id) return { erro: "informe o campaign_id da campanha alvo (pegue em listar_campanhas)." };
    if (!motivo) return { erro: "explique o motivo da ação — vai aparecer pro dono aprovar." };

    const acc = await resolveMetaAccount(admin, userId, ctx?.ad_account_id || undefined);

    // Orçamento: o José pensa em REAIS; a Meta usa centavos.
    const params: any = {};
    let gastoAlterado = 0;
    if (action_type.includes("budget")) {
      const reais = Number(args?.daily_budget);
      if (!Number.isFinite(reais) || reais <= 0) {
        return { erro: "para mudar a verba, informe daily_budget em reais (ex.: 80)." };
      }
      params.daily_budget = Math.round(reais * 100);
      gastoAlterado = reais;
    }

    const tipoAcao = mapTipoAcao(action_type);
    const guard = await checkGuardrails(admin, {
      user_id: userId,
      ad_account_id: acc?.accountDbId || null,
      tipo_acao: tipoAcao,
      gasto_alterado: gastoAlterado,
    });
    if (guard.decision === "block") {
      return { resultado: "bloqueado", motivo_bloqueio: guard.reason, explicacao: explicaBloqueio(guard.reason) };
    }

    // SEMPRE cria gate de aprovação no chat (nunca executa direto, mesmo se os
    // guardrails permitiriam 'execute') — o dono é a trava final.
    const risco = riscoDaAcao(action_type, gastoAlterado);
    let approval: any = null;
    try {
      const { data: ap } = await admin.from("jose_action_approvals").insert({
        user_id: userId,
        ad_account_id: acc?.accountDbId || null,
        risco, tipo_acao: tipoAcao,
        payload: { campaign_id, adset_id: null, action_type, params },
        resumo_humano: motivo,
        status: "pendente",
        expira_em: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
      }).select().maybeSingle();
      approval = ap;
    } catch (e) {
      return { erro: "não consegui registrar a proposta: " + String((e as any)?.message || e) };
    }

    if (approval) {
      try { await sendApprovalWhatsApp(admin, { user_id: userId, agent_id: null, approval }); } catch (_e) { /* */ }
    }
    return {
      resultado: "aguardando_aprovacao",
      approval_id: approval?.id || null,
      resumo: motivo, risco, action_type,
      aviso: "Proposta criada. NÃO foi executada — está aguardando o dono autorizar (botão no painel ou SIM/NÃO no WhatsApp).",
    };
  }

  return { erro: `ferramenta desconhecida: ${name}` };
}
