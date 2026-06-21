/**
 * approvalGate.ts — José v3.1 / Fase 0 (leg do WhatsApp do gate SIM/NÃO)
 *
 * Quando o José precisa de aprovação, manda "Responda SIM/NÃO" pro WhatsApp do
 * responsável (pela MESMA instância do Pedro). A resposta volta pelo webhook do
 * Pedro e é interpretada AQUI — o número do responsável NUNCA vira lead.
 *
 * Lógica de EXECUÇÃO (applyApprovalDecision) é única: usada pelo painel
 * (jose-approval-handler) e pela resposta do WhatsApp.
 */

import { resolvePedroInstance, sendPedroText } from "../pedro-v2/uazapiSender.ts";
import { phonesMatch, remoteJidToPhone, normalizeBrazilPhone } from "../pedro-v2/phone.ts";
import { executeMetaAction } from "./metaActions.ts";

// Números do "dono" pra aprovação: o cadastrado (jose_spend_caps.aprovacao_whatsapp,
// linha user-level) + o profiles.phone. Normalizados, sem nulos/duplicados.
export async function resolveApprovalNumbers(supabase: any, userId: string): Promise<string[]> {
  const nums: string[] = [];
  try {
    const { data: caps } = await supabase.from("jose_spend_caps")
      .select("aprovacao_whatsapp").eq("user_id", userId).is("ad_account_id", null).maybeSingle();
    if (caps?.aprovacao_whatsapp) nums.push(caps.aprovacao_whatsapp);
  } catch (_e) { /* ignore */ }
  try {
    const { data: prof } = await supabase.from("profiles").select("phone").eq("id", userId).maybeSingle();
    if (prof?.phone) nums.push(prof.phone);
  } catch (_e) { /* ignore */ }
  return [...new Set(nums.map((n) => normalizeBrazilPhone(n)).filter(Boolean))];
}

export function parseSimNao(text: string): "aprovado" | "rejeitado" | null {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  if (/^(sim|s|ok|pode|confirmo|autorizo|aprovo|aprovado|👍|👍🏻|👍🏼)\b/.test(t)) return "aprovado";
  if (/^(n[aã]o|n|cancela|cancelar|nega|negar|rejeito|rejeitado|👎)\b/.test(t)) return "rejeitado";
  return null;
}

function resumoAcao(a: any): string {
  return a?.resumo_humano || `${a?.tipo_acao || "ação"} (${a?.payload?.campaign_id || "campanha"})`;
}

export function formatApprovalMessage(a: any): string {
  const risco = a?.risco ? ` (risco ${a.risco})` : "";
  return [
    `🤖 *José* precisa da sua autorização${risco}:`,
    ``,
    resumoAcao(a),
    ``,
    `Responda *SIM* pra autorizar ou *NÃO* pra cancelar.`,
  ].join("\n");
}

// Manda o gate pro WhatsApp do responsável. Best-effort: nunca lança (se não houver
// número/instância, o gate continua valendo pelo painel). Marca enviado_em.
export async function sendApprovalWhatsApp(
  supabase: any,
  input: { user_id: string; agent_id?: string | null; approval: any },
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const numbers = await resolveApprovalNumbers(supabase, input.user_id);
    if (!numbers.length) return { sent: false, reason: "sem_numero" };
    const instance = await resolvePedroInstance(supabase, { user_id: input.user_id, agent_id: input.agent_id || null });
    if (!instance) return { sent: false, reason: "sem_instancia" };
    await sendPedroText(instance, { to: numbers[0], text: formatApprovalMessage(input.approval) });
    try {
      await supabase.from("jose_action_approvals")
        .update({ enviado_em: new Date().toISOString(), canal_resposta: null })
        .eq("id", input.approval.id);
    } catch (_e) { /* ignore */ }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: String((e as any)?.message || e) };
  }
}

