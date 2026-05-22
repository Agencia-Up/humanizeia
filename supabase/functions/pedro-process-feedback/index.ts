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

// Potencial de compra do lead (low/normal/high/urgent mantidos como ids internos)
const PRIORITY_EMOJI: Record<string, string> = {
  low:    "❄️",
  normal: "🌡️",
  high:   "🔥",
  urgent: "🚀",
};

const PRIORITY_LABEL: Record<string, string> = {
  low:    "Frio",
  normal: "Morno",
  high:   "Quente",
  urgent: "Pronto pra comprar",
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
      lead_id,           // Pedro: aponta pra ai_crm_leads
      crm_lead_id,       // Marcos (M5): aponta pra crm_leads — exclusivo com lead_id
      member_id,
      content,
      priority = "normal",
      city = null,
      reason = null,
      observations = null,
    } = body;

    if ((!lead_id && !crm_lead_id) || !content) {
      throw new Error("lead_id (Pedro) OU crm_lead_id (Marcos) + content são obrigatórios");
    }
    if (lead_id && crm_lead_id) {
      throw new Error("Forneça APENAS lead_id OU crm_lead_id, não ambos");
    }

    // ── Busca dados do lead (Pedro OU Marcos) e do membro ────────────────────
    const leadTable = crm_lead_id ? "crm_leads" : "ai_crm_leads";
    const leadIdToFetch = crm_lead_id || lead_id;
    // Marcos: select diferente (name + phone em vez de lead_name + remote_jid)
    const leadSelect = crm_lead_id
      ? "id, name, phone, user_id"
      : "id, lead_name, remote_jid, user_id";

    const [leadRes, memberRes] = await Promise.all([
      supabase.from(leadTable as any)
        .select(leadSelect)
        .eq("id", leadIdToFetch)
        .single(),
      member_id
        ? supabase.from("ai_team_members" as any)
            .select("id, name, user_id, agent_id, auth_user_id")
            .eq("id", member_id)
            .single()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const leadRaw = leadRes.data as any;
    const member = memberRes.data as any;
    if (!leadRaw) throw new Error("Lead não encontrado");

    // Normaliza pra um shape comum (M5)
    const lead = crm_lead_id
      ? { id: leadRaw.id, lead_name: leadRaw.name, remote_jid: leadRaw.phone || '', user_id: leadRaw.user_id }
      : leadRaw;

    // user_id do gerente = user_id do lead (sempre o dono)
    const gerenteUserId = lead.user_id;

    // ── Lê config de scheduling do master (auto vs scheduled batch) ──────────
    const { data: feedbackCfg } = await supabase
      .from("manager_feedback_config" as any)
      .select("mode")
      .eq("user_id", gerenteUserId)
      .maybeSingle();
    const mode: "auto" | "scheduled" = ((feedbackCfg as any)?.mode === "scheduled") ? "scheduled" : "auto";
    // Se scheduled: persiste com pending_send=true e PULA envio imediato.
    //   cron-flush-manager-feedbacks processa no horário configurado.
    // Se auto: comportamento histórico — envia imediatamente.
    const isScheduled = mode === "scheduled";

    // ── Persiste o feedback (com campos estruturados) ────────────────────────
    const { data: feedback, error: insertErr } = await supabase
      .from("pedro_manager_feedback" as any)
      .insert({
        lead_id:      crm_lead_id ? null : lead_id,         // M5: XOR com crm_lead_id
        crm_lead_id:  crm_lead_id || null,                  // M5
        user_id:      gerenteUserId,
        member_id:    member_id || null,
        content,
        priority,
        city:         city || null,
        reason:       reason || null,
        observations: observations || null,
        pending_send: isScheduled, // true = aguarda janela horária
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    if (isScheduled) {
      // Modo scheduled — não envia agora, cron processará
      return new Response(
        JSON.stringify({ success: true, scheduled: true, feedback_id: (feedback as any)?.id }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // ── Notificação WhatsApp para o gerente (modo auto) ──────────────────────
    // Usa a INSTÂNCIA DO VENDEDOR (número conectado na conta dele).
    // Fallback (só Pedro): instância do agente IA caso vendedor não tenha instância.
    //
    // M5: gerentePhone tem 2 fontes:
    //   • PEDRO  → wa_ai_agents.gerente_phone (per-agente, via member.agent_id)
    //   • MARCOS → manager_feedback_config.gerente_phone_marcos (per-master, via gerenteUserId)
    try {
      const agentId = member?.agent_id;
      const sellerAuthId = member?.auth_user_id;

      // 1. Resolve gerentePhone conforme fluxo
      let gerentePhone: string | null = null;
      let agentForFallback: any = null;

      if (crm_lead_id) {
        // Marcos: lê da config per-master
        const { data: cfg } = await supabase
          .from("manager_feedback_config" as any)
          .select("gerente_phone_marcos")
          .eq("user_id", gerenteUserId)
          .maybeSingle();
        gerentePhone = (cfg as any)?.gerente_phone_marcos || null;
        if (!gerentePhone) {
          console.log("[pedro-process-feedback] Marcos: sem gerente_phone_marcos configurado em manager_feedback_config, pulando notificação");
        }
      } else if (agentId) {
        // Pedro: lê do agente IA (per-agente)
        const { data: agent } = await supabase
          .from("wa_ai_agents" as any)
          .select("gerente_phone, instance_id, instance_ids")
          .eq("id", agentId)
          .single();
        agentForFallback = agent;
        gerentePhone = (agent as any)?.gerente_phone || null;
        if (!gerentePhone) {
          console.log("[pedro-process-feedback] Pedro: sem gerente_phone configurado no agente, pulando notificação");
        }
      } else {
        console.log("[pedro-process-feedback] Pedro: member sem agent_id, sem como resolver gerente_phone");
      }

      if (gerentePhone) {
          // 2. Busca instância do VENDEDOR primeiro (mesma lógica pra Pedro e Marcos)
          let instanceData: any = null;

          if (sellerAuthId) {
            const { data: sellerInstance } = await supabase
              .from("wa_instances" as any)
              .select("api_url, api_key_encrypted, instance_name")
              .eq("user_id", sellerAuthId)
              .eq("is_active", true)
              .eq("status", "connected")
              .order("health_score", { ascending: false })
              .limit(1)
              .single();

            if (sellerInstance) {
              instanceData = sellerInstance;
              console.log(`[pedro-process-feedback] Usando instância do vendedor: ${(sellerInstance as any).instance_name}`);
            }
          }

          // 3. Fallback: instância do agente IA (SÓ Pedro — Marcos não tem agente IA)
          if (!instanceData && agentForFallback) {
            const agentInstanceIds = (agentForFallback as any)?.instance_ids || [];
            const agentInstanceId = agentInstanceIds[0] || (agentForFallback as any)?.instance_id;
            if (agentInstanceId) {
              const { data: agentInstance } = await supabase
                .from("wa_instances" as any)
                .select("api_url, api_key_encrypted, instance_name")
                .eq("id", agentInstanceId)
                .single();
              if (agentInstance) {
                instanceData = agentInstance;
                console.log(`[pedro-process-feedback] Fallback Pedro: usando instância do agente: ${(agentInstance as any).instance_name}`);
              }
            }
          }

          // 4. Fallback final (Marcos): se vendedor não tem instância, usa qualquer instância conectada do master
          if (!instanceData && crm_lead_id) {
            const { data: anyMasterInstance } = await supabase
              .from("wa_instances" as any)
              .select("api_url, api_key_encrypted, instance_name")
              .eq("user_id", gerenteUserId)
              .eq("is_active", true)
              .eq("status", "connected")
              .order("health_score", { ascending: false })
              .limit(1)
              .single();
            if (anyMasterInstance) {
              instanceData = anyMasterInstance;
              console.log(`[pedro-process-feedback] Fallback Marcos: usando instância do master: ${(anyMasterInstance as any).instance_name}`);
            }
          }

          if (instanceData && instanceData.api_url) {
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
              `🎯 *Potencial de compra:* ${prioLabel}`,
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

            const baseUrl = instanceData.api_url.replace(/\/$/, "");
            const instKey = instanceData.api_key_encrypted || "";
            let phone     = gerentePhone.replace(/\D/g, "");
            if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;

            console.log(`[pedro-process-feedback] Enviando para ${phone} via ${instanceData.instance_name}`);

            const sendRes = await fetch(`${baseUrl}/send/text`, {
              method:  "POST",
              headers: { "Content-Type": "application/json", "token": instKey, "apikey": instKey },
              body:    JSON.stringify({ number: phone, text: msg }),
            });

            const sendStatus = sendRes.status;
            const sendBody   = await sendRes.text().catch(() => "");
            console.log(`[pedro-process-feedback] UazAPI resposta: ${sendStatus} ${sendBody.slice(0, 200)}`);

            // Marca como enviado se sucesso (200-299)
            if (sendStatus >= 200 && sendStatus < 300 && (feedback as any)?.id) {
              await supabase.from("pedro_manager_feedback" as any)
                .update({ sent_to_manager_at: new Date().toISOString(), pending_send: false })
                .eq("id", (feedback as any).id);
            }
          } else {
            console.log("[pedro-process-feedback] Nenhuma instância encontrada para envio");
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
