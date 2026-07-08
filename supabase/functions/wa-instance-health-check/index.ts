/**
 * wa-instance-health-check
 *
 * Roda a cada 5 min (cron). Para CADA instância de WhatsApp (UazAPI) que deveria estar no ar,
 * consulta o status REAL no UazAPI e atualiza o banco — porque o `wa_instances.status`
 * fica DESATUALIZADO (a sessão cai e ninguém marca 'disconnected'; foi a causa do follow-up
 * do vendedor não disparar: instância "connected" no banco mas morta no WhatsApp).
 *
 * Para instâncias de VENDEDOR (seller_member_id != null) que estiverem DESCONECTADAS, a IA
 * (instância master conectada da loja) manda um LEMBRETE PRO VENDEDOR pedindo pra reconectar —
 * A CADA ~1 HORA (throttle de 55 min em disconnect_alert_sent_at), dentro da janela 07h–21h BRT,
 * até ele reconectar. Quando reconecta, o aviso é zerado (próxima queda recomeça).
 * A mensagem deixa claro que os LEADS CONTINUAM CHEGANDO — o que para são os follow-ups
 * automáticos dele e o acompanhamento das conversas (relatórios/feedbacks).
 *
 * Reusa o padrão de checagem de status do verify-instance-status.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Consulta o status REAL no UazAPI (V6): /instance/status -> /instance/connectionState/{name} -> POST /instance/connect.
async function checkRealStatus(
  baseUrl: string, instKey: string, instanceName: string,
): Promise<{ realStatus: string; isConnected: boolean }> {
  const headers = { "Content-Type": "application/json", token: instKey, apikey: instKey };
  let stateData: any = {};
  try {
    let res = await fetch(`${baseUrl}/instance/status`, { method: "GET", headers });
    if (!res.ok || res.status === 404) {
      res = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, { method: "GET", headers });
    }
    if (!res.ok || res.status === 404) {
      res = await fetch(`${baseUrl}/instance/connect`, { method: "POST", headers, body: "{}" });
    }
    const raw = await res.text();
    try { stateData = JSON.parse(raw); } catch { /* corpo não-JSON */ }

    const state = String(
      stateData?.instance?.state || stateData?.instance?.status || stateData?.state || "",
    ).toLowerCase();

    const isConnected = state === "open" || state === "connected" || state === "connecting"
      || state === "connected_authenticated"
      || stateData?.connected === true || stateData?.instance?.connected === true
      || stateData?.loggedIn === true || stateData?.instance?.loggedIn === true
      || stateData?.status?.connected === true || stateData?.status?.loggedIn === true;

    let realStatus = "disconnected";
    if (isConnected) realStatus = state === "connecting" ? "connecting" : "connected";
    else if (state === "close" || state === "closed" || state === "disconnected") realStatus = "disconnected";
    else if (state === "qrcode" || stateData?.base64 || stateData?.qrcode) realStatus = "waiting_qr";
    else realStatus = state || "disconnected";

    return { realStatus, isConnected };
  } catch (_e) {
    return { realStatus: "error", isConnected: false }; // erro de rede transitório -> não derruba status
  }
}

