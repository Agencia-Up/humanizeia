/**
 * proactiveSummary.ts — José v3.1 / Fase 6 (Otimização proativa)
 *
 * José abre conversa sozinho: gera um resumo PROATIVO (oportunidades + riscos +
 * 1 ação sugerida) com base na hierarquia de verdade (veredito), aprendizado e
 * vendas, e manda pro WhatsApp do responsável. É RECOMENDAÇÃO (informativo) —
 * agir de fato continua passando pelos guardrails/gate.
 */

import { callAiGateway } from "./aiGateway.ts";
import { resolveApprovalNumbers } from "./approvalGate.ts";
import { resolvePedroInstance, sendPedroText } from "../pedro-v2/uazapiSender.ts";

async function gatherContext(admin: any, userId: string): Promise<string> {
  const partes: string[] = [];
  try {
    const { data: vd } = await admin.from("jose_campaign_verdict")
      .select("veredito, justificativa, nivel3, created_at").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (vd) partes.push(`Último veredito: ${vd.veredito}. ${vd.justificativa || ""} (vendas: ${vd.nivel3?.vendas ?? "?"}, custo/venda: ${vd.nivel3?.custo_por_venda ?? "?"})`);
  } catch (_e) { /* ignore */ }
  try {
    const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const { count } = await admin.from("comercial_vendas").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("data_venda", since);
    partes.push(`Vendas nos últimos 7 dias: ${count || 0}.`);
  } catch (_e) { /* ignore */ }
  try {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count } = await admin.from("ai_crm_leads").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
    const { count: q } = await admin.from("ai_crm_leads").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status_crm", ["qualificado", "negociacao", "fechado"]).gte("created_at", since);
    partes.push(`Leads 7d: ${count || 0}, qualificados: ${q || 0}.`);
  } catch (_e) { /* ignore */ }
  try {
    const { data: learn } = await admin.from("apollo_learning").select("insight").eq("user_id", userId).eq("is_active", true).order("confidence", { ascending: false }).limit(4);
    if (learn?.length) partes.push(`Aprendizado: ${(learn as any[]).map((l) => l.insight).join(" | ")}`);
  } catch (_e) { /* ignore */ }
  return partes.join("\n");
}

export async function buildProactiveSummary(admin: any, userId: string): Promise<string | null> {
  const contexto = await gatherContext(admin, userId);
  const system = [
    "Você é o JOSÉ, gestor de tráfego pago, escrevendo PROATIVAMENTE pro dono no WhatsApp (ele não pediu).",
    "Escreva um resumo CURTO e acionável da semana, em português de gestor, com 3 partes:",
    "1) *Oportunidades* (onde dá pra crescer), 2) *Riscos* (o que vigiar), 3) *Sugestão* (UMA ação concreta).",
    "Use a hierarquia de verdade (venda > lead qualificado > vitrine). NÃO invente números — use só o contexto.",
    "Comece com '🤖 *José — resumo da semana*'. Máximo ~8 linhas.",
  ].join(" ");
  try {
    const r = await callAiGateway(admin, {
      user_id: userId, capability: "llm",
      input: { system, messages: [{ role: "user", content: `Contexto da conta:\n${contexto}\n\nEscreva o resumo proativo.` }], max_tokens: 500 },
      ref_tipo: "proactive_summary",
    });
    return (r.ok && r.text) ? r.text.trim() : null;
  } catch (_e) { return null; }
}

// Gera e MANDA o resumo pro WhatsApp do responsável. Best-effort.
export async function sendProactiveSummary(admin: any, userId: string): Promise<{ sent: boolean; reason?: string }> {
  try {
    const numbers = await resolveApprovalNumbers(admin, userId);
    if (!numbers.length) return { sent: false, reason: "sem_numero" };
    const text = await buildProactiveSummary(admin, userId);
    if (!text) return { sent: false, reason: "sem_resumo" };
    const instance = await resolvePedroInstance(admin, { user_id: userId, agent_id: null });
    if (!instance) return { sent: false, reason: "sem_instancia" };
    await sendPedroText(instance, { to: numbers[0], text });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: String((e as any)?.message || e) };
  }
}
