/**
 * campaignDraft.ts — José v3.1 / Fase 4 (Criação de campanha)
 *
 * José gera um RASCUNHO de campanha (objetivo, público, criativo, orçamento) a
 * partir de um pedido em linguagem natural, usando aprendizado (apollo_learning)
 * + templates (jose_campaign_templates) + nicho. Roda uma SIMULAÇÃO (estimativa
 * de custo/alcance) e grava em jose_generated_campaigns como 'rascunho'. NÃO cria
 * na Meta aqui — isso passa pelo gate/aprovação e pelo CampanhaCreator.
 */

import { callAiGateway } from "./aiGateway.ts";

function parseJsonLoose(text: string): any {
  try { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch (_e) { return null; }
}
function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Simulação heurística (estimativa). Alcance/leads aproximados pelo orçamento —
// uma estimativa real (delivery_estimate da Meta) é refinamento futuro.
function simular(orcamento_diario: number, dias = 7) {
  const total = orcamento_diario * dias;
  const cpm = 18;                       // R$ por mil impressões (referência BR)
  const ctr = 0.012;                    // 1,2%
  const cpl = 22;                       // R$ por lead (vitrine, referência)
  const impressoes = total > 0 ? Math.round((total / cpm) * 1000) : 0;
  const cliques = Math.round(impressoes * ctr);
  const leads_estimados = cpl > 0 ? Math.round(total / cpl) : 0;
  return { periodo_dias: dias, investimento_total: total, impressoes_estimadas: impressoes, cliques_estimados: cliques, leads_estimados, cpl_referencia: cpl, observacao: "Estimativa de referência (não é o delivery estimate da Meta)." };
}

export async function generateCampaignDraft(
  admin: any,
  input: { user_id: string; ad_account_id?: string | null; prompt: string },
): Promise<{ ok: boolean; draft_id?: string; objetivo?: string; payload?: any; simulacao?: any; justificativa?: string; error?: string }> {
  // contexto: nicho + aprendizado + templates
  let nicho = "generico";
  try {
    if (input.ad_account_id) {
      const { data } = await admin.from("ad_accounts").select("nicho").eq("id", input.ad_account_id).maybeSingle();
      if (data?.nicho) nicho = data.nicho;
    }
  } catch (_e) { /* ignore */ }

  let aprendizado: string[] = [];
  try {
    const { data } = await admin.from("apollo_learning").select("insight").eq("user_id", input.user_id).eq("is_active", true).order("confidence", { ascending: false }).limit(6);
    aprendizado = (data || []).map((r: any) => r.insight).filter(Boolean);
  } catch (_e) { /* ignore */ }

  let templates: any[] = [];
  try {
    const { data } = await admin.from("jose_campaign_templates").select("nome, objetivo, estrutura").eq("ativo", true).or(`user_id.is.null,user_id.eq.${input.user_id}`).limit(4);
    templates = data || [];
  } catch (_e) { /* ignore */ }

  const system = [
    "Você é o JOSÉ, gestor de tráfego pago. A partir do PEDIDO do dono, gere um RASCUNHO de campanha Meta.",
    `Nicho: '${nicho}'. Responda APENAS um JSON com: objetivo (string), publico {localizacao (string), idade_min (int),`,
    "idade_max (int), genero ('todos'|'homem'|'mulher'), interesses (array)}, criativo {titulo (string), texto (string),",
    "cta (string)}, orcamento_diario_brl (number), justificativa (1-2 frases). Use o aprendizado e o nicho. Em português, realista.",
  ].join(" ");
  const ctx = `Pedido: ${input.prompt}\n\nAprendizado do José:\n- ${aprendizado.join("\n- ")}\n\nTemplates disponíveis: ${templates.map((t) => t.nome).join(", ")}`;

  let draft: any = null, justificativa = "";
  try {
    const r = await callAiGateway(admin, {
      user_id: input.user_id, capability: "llm",
      input: { system, messages: [{ role: "user", content: ctx }], max_tokens: 900 },
      ref_tipo: "campaign_draft",
    });
    if (!r.ok || !r.text) return { ok: false, error: r.error || "geracao_falhou" };
    draft = parseJsonLoose(r.text);
    if (!draft) return { ok: false, error: "rascunho_invalido" };
    justificativa = String(draft.justificativa || "");
  } catch (e) {
    return { ok: false, error: String((e as any)?.message || e) };
  }

  const orcamento = num(draft.orcamento_diario_brl) || 30;
  const simulacao = simular(orcamento);

  let draftId: string | null = null;
  try {
    const { data } = await admin.from("jose_generated_campaigns").insert({
      user_id: input.user_id, ad_account_id: input.ad_account_id || null, platform: "meta",
      objetivo: String(draft.objetivo || ""), payload: draft, simulacao, status: "rascunho",
    }).select("id").maybeSingle();
    draftId = data?.id || null;
  } catch (_e) { /* ignore */ }

  return { ok: true, draft_id: draftId, objetivo: draft.objetivo, payload: draft, simulacao, justificativa };
}