async function sendText(baseUrl: string, instKey: string, phone: string, text: string): Promise<boolean> {
  let p = String(phone).replace(/\D/g, "");
  if (p.length === 10 || p.length === 11) p = `55${p}`;
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: instKey, apikey: instKey },
      body: JSON.stringify({ number: p, text }),
    });
    return res.ok;
  } catch (_e) { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // Instâncias a checar: UazAPI, que estão ativas OU marcadas 'connected' (pra pegar quem caiu).
    // Sem filtro de provider (PostgREST .neq é null-unsafe e excluiria provider NULL). Instância
    // Meta não tem api_url -> é pulada no loop pelo check de api_url.
    const { data: instances } = await admin.from("wa_instances")
      .select("id, user_id, instance_name, api_url, api_key_encrypted, status, seller_member_id, disconnect_alert_sent_at")
      .or("is_active.eq.true,status.eq.connected");

    let checked = 0, status_mudou = 0, avisos = 0, erros = 0;
    const masterCache: Record<string, any> = {};

    for (const inst of (instances || []) as any[]) {
      if (!inst.api_url) continue;
      checked++;
      const baseUrl = String(inst.api_url).replace(/\/+$/, "");
      const { realStatus, isConnected } = await checkRealStatus(baseUrl, inst.api_key_encrypted || "", inst.instance_name);
      if (realStatus === "error") { erros++; continue; } // não muda nada num erro de rede

      // Atualiza o status REAL no banco.
      const upd: Record<string, unknown> = { status: realStatus, updated_at: new Date().toISOString() };
      if (isConnected) {
        upd.is_active = true; upd.last_connected_at = new Date().toISOString();
        upd.health_score = 100; upd.shadow_ban_suspect = false; upd.disconnect_alert_sent_at = null; // voltou -> zera aviso
      } else {
        upd.is_active = false;
        if (inst.status === "connected") { upd.health_score = 0; upd.shadow_ban_suspect = true; }
      }
      if (inst.status !== realStatus) status_mudou++;
      await admin.from("wa_instances").update(upd).eq("id", inst.id);

      // VENDEDOR desconectado -> lembrete a cada ~1h (07h–21h BRT) pela instância master da loja,
      // até reconectar. Reconectou -> disconnect_alert_sent_at zera (bloco isConnected acima).
      if (!isConnected && inst.seller_member_id) {
        const horaBRT = new Date(Date.now() - 3 * 3600 * 1000).getUTCHours();
        if (horaBRT < 7 || horaBRT >= 21) continue; // não acordar o vendedor de madrugada
        const jaAvisou = inst.disconnect_alert_sent_at &&
          (Date.now() - new Date(inst.disconnect_alert_sent_at).getTime() < 55 * 60 * 1000);
        if (jaAvisou) continue;

        const { data: vend } = await admin.from("ai_team_members")
          .select("name, whatsapp_number").eq("id", inst.seller_member_id).maybeSingle();
        if (!vend?.whatsapp_number) continue;

        let master = masterCache[inst.user_id];
        if (master === undefined) {
          const { data: m } = await admin.from("wa_instances")
            .select("api_url, api_key_encrypted")
            .eq("user_id", inst.user_id).is("seller_member_id", null)
            .eq("status", "connected").not("api_url", "is", null)
            .order("updated_at", { ascending: false }).limit(1).maybeSingle();
          master = m || null; masterCache[inst.user_id] = master;
        }
        if (!master?.api_url) continue; // loja sem master conectada -> não há de onde avisar

        const nome = String(vend.name || "").trim().split(/\s+/)[0] || "vendedor";
        const msg = `Oi ${nome}! Aqui é a assistente da loja.

Seu WhatsApp está *desconectado da plataforma*. Fica tranquilo: *seus leads continuam chegando normalmente*. Mas, enquanto estiver desconectado:

— seus *follow-ups automáticos* não estão saindo pros seus clientes;
— a plataforma *não acompanha suas conversas*, então seu atendimento fica de fora dos relatórios e feedbacks da loja.

Reconectar leva 1 minuto: entre no painel da Logos, em *WhatsApp > Instâncias*, e escaneie o QR Code.

Vou te lembrar a cada 1 hora até você reconectar. Qualquer dificuldade, chama o gerente.`;
        const ok = await sendText(String(master.api_url), master.api_key_encrypted || "", vend.whatsapp_number, msg);
        if (ok) {
          avisos++;
          await admin.from("wa_instances").update({ disconnect_alert_sent_at: new Date().toISOString() }).eq("id", inst.id);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, checked, status_mudou, avisos_enviados: avisos, erros }),
      { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[wa-instance-health-check]", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "erro interno" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
