// wa-capi-ctwa-send — Conversions API for Business Messaging (Click-to-WhatsApp).
// Drena a fila public.wa_ctwa_capi_events e envia eventos com o formato CTWA:
//   action_source: "business_messaging", messaging_channel: "whatsapp",
//   user_data: { whatsapp_business_account_id (WABA), ctwa_clid, ph (SHA-256) }.
//
// Isolado do fluxo de qualificacao: e disparado por cron (gatilho no banco
// enfileira). Falha NUNCA derruba nada — cada evento e tratado em try/catch.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_GRAPH_URL = "https://graph.facebook.com/v21.0"; // versao padrao do projeto
const MAX_ATTEMPTS = 3;
const BATCH_LIMIT = 200;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Le a claim "role" de um JWT (service_role quando chamado pelo cron). Best-effort.
function jwtRole(tok: string): string | null {
  try {
    const part = tok.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    return JSON.parse(json).role || null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ── Auth: cron (service role) processa tudo; usuario processa so o dele ──
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    let scopedUserId: string | null = null;
    if (token && (token === SERVICE_ROLE_KEY || jwtRole(token) === "service_role")) {
      scopedUserId = null; // cron/admin: todos os pendentes
    } else if (token) {
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      scopedUserId = user.id;
    } else {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Carrega pendentes ──
    let q = admin.from("wa_ctwa_capi_events").select("*").eq("status", "pending").order("created_at", { ascending: true }).limit(BATCH_LIMIT);
    if (scopedUserId) q = q.eq("user_id", scopedUserId);
    const { data: events, error: qErr } = await q;
    if (qErr) throw qErr;

    const summary = { processed: 0, sent: 0, failed: 0, skipped: 0 };
    // cache de pixel por user_id pra nao repetir lookup
    const pixelCache = new Map<string, any>();

    for (const ev of (events || [])) {
      summary.processed++;
      try {
        // Resolve pixel/dataset + token + waba do tenant
        let pixel = pixelCache.get(ev.user_id);
        if (pixel === undefined) {
          const { data: px } = await admin.from("meta_pixels")
            .select("pixel_id, access_token_encrypted, waba_id")
            .eq("user_id", ev.user_id).eq("is_active", true)
            .order("updated_at", { ascending: false }).limit(1).maybeSingle();
          pixel = px || null;
          pixelCache.set(ev.user_id, pixel);
        }

        const accessToken = pixel?.access_token_encrypted || null;
        const datasetId = pixel?.pixel_id || null;
        const wabaId = pixel?.waba_id || null;

        // Config faltando? marca skipped (nao e erro — so falta o usuario configurar).
        if (!accessToken || !datasetId) {
          await admin.from("wa_ctwa_capi_events").update({
            status: "skipped", error_message: "pixel/token ausente (meta_pixels)", attempts: ev.attempts + 1,
          }).eq("id", ev.id);
          summary.skipped++;
          continue;
        }
        if (!wabaId) {
          await admin.from("wa_ctwa_capi_events").update({
            status: "skipped", error_message: "waba_id ausente (meta_pixels.waba_id)", attempts: ev.attempts + 1,
          }).eq("id", ev.id);
          summary.skipped++;
          continue;
        }

        // Telefone hasheado (SHA-256) a partir do remote_jid (so digitos).
        const phoneDigits = String(ev.remote_jid || "").replace(/\D/g, "");
        const userData: Record<string, any> = {
          whatsapp_business_account_id: wabaId,
          ctwa_clid: ev.ctwa_clid,
        };
        if (phoneDigits.length >= 8) userData.ph = [await sha256Hex(phoneDigits)];

        const payload = {
          data: [{
            event_name: ev.event_name,
            event_time: Math.floor(Date.now() / 1000),
            action_source: "business_messaging",
            messaging_channel: "whatsapp",
            user_data: userData,
            custom_data: { lead_id: ev.lead_id },
          }],
          partner_agent: "logosia",
        };

        const res = await fetch(`${META_GRAPH_URL}/${datasetId}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, access_token: accessToken }),
        });
        const bodyText = await res.text();

        if (res.ok) {
          await admin.from("wa_ctwa_capi_events").update({
            status: "sent", response_code: res.status, response_body: bodyText.slice(0, 2000),
            attempts: ev.attempts + 1, sent_at: new Date().toISOString(),
          }).eq("id", ev.id);
          summary.sent++;
        } else {
          const nextAttempts = ev.attempts + 1;
          const giveUp = nextAttempts >= MAX_ATTEMPTS;
          await admin.from("wa_ctwa_capi_events").update({
            status: giveUp ? "failed" : "pending", // se nao desistiu, tenta de novo no proximo cron
            response_code: res.status, response_body: bodyText.slice(0, 2000),
            error_message: `meta_${res.status}`, attempts: nextAttempts,
          }).eq("id", ev.id);
          summary.failed++;
        }
      } catch (evErr) {
        // Erro inesperado num evento nao pode parar o lote.
        const nextAttempts = (ev.attempts || 0) + 1;
        await admin.from("wa_ctwa_capi_events").update({
          status: nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending",
          error_message: String(evErr).slice(0, 500), attempts: nextAttempts,
        }).eq("id", ev.id);
        summary.failed++;
      }
    }

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[wa-capi-ctwa-send] erro fatal:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
