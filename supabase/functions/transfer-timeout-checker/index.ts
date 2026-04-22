import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Função auxiliar: round-robin ──────────────────────────────────────────────
function pickNextSeller(sellers: any[], recentTransfers: any[], excludeId?: string): any | null {
  const active = sellers.filter(s => s.is_active && s.id !== excludeId);
  if (!active.length) return null;

  const lastMap = new Map<string, number>();
  for (const t of recentTransfers) {
    if (t.to_member_id && !lastMap.has(t.to_member_id))
      lastMap.set(t.to_member_id, new Date(t.created_at).getTime());
  }

  const neverReceived = active.filter(s => !lastMap.has(s.id));
  if (neverReceived.length) return neverReceived[0];

  return [...active].sort((a, b) =>
    (lastMap.get(a.id) || 0) - (lastMap.get(b.id) || 0)
  )[0] || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Aceita chamada via cron (service key no header) ou interna
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  if (token !== serviceKey) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey
  );

  try {
    // ── Janela de atendimento: 9h–20h (horário de Brasília, UTC-3) ──────────
    const nowDate = new Date();
    const utcMinutes = nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
    const brasiliaMinutes = ((utcMinutes - 180) + 1440) % 1440; // UTC-3
    const brasiliaHour = Math.floor(brasiliaMinutes / 60);

    const isWorkingHours = brasiliaHour >= 9 && brasiliaHour < 20;

    if (!isWorkingHours) {
      console.log(`[Timeout] Fora da janela de atendimento — ${brasiliaHour}h Brasília. Nenhum repasse feito.`);
      return new Response(
        JSON.stringify({
          ok: true,
          processed: 0,
          message: `Fora do horário de atendimento (9h–20h). Hora atual em Brasília: ${brasiliaHour}h`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // ────────────────────────────────────────────────────────────────────────

    const now = new Date().toISOString();

    // Busca todos os transfers pendentes que já expiraram
    // (inclui os que expiraram durante a noite e ainda não foram processados)
    const { data: expired, error: fetchErr } = await supabase
      .from("ai_lead_transfers")
      .select(`
        id, user_id, lead_id, to_member_id,
        lead:ai_crm_leads(id, remote_jid, lead_name, summary, agent_id,
          agent:wa_ai_agents(id, name, instance_ids)),
        member:ai_team_members(id, name, whatsapp_number, agent_id)
      `)
      .eq("transfer_status", "pending")
      .eq("is_confirmed", false)
      .lt("confirmation_timeout_at", now);

    if (fetchErr) throw fetchErr;
    if (!expired || expired.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "Nenhum transfer expirado" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Timeout] ${expired.length} transfer(s) expirado(s)`);
    let processed = 0;

    for (const transfer of expired) {
      try {
        const lead = transfer.lead as any;
        const expiredSeller = transfer.member as any;

        if (!lead || !expiredSeller) {
          // Marca como expirado mesmo sem dados completos
          await supabase.from("ai_lead_transfers")
            .update({ transfer_status: "expired" })
            .eq("id", transfer.id);
          continue;
        }

        // 1. Marca transfer atual como expirado
        await supabase.from("ai_lead_transfers")
          .update({ transfer_status: "expired" })
          .eq("id", transfer.id);

        // 2. Busca instância da API para poder enviar WhatsApp
        const agentId = lead.agent_id || expiredSeller.agent_id;
        const { data: waInstance } = await supabase
          .from("wa_instances")
          .select("api_url, api_key_encrypted, instance_name")
          .contains("id", lead.agent?.instance_ids || [])
          .limit(1)
          .maybeSingle();

        // 3. Avisa o vendedor que perdeu o lead
        if (waInstance && expiredSeller.whatsapp_number) {
          let expiredNum = expiredSeller.whatsapp_number.replace(/\D/g, "");
          if (expiredNum.length === 10 || expiredNum.length === 11) expiredNum = `55${expiredNum}`;

          const baseUrl = (waInstance.api_url || "").replace(/\/$/, "");
          const instKey = waInstance.api_key_encrypted || "";

          const missedMsg = `⚠️ *LEAD REPASSADO*\n\nO lead *${lead.lead_name || ""}* não teve sua confirmação dentro de 15 minutos e foi passado para o próximo da fila.\n\n🚫 *Por favor, não entre em contato com este lead.*`;

          await fetch(`${baseUrl}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "token": instKey },
            body: JSON.stringify({ number: expiredNum, text: missedMsg }),
          });

          console.log(`[Timeout] Aviso enviado para ${expiredSeller.name}`);
        }

        // 4. Round-robin — escolhe próximo vendedor (excluindo quem acabou de perder)
        const { data: allSellers } = await supabase
          .from("ai_team_members")
          .select("*")
          .eq("agent_id", agentId)
          .eq("is_active", true);

        const { data: recentTransfers } = await supabase
          .from("ai_lead_transfers")
          .select("to_member_id, created_at")
          .eq("user_id", transfer.user_id)
          .order("created_at", { ascending: false })
          .limit(100);

        const nextSeller = pickNextSeller(
          allSellers || [],
          recentTransfers || [],
          expiredSeller.id           // exclui quem acabou de perder
        );

        if (!nextSeller) {
          console.warn(`[Timeout] Nenhum outro vendedor ativo para repassar o lead ${lead.id}`);
          continue;
        }

        // 5. Cria novo transfer para o próximo vendedor
        const newTimeout = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await supabase.from("ai_lead_transfers").insert({
          user_id: transfer.user_id,
          lead_id: lead.id,
          from_member_id: expiredSeller.id,
          to_member_id: nextSeller.id,
          transfer_reason: "timeout_escalation",
          notes: `Repassado após timeout de ${expiredSeller.name}`,
          transfer_status: "pending",
          is_confirmed: false,
          confirmation_timeout_at: newTimeout,
        });

        // Atualiza lead com novo responsável
        await supabase.from("ai_crm_leads")
          .update({ assigned_to_id: nextSeller.id })
          .eq("id", lead.id);

        // 6. Envia mensagem para o próximo vendedor
        if (waInstance && nextSeller.whatsapp_number) {
          let nextNum = nextSeller.whatsapp_number.replace(/\D/g, "");
          if (nextNum.length === 10 || nextNum.length === 11) nextNum = `55${nextNum}`;

          const baseUrl = (waInstance.api_url || "").replace(/\/$/, "");
          const instKey = waInstance.api_key_encrypted || "";

          const nextMsg = `🚨 *LEAD QUALIFICADO — VOCÊ É O PRÓXIMO DA FILA*\n\n*Nome:* ${lead.lead_name || ""}\n\n📝 *Resumo:*\n${lead.summary || ""}\n\n⏰ *Responda esta mensagem em até 15 minutos para confirmar o recebimento. Se não responder, o lead passa para o próximo.*`;

          await fetch(`${baseUrl}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "token": instKey },
            body: JSON.stringify({ number: nextNum, text: nextMsg }),
          });

          console.log(`[Timeout] Lead repassado para ${nextSeller.name}`);
        }

        processed++;
      } catch (innerErr) {
        console.error(`[Timeout] Erro ao processar transfer ${transfer.id}:`, innerErr);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed, total_expired: expired.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[Timeout] Erro crítico:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
