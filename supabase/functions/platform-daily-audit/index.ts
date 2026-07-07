import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OWNER_EMAILS = ["wandercarvalho31@gmail.com", "douglasaloan@gmail.com"];

type FindingLevel = "ok" | "warning" | "critical";
type Finding = { level: FindingLevel; title: string; detail: string; sample?: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function onlyDigits(value: unknown): string {
  let d = String(value ?? "").replace(/\D/g, "");
  if ((d.length === 10 || d.length === 11) && !d.startsWith("55")) d = `55${d}`;
  return d;
}

function maskPhone(value: unknown): string {
  const d = onlyDigits(value);
  if (!d) return "sem numero";
  return `****${d.slice(-4)}`;
}

function brDateTime(value = new Date()): string {
  return value.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseState(payload: any): { realStatus: string; isConnected: boolean; phoneNumber?: string } {
  const isConnected =
    payload?.status?.connected === true ||
    payload?.status?.loggedIn === true ||
    payload?.instance?.connected === true ||
    payload?.instance?.loggedIn === true ||
    payload?.connected === true ||
    payload?.loggedIn === true;

  const state = String(
    payload?.instance?.status ||
    payload?.instance?.state ||
    payload?.state ||
    "",
  ).toLowerCase().trim();

  const raw = JSON.stringify(payload || {});
  const jid = raw.match(/(\d{10,15})(?::\d+)?@(?:s\.whatsapp\.net|c\.us)/)?.[1];
  const owner = onlyDigits(payload?.instance?.owner || payload?.owner || payload?.status?.jid || "");

  let realStatus = "disconnected";
  if (isConnected) realStatus = state === "connecting" ? "connecting" : "connected";
  else if (state === "qrcode" || payload?.qrcode || payload?.instance?.qrcode) realStatus = "waiting_qr";
  else if (state === "close" || state === "closed" || state === "disconnected") realStatus = "disconnected";
  else if (state) realStatus = state;

  return { realStatus, isConnected, phoneNumber: jid || owner || undefined };
}

async function checkInstance(baseUrl: string, token: string, instanceName?: string) {
  const headers = { "Content-Type": "application/json", token, apikey: token };
  const url = baseUrl.replace(/\/+$/, "");
  const attempts = [
    { method: "GET", endpoint: `${url}/instance/status`, body: undefined },
    { method: "GET", endpoint: `${url}/instance/connectionState/${instanceName || ""}`, body: undefined },
    { method: "POST", endpoint: `${url}/instance/connect`, body: "{}" },
  ];

  for (const a of attempts) {
    if (a.endpoint.endsWith("/instance/connectionState/")) continue;
    try {
      const res = await fetch(a.endpoint, { method: a.method, headers, body: a.body });
      if (!res.ok && res.status !== 409) continue;
      const text = await res.text();
      try { return { ...parseState(JSON.parse(text)), error: null as string | null }; } catch { /* continue */ }
    } catch (_e) {
      // try next endpoint
    }
  }
  return { realStatus: "error", isConnected: false, phoneNumber: undefined, error: "uazapi_status_error" };
}

async function sendText(baseUrl: string, token: string, phone: string, text: string): Promise<boolean> {
  const number = onlyDigits(phone);
  if (!number) return false;
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token, apikey: token },
      body: JSON.stringify({ number, text }),
    });
    return res.ok;
  } catch (_e) {
    return false;
  }
}

async function isAuthorized(req: Request, supabase: any): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (token && token === serviceKey) return true;

  let role = "";
  try {
    role = String(JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")))?.role || "");
  } catch {
    // not a JWT
  }
  if (role === "service_role" || role === "supabase_admin") return true;

  if (!token) return false;
  try {
    const { data } = await supabase.auth.getUser(token);
    const user = data?.user;
    if (!user?.id) return false;
    const { data: profile } = await supabase.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
    return profile?.is_superadmin === true || OWNER_EMAILS.includes(String(user.email || "").toLowerCase());
  } catch {
    return false;
  }
}

