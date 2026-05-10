import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Horário operacional (Brasília) ───────────────────────────────────────────
// Dias normais (seg–sáb): 10:11 – 19:29
// Domingos e feriados:     11:11 – 17:29
// Leads criados fora da janela NÃO são repassados, mesmo que o vendedor
// não confirme. Ao entrar no horário, leads da noite NÃO são repassados
// retroativamente — só novos leads a partir do início da janela entram no rodízio.

function brasiliaMinutesOfDay(dt: Date): number {
  const utcMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
  return ((utcMin - 180) + 1440) % 1440; // UTC-3
}

function toBrasilia(dt: Date): Date {
  return new Date(dt.getTime() - 3 * 60 * 60 * 1000);
}

// ── Páscoa (algoritmo Computus) e feriados nacionais ─────────────────────────
function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function getBrazilianHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

  // Feriados fixos
  holidays.add(`${year}-01-01`); // Confraternização Universal
  holidays.add(`${year}-04-21`); // Tiradentes
  holidays.add(`${year}-05-01`); // Dia do Trabalho
  holidays.add(`${year}-09-07`); // Independência
  holidays.add(`${year}-10-12`); // Nossa Sra. Aparecida
  holidays.add(`${year}-11-02`); // Finados
  holidays.add(`${year}-11-15`); // Proclamação da República
  holidays.add(`${year}-12-25`); // Natal

  // Feriados móveis (baseados na Páscoa)
  const easter = getEasterDate(year);
  holidays.add(fmt(addDays(easter, -48))); // Segunda de Carnaval
  holidays.add(fmt(addDays(easter, -47))); // Terça de Carnaval
  holidays.add(fmt(addDays(easter, -2)));  // Sexta-feira Santa
  holidays.add(fmt(addDays(easter, 60)));  // Corpus Christi

  return holidays;
}

function isDomingoOuFeriado(dt: Date): boolean {
  const brasilia = toBrasilia(dt);
  if (brasilia.getUTCDay() === 0) return true; // Domingo
  const year = brasilia.getUTCFullYear();
  const dateStr = `${year}-${String(brasilia.getUTCMonth() + 1).padStart(2, "0")}-${String(brasilia.getUTCDate()).padStart(2, "0")}`;
  return getBrazilianHolidays(year).has(dateStr);
}

// Janela dinâmica conforme o dia
// Seg–Sex: 10:11–19:29 | Sáb: 10:11–18:29 | Dom/Feriado: 11:11–17:29
function getRepassWindow(dt: Date): { start: number; end: number; label: string } {
  const brasilia = toBrasilia(dt);
  const dow = brasilia.getUTCDay(); // 0=dom, 6=sáb

  // Feriado ou domingo
  if (dow === 0 || isDomingoOuFeriado(dt)) {
    return { start: 11 * 60 + 11, end: 17 * 60 + 29, label: "11:11–17:29 (dom/feriado)" };
  }
  // Sábado
  if (dow === 6) {
    return { start: 10 * 60 + 11, end: 18 * 60 + 29, label: "10:11–18:29 (sábado)" };
  }
  // Seg–Sex
  return { start: 10 * 60 + 11, end: 19 * 60 + 29, label: "10:11–19:29 (seg–sex)" };
}

function isWithinRepassWindow(dt: Date): boolean {
  const min = brasiliaMinutesOfDay(dt);
  const { start, end } = getRepassWindow(dt);
  return min >= start && min <= end;
}

// ── Função auxiliar: round-robin ──────────────────────────────────────────────
function sellerPhoneKey(seller: any): string {
  const digits = String(seller?.whatsapp_number || "").replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11 && local[2] === "9") return `${local.slice(0, 2)}${local.slice(3)}`;
  return local.slice(-10);
}

function pickNextSeller(sellers: any[], recentTransfers: any[], excludeId?: string, excludePhoneKey?: string): any | null {
  const seenPhones = new Set<string>();
  const active = sellers.filter(s => {
    const phoneKey = sellerPhoneKey(s);
    if (!s.is_active || s.id === excludeId || (excludePhoneKey && phoneKey === excludePhoneKey)) return false;
    if (phoneKey && seenPhones.has(phoneKey)) return false;
    if (phoneKey) seenPhones.add(phoneKey);
    return true;
  });
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

  // Aceita chamada via cron/gateway com JWT valido.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
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
    // ── Janela de repasse (horário de Brasília, UTC-3) ──────────────────────
    // Seg–Sáb: 10:11–19:29 | Dom/Feriado: 11:11–17:29
    const nowDate = new Date();
    const brasilMin = brasiliaMinutesOfDay(nowDate);
    const brasiliaHour = Math.floor(brasilMin / 60);
    const brasiliaMinute = brasilMin % 60;
    const window = getRepassWindow(nowDate);

    const isWorkingHours = isWithinRepassWindow(nowDate);

    if (!isWorkingHours) {
      console.log(`[Timeout] Fora da janela de repasse — ${brasiliaHour}:${String(brasiliaMinute).padStart(2, '0')} Brasília (janela: ${window.label}). Nenhum repasse feito.`);
      return new Response(
        JSON.stringify({
          ok: true,
          processed: 0,
          message: `Fora do horário de repasse (${window.label}). Hora atual em Brasília: ${brasiliaHour}:${String(brasiliaMinute).padStart(2, '0')}`,
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
        member:ai_team_members!ai_lead_transfers_to_member_id_fkey(id, name, whatsapp_number, agent_id)
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

        // ── Regra de horário: só repassa se o transfer foi CRIADO dentro da
        //    janela 10:11–19:29 Brasília. Leads que chegaram durante a noite
        //    ficam com o vendedor — não são repassados retroativamente. ──────
        const transferCreatedAt = new Date(transfer.created_at || now);
        if (!isWithinRepassWindow(transferCreatedAt)) {
          console.log(`[Timeout] Transfer ${transfer.id} criado fora do horário de repasse (${transferCreatedAt.toISOString()}). Auto-confirmando — lead fica com vendedor atual.`);
          await supabase.from("ai_lead_transfers")
            .update({ transfer_status: "confirmed", is_confirmed: true })
            .eq("id", transfer.id);
          continue;
        }

        // 1. Marca transfer atual como expirado
        await supabase.from("ai_lead_transfers")
          .update({ transfer_status: "expired" })
          .eq("id", transfer.id);

        // 2. Busca instância da API para poder enviar WhatsApp
        const agentId = lead.agent_id || expiredSeller.agent_id;
        const instanceIds: string[] = lead.agent?.instance_ids || [];
        const { data: waInstance } = await supabase
          .from("wa_instances")
          .select("api_url, api_key_encrypted, instance_name")
          .in("id", instanceIds.length > 0 ? instanceIds : ["00000000-0000-0000-0000-000000000000"])
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
          .eq("user_id", transfer.user_id)
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
          expiredSeller.id,
          sellerPhoneKey(expiredSeller)
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
