/**
 * pedro-process-feedback
 *
 * Chamada pelo frontend quando um vendedor submete feedback estruturado para o gerente.
 * Persiste em `pedro_manager_feedback` e dispara notificação WhatsApp
 * para o gerente (via gerente_phone em wa_ai_agents).
 *
 * Body esperado:
 * {
 *   lead_id: string,
 *   member_id: string,
 *   content: string,          // resumo legível (compatibilidade)
 *   priority: 'low' | 'normal' | 'high' | 'urgent',
 *   city?: string,            // cidade do cliente
 *   reason?: string,          // motivo da não-compra
 *   observations?: string     // observações adicionais
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRIORITY_EMOJI: Record<string, string> = {
  low:    "ℹ️",
  normal: "💬",
  high:   "⚠️",
  urgent: "🚨",
};

const PRIORITY_LABEL: Record<string, string> = {
  low:    "Baixa",
  normal: "Normal",
  high:   "Alta",
  urgent: "Urgente",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  try {
    // ── Autenticação ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Não autorizado");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error("Token inválido");

    const body = await req.json();
    const {
      lead_id,
      member_id,
      content,
      priority = "normal",
      city = null,
      reason = null,
      observations = null,
    } = body;

    if (!lead_id || !content) {
      throw new Error("lead_id e content são obrigatórios");
    }

    // ── Busca dados do lead e do membro ──────────────────────────────────────
    const [leadRes, memberRes] = await Promise.all([
      supabase.from("ai_crm_leads" as any)
        .select("id, lead_name, remote_jid, user_id")
        .eq("id", lead_id)
        .single(),
      member_id
        ? supabase.from("ai_team_members" as any)
            .select("id, name, user_id, agent_id")
            .eq("id", member_id)
            .single()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const lead   = leadRes.data   as any;
    const member = memberRes.data as any;

    if (!lead) throw new Error("Lead não encontrado");

    // user_id do gerente = user_id do lead (sempre o dono)
    const gerenteUserId = lead.user_id;

    // ── Persiste o feedback (com campos estruturados) ────────────────────────
    const { data: feedback, error: insertErr } = await supabase
      .from("pedro_manager_feedback" as any)
      .insert({
        lead_id,
        user_id:      gerenteUserId,
        member_id:    member_id || null,
        content,
        priority,
        city:         city || null,
        reason:       reason || null,
        observations: observations || null,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    // ── Notificação WhatsApp para o gerente ──────────────────────────────────
    try {
      const agentId = member?.agent_id;
      if (agentId) {
        const { data: agent } = await supabase
          .from("wa_ai_agents" as any)
          .select("gerente_phone, instance_id, instance_ids")
          .eq("id", agentId)
          .single();

        const gerentePhone  = (agent as any)?.gerente_phone;
        const instanceIds   = (agent as any)?.instance_ids || [];
        const instanceId    = instanceIds[0] || (agent as any)?.instance_id;

        if (gerentePhone && instanceId) {
          const { data: instance } = await supabase
            .from("wa_instances" as any)
            .select("api_url, api_key_encrypted, instance_name")
            .eq("id", instanceId)
            .single();

          if (instance && (instance as any).api_url) {
            const emoji       = PRIORITY_EMOJI[priority] || "💬";
            const prioLabel   = PRIORITY_LABEL[priority] || priority;
            const leadName    = lead.lead_name || lead.remote_jid || "Lead";
            const sellerName  = member?.name || "Vendedor";
            const now         = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

            // ── Mensagem formatada estilo "RELATÓRIO DE LEAD" ────────────
            const lines: string[] = [
              `${emoji} *FEEDBACK DO VENDEDOR*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              ``,
              `👤 *Vendedor:* ${sellerName}`,
              `📋 *Lead:* ${leadName}`,
              `🕐 *Horário:* ${now}`,
              `🔖 *Prioridade:* ${prioLabel}`,
              ``,
            ];

            if (city) {
              lines.push(`🏙️ *Cidade do cliente:* ${city}`);
            }

            if (reason) {
              lines.push(`❌ *Motivo da não-compra:*`);
              lines.push(`_${reason}_`);
            }

            if (city || reason) {
              lines.push(``);
            }

            if (observations) {
              lines.push(`📝 *Observações:*`);
              lines.push(`_${observations}_`);
              lines.push(``);
            }

            lines.push(`━━━━━━━━━━━━━━━━━━━━`);
            lines.push(`_Enviado automaticamente pelo Pedro SDR_`);

            const msg = lines.join("\n");

            const baseUrl = (instance as any).api_url.replace(/\/$/, "");
            const instKey = (instance as any).api_key_encrypted || "";
            let phone     = gerentePhone.replace(/\D/g, "");
            if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;

            await fetch(`${baseUrl}/send/text`, {
              method:  "POST",
              headers: { "Content-Type": "application/json", "token": instKey },
              body:    JSON.stringify({ number: phone, text: msg }),
            }).catch(() => { /* falha silenciosa — notificação é best-effort */ });
          }
        }
      }
    } catch (notifyErr) {
      console.warn("[pedro-process-feedback] Falha na notificação:", notifyErr);
    }

    return new Response(
      JSON.stringify({ ok: true, feedback_id: (feedback as any)?.id }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[pedro-process-feedback] Erro:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Erro interno" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
