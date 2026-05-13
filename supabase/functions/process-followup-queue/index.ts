import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  try {
    // ── REIVINDICAÇÃO ATÔMICA via RPC ─────────────────────────────────────
    // A função claim_followup_messages usa FOR UPDATE SKIP LOCKED + UPDATE
    // status='processing' RETURNING para garantir que cada item seja pego
    // por SOMENTE UM worker. Resolve o bug de duplicação quando duas
    // execuções (cron + manual ou cron sobreposto) rodam concorrentes.
    const { data: items, error } = await supabase
      .rpc("claim_followup_messages", { p_limit: 10 });

    if (error) throw error;
    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, message: "Nenhuma mensagem para enviar" }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    let sent = 0;
    let failed = 0;

    for (const item of items as any[]) {
      try {
        if (!item.api_url) throw new Error("Instância sem api_url");

        const baseUrl = String(item.api_url).replace(/\/$/, "");
        const instKey = item.api_key_encrypted || "";

        let phone = String(item.phone).replace(/\D/g, "");
        if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;

        const res = await fetch(`${baseUrl}/send/text`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "token": instKey,
            "apikey": instKey,
          },
          body: JSON.stringify({ number: phone, text: item.message_content }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
        }

        // Marca como enviado (sai de 'processing' → 'sent')
        await supabase.from("followup_queue").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", item.id);

        sent++;
      } catch (err: any) {
        console.error(`[followup-queue] Erro ao enviar item ${item.id}:`, err.message);
        const attempts = (item.attempt_count || 0) + 1;
        // Falhou: volta para 'scheduled' (retry) ou marca 'failed' se 3+ tentativas
        await supabase.from("followup_queue").update({
          status: attempts >= 3 ? "failed" : "scheduled",
          attempt_count: attempts,
          last_error: err.message,
          updated_at: new Date().toISOString(),
        }).eq("id", item.id);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, failed, total: items.length }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[process-followup-queue]", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