// EXECUÇÃO da decisão (única p/ painel e WhatsApp). aprovado -> executa na Meta +
// loga + marca; rejeitado -> só marca. admin = client service_role.
export async function applyApprovalDecision(
  admin: any,
  approval: any,
  decision: "aprovado" | "rejeitado",
  canal: "painel" | "whatsapp",
): Promise<{ ok: boolean; status: string; executed?: any; error?: string }> {
  if (decision === "rejeitado") {
    await admin.from("jose_action_approvals").update({
      status: "rejeitado", respondido_em: new Date().toISOString(), canal_resposta: canal,
    }).eq("id", approval.id);
    return { ok: true, status: "rejeitado" };
  }

  const payload = approval.payload || {};
  let acctQuery = admin.from("ad_accounts").select("*")
    .eq("user_id", approval.user_id).eq("platform", "meta").eq("is_active", true);
  if (approval.ad_account_id) acctQuery = acctQuery.eq("id", approval.ad_account_id);
  const { data: adAccount } = await acctQuery.limit(1).maybeSingle();

  if (!adAccount?.access_token_encrypted) {
    await admin.from("jose_action_approvals").update({
      status: "aprovado", respondido_em: new Date().toISOString(), canal_resposta: canal,
      resposta_raw: "aprovado_sem_conta",
    }).eq("id", approval.id);
    return { ok: false, status: "aprovado", error: "conta_meta_nao_encontrada" };
  }

  const result = await executeMetaAction(adAccount.access_token_encrypted, {
    campaign_id: payload.campaign_id, adset_id: payload.adset_id,
    action_type: payload.action_type, params: payload.params || {},
  });

  let logId: string | null = null;
  try {
    const { data: log } = await admin.from("apollo_action_log").insert({
      user_id: approval.user_id, campaign_id: payload.campaign_id, action_type: payload.action_type,
      params: payload.params || {}, result, executed_by: "guardrail_approved",
      executed_at: new Date().toISOString(), approval_id: approval.id, risco: approval.risco, platform: "meta",
    }).select("id").maybeSingle();
    logId = log?.id || null;
  } catch (_e) { /* ignore */ }

  await admin.from("jose_action_approvals").update({
    status: "aprovado", respondido_em: new Date().toISOString(), canal_resposta: canal, action_log_id: logId,
  }).eq("id", approval.id);

  return { ok: true, status: "aprovado", executed: result };
}

// Chamado no webhook do Pedro ANTES do fluxo de lead. Se o remetente é o número do
// responsável, trata como gate (e NUNCA vira lead). Retorna { handled }.
export async function handleApprovalReply(
  supabase: any, // service_role (lê caps/profiles/approvals + executa)
  input: { user_id: string; agent_id?: string | null; remote_jid: string; text: string; instance?: any },
): Promise<{ handled: boolean; action?: string }> {
  try {
    const fromPhone = remoteJidToPhone(input.remote_jid);
    if (!fromPhone) return { handled: false };

    // Caminho quente: 1 query barata. Sem aprovação pendente -> nem checa número,
    // segue o fluxo normal do Pedro (custo ~zero pra quem não usa o gate do José).
    const { data: pendentes } = await supabase.from("jose_action_approvals")
      .select("*").eq("user_id", input.user_id).eq("status", "pendente")
      .order("created_at", { ascending: false }).limit(1);
    const pending = (pendentes || [])[0] || null;
    if (!pending) return { handled: false };

    // Tem gate pendente: só agora confere se quem respondeu é o responsável.
    const owners = await resolveApprovalNumbers(supabase, input.user_id);
    const isOwner = owners.some((n) => phonesMatch(n, fromPhone));
    if (!isOwner) return { handled: false }; // não é o dono -> fluxo normal de lead

    const decision = parseSimNao(input.text);

    const reply = async (text: string) => {
      try {
        const instance = input.instance || await resolvePedroInstance(supabase, { user_id: input.user_id, agent_id: input.agent_id || null });
        if (instance) await sendPedroText(instance, { to: fromPhone, text });
      } catch (_e) { /* ignore */ }
    };

    if (pending && decision) {
      await supabase.from("jose_action_approvals").update({ resposta_raw: String(input.text || "").slice(0, 200) }).eq("id", pending.id);
      const res = await applyApprovalDecision(supabase, pending, decision, "whatsapp");
      if (decision === "aprovado") {
        await reply(res.ok ? "✅ Autorizado. José executou a ação." : "✅ Autorizado, mas não consegui executar agora (sem conta Meta ativa).");
      } else {
        await reply("❌ Cancelado. José não vai executar.");
      }
      return { handled: true, action: decision };
    }
    if (pending && !decision) {
      await reply(`Tem 1 aprovação pendente:\n\n${resumoAcao(pending)}\n\nResponda *SIM* ou *NÃO*.`);
      return { handled: true, action: "reprompt" };
    }
    // dono sem aprovação pendente -> só não vira lead (ignora silenciosamente)
    return { handled: true, action: "no_pending" };
  } catch (_e) {
    return { handled: false }; // fail-safe: em erro, NÃO bloqueia o fluxo do Pedro
  }
}