async function safeCount(label: string, query: PromiseLike<any>, findings: Finding[], warnWhenPositive = true): Promise<number> {
  try {
    const { count, error } = await query as any;
    if (error) throw new Error(error.message);
    const n = Number(count || 0);
    if (warnWhenPositive && n > 0) findings.push({ level: "warning", title: label, detail: `${n} ocorrencia(s) encontradas.` });
    return n;
  } catch (e: any) {
    findings.push({ level: "warning", title: `${label} nao auditado`, detail: e?.message || "Falha ao consultar." });
    return 0;
  }
}

function buildReportMessage(input: {
  checkedInstances: number;
  connected: number;
  disconnected: number;
  changed: number;
  findings: Finding[];
}) {
  const critical = input.findings.filter((f) => f.level === "critical");
  const warnings = input.findings.filter((f) => f.level === "warning");
  const ok = critical.length === 0 && warnings.length === 0;
  const icon = ok ? "✅" : critical.length ? "🚨" : "⚠️";

  const lines = [
    `${icon} *Auditoria diaria Logos IA*`,
    `Horario: ${brDateTime()}`,
    "",
    `*WhatsApp/UAZAPI*`,
    `• Checadas: ${input.checkedInstances}`,
    `• Conectadas: ${input.connected}`,
    `• Desconectadas: ${input.disconnected}`,
    `• Status corrigidos no banco: ${input.changed}`,
    "",
  ];

  if (ok) {
    lines.push("*Resultado:* nenhuma falha critica encontrada nas checagens automaticas.");
  } else {
    lines.push("*Pontos encontrados:*");
    for (const f of [...critical, ...warnings].slice(0, 12)) {
      lines.push(`• ${f.level === "critical" ? "CRITICO" : "Atencao"} — ${f.title}: ${f.detail}`);
      if (f.sample) lines.push(`  Ex.: ${f.sample}`);
    }
    if (critical.length + warnings.length > 12) lines.push(`• +${critical.length + warnings.length - 12} item(ns) no log da auditoria.`);
  }

  lines.push("", "_Gerado automaticamente as 08:00. Correcoes simples aplicadas; itens arriscados ficam para revisao humana._");
  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!(await isAuthorized(req, supabase))) return json({ ok: false, error: "forbidden" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* cron without body */ }
  const sendWhatsapp = body?.send_whatsapp !== false;
  const force = body?.force === true;
  const sinceIso = new Date(Date.now() - 24 * 3600e3).toISOString();
  const findings: Finding[] = [];

  const { data: settings, error: settingsError } = await supabase
    .from("platform_settings")
    .select("daily_audit_enabled,daily_audit_sender_instance_id,daily_audit_recipient_phones")
    .eq("id", "global")
    .maybeSingle();
  if (settingsError) return json({ ok: false, error: settingsError.message }, 500);

  if (!force && settings?.daily_audit_enabled !== true) {
    return json({ ok: true, skipped: true, reason: "daily_audit_disabled" });
  }

  const { data: instances, error: instError } = await supabase
    .from("wa_instances")
    .select("id,user_id,instance_name,friendly_name,api_url,api_key_encrypted,provider,status,is_active,phone_number,updated_at")
    .or("is_active.eq.true,status.eq.connected,status.eq.connecting,status.eq.waiting_qr")
    .not("api_url", "is", null);
  if (instError) return json({ ok: false, error: instError.message }, 500);

  let checkedInstances = 0;
  let connected = 0;
  let disconnected = 0;
  let changed = 0;

  for (const inst of (instances || []) as any[]) {
    if (String(inst.provider || "uazapi") === "meta") continue;
    if (!inst.api_key_encrypted || !inst.api_url) continue;
    checkedInstances++;

    const real = await checkInstance(inst.api_url, inst.api_key_encrypted, inst.instance_name);
    if (real.realStatus === "error") {
      findings.push({
        level: "warning",
        title: "Falha ao consultar UAZAPI",
        detail: `${inst.friendly_name || inst.instance_name} (${maskPhone(inst.phone_number)}) nao retornou status.`,
      });
      continue;
    }

    if (real.isConnected) connected++;
    else disconnected++;
    if (String(inst.status || "") !== real.realStatus) changed++;

    const update: Record<string, unknown> = {
      status: real.realStatus,
      updated_at: new Date().toISOString(),
      is_active: real.isConnected,
      health_score: real.isConnected ? 100 : 0,
    };
    if (real.isConnected) update.last_connected_at = new Date().toISOString();
    if (real.phoneNumber) update.phone_number = real.phoneNumber;
    await supabase.from("wa_instances").update(update).eq("id", inst.id);

    if (!real.isConnected) {
      findings.push({
        level: "critical",
        title: "WhatsApp desconectado",
        detail: `${inst.friendly_name || inst.instance_name} esta ${real.realStatus}.`,
        sample: maskPhone(inst.phone_number || real.phoneNumber),
      });
    }
  }

  await safeCount(
    "Falhas de provedor de IA no Pedro V2",
    supabase.from("pedro_v2_turn_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceIso)
      .or("next_action.eq.no_ai_key_configured,result->>ai_key_source.eq.none"),
    findings,
  );

  await safeCount(
    "Erros de IA/credito/chave no Pedro V2",
    supabase.from("pedro_v2_turn_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceIso)
      .filter("result->ai_provider_errors", "not.is", null),
    findings,
  );

  await safeCount(
    "Transferencias pendentes acima de 1 hora",
    supabase.from("ai_lead_transfers")
      .select("id", { count: "exact", head: true })
      .eq("transfer_status", "pending")
      .lt("created_at", new Date(Date.now() - 3600e3).toISOString()),
    findings,
  );

  await safeCount(
    "Assinaturas suspensas/canceladas",
    supabase.from("user_subscriptions")
      .select("user_id", { count: "exact", head: true })
      .in("status", ["suspended", "cancelled", "overdue", "past_due"]),
    findings,
  );

  if (checkedInstances === 0) {
    findings.push({
      level: "warning",
      title: "Nenhuma instancia auditada",
      detail: "Nao encontrei instancias UAZAPI ativas/conectadas para verificar.",
    });
  }

  const summary = {
    checkedInstances,
    connected,
    disconnected,
    changed,
    findings_total: findings.length,
    critical: findings.filter((f) => f.level === "critical").length,
    warnings: findings.filter((f) => f.level === "warning").length,
    ran_at: new Date().toISOString(),
  };

  await supabase.from("platform_settings").update({
    daily_audit_last_run_at: new Date().toISOString(),
    daily_audit_last_summary: { ...summary, findings: findings.slice(0, 30) },
  }).eq("id", "global");

  let whatsapp = { attempted: false, sent: 0, failed: 0, reason: "" };
  const recipients = Array.isArray(settings?.daily_audit_recipient_phones)
    ? settings.daily_audit_recipient_phones.map(onlyDigits).filter(Boolean)
    : [];

  if (sendWhatsapp) {
    whatsapp.attempted = true;
    if (!settings?.daily_audit_sender_instance_id) {
      whatsapp.reason = "missing_sender_instance";
    } else if (recipients.length === 0) {
      whatsapp.reason = "missing_recipients";
    } else {
      const { data: sender } = await supabase.from("wa_instances")
        .select("api_url,api_key_encrypted,status,is_active")
        .eq("id", settings.daily_audit_sender_instance_id)
        .maybeSingle();
      if (!sender?.api_url || !sender?.api_key_encrypted) {
        whatsapp.reason = "sender_not_found";
      } else {
        const message = buildReportMessage({ checkedInstances, connected, disconnected, changed, findings });
        for (const phone of recipients) {
          const ok = await sendText(sender.api_url, sender.api_key_encrypted, phone, message);
          if (ok) whatsapp.sent++;
          else whatsapp.failed++;
        }
        if (whatsapp.failed > 0) whatsapp.reason = "some_sends_failed";
      }
    }
  }

  return json({ ok: true, summary, findings, whatsapp });
});
