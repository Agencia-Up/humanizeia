/**
 * admin-ai-providers — estado dos provedores de IA da PLATAFORMA, pro painel de Administracao.
 * - Sonda AO VIVO cada provedor (OpenAI/DeepSeek/Anthropic) com uma chamada minima (max_tokens:1)
 *   e classifica: ok | quota (sem credito) | auth (chave invalida) | rate | down | no_key.
 * - Diz QUAL provedor esta EM USO de fato (env PEDRO_PLANNER_PROVIDER / PEDRO_REPLY_FORCE_PROVIDER),
 *   resolvendo a confusao "modelo configurado no agente" vs "provedor efetivo".
 * - Conta erros de provedor (quota/auth) nas ultimas 24h dos turn logs.
 *
 * SO admin (superadmin/dono) — valida o role do JWT (gateway verify_jwt valida a assinatura).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const OWNER_EMAILS = ["wandercarvalho31@gmail.com", "douglasaloan@gmail.com"];

function classify(status: number, bodyText: string): { kind: string; code: string } {
  let code = "";
  try { const j = JSON.parse(bodyText); code = String(j?.error?.code || j?.error?.type || j?.type || ""); } catch { /* */ }
  const c = code.toLowerCase(); const body = String(bodyText || "").toLowerCase();
  if (status === 401 || status === 403 || c.includes("invalid_api_key") || c.includes("authentication") || body.includes("invalid api key"))
    return { kind: "auth", code: code || `http_${status}` };
  if (c.includes("insufficient_quota") || c.includes("billing") || body.includes("insufficient_quota") || body.includes("exceeded your current quota") || body.includes("credit balance is too low"))
    return { kind: "quota", code: code || "insufficient_quota" };
  if (status === 429) return { kind: "rate", code: code || "rate_limit" };
  if (status >= 500) return { kind: "down", code: code || `http_${status}` };
  return { kind: "other", code: code || `http_${status}` };
}

async function probeOpenAICompat(name: string, url: string, key: string, model: string) {
  if (!key) return { name, has_key: false, status: "no_key" };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    });
    if (r.ok) return { name, has_key: true, status: "ok" };
    const { kind, code } = classify(r.status, await r.text());
    return { name, has_key: true, status: kind, code, http: r.status };
  } catch (e) { return { name, has_key: true, status: "down", detail: String((e as any)?.message || e) }; }
}
async function probeAnthropic(key: string, model: string) {
  if (!key) return { name: "anthropic", has_key: false, status: "no_key" };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    });
    if (r.ok) return { name: "anthropic", has_key: true, status: "ok" };
    const { kind, code } = classify(r.status, await r.text());
    return { name: "anthropic", has_key: true, status: kind, code, http: r.status };
  } catch (e) { return { name: "anthropic", has_key: true, status: "down", detail: String((e as any)?.message || e) }; }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  // ── AUTH (mesmo padrao do health-monitor): service_role (infra) ou superadmin/dono. ──
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let role = "";
  try { role = String(JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")))?.role || ""); } catch { /* */ }
  let allowed = role === "service_role" || role === "supabase_admin" || (!!token && token === serviceKey);
  if (!allowed && token) {
    try {
      const { data: ures } = await supabase.auth.getUser(token);
      const uid = ures?.user?.id; const email = (ures?.user?.email || "").toLowerCase();
      if (uid) {
        const { data: prof } = await supabase.from("profiles").select("is_superadmin").eq("id", uid).maybeSingle();
        allowed = prof?.is_superadmin === true || OWNER_EMAILS.includes(email);
      }
    } catch { /* */ }
  }
  if (!allowed) return json({ ok: false, error: "forbidden: admin only" }, 403);

  const body = await req.json().catch(() => ({} as any));

  // ── Config efetiva (overrides de provedor) ──
  const plannerProvider = (Deno.env.get("PEDRO_PLANNER_PROVIDER") || "openai").toLowerCase();
  const replyForceProvider = (Deno.env.get("PEDRO_REPLY_FORCE_PROVIDER") || "").toLowerCase();

  // ── Probe ao vivo das chaves da PLATAFORMA ──
  const oaKey = Deno.env.get("OPENAI_API_KEY") || "";
  const dsKey = Deno.env.get("DEEPSEEK_API_KEY") || "";
  const anKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("CLAUDE_API_KEY") || "";
  const gmKey = Deno.env.get("GEMINI_API_KEY") || "";
  const providers = await Promise.all([
    probeOpenAICompat("openai", "https://api.openai.com/v1/chat/completions", oaKey, "gpt-4o-mini"),
    probeOpenAICompat("deepseek", "https://api.deepseek.com/v1/chat/completions", dsKey, "deepseek-chat"),
    probeAnthropic(anKey, "claude-haiku-4-5"),
    // Gemini expoe endpoint compativel com OpenAI — reusa o mesmo probe.
    probeOpenAICompat("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", gmKey, "gemini-2.0-flash"),
  ]);

  // marca quem esta EM USO (planner e/ou reply)
  const inUse = (name: string) => {
    const usedByPlanner = plannerProvider === name;
    const usedByReply = replyForceProvider ? replyForceProvider === name : name === "openai"; // sem force, reply segue agent.model (default openai)
    return { planner: usedByPlanner, reply: usedByReply };
  };
  const out = providers.map((p) => ({ ...p, in_use: inUse(p.name) }));

  // ══ MODO MONITOR (cron a cada 15 min): persiste o estado e ALERTA os
  // superadmins por e-mail quando uma chave CAI e quando VOLTA. Motivo: a chave
  // da Anthropic ficou sem credito por 4 dias (16-20/07) e ninguem foi avisado.
  if (body?.monitor === true) {
    const PROVIDER_LABEL: Record<string, string> = {
      openai: "OpenAI", anthropic: "Anthropic (Claude)", deepseek: "DeepSeek", gemini: "Google Gemini",
    };
    const STATUS_LABEL: Record<string, string> = {
      ok: "no ar", quota: "SEM CREDITO", auth: "chave invalida", rate: "rate limit",
      down: "provedor fora do ar", other: "erro", no_key: "sem chave configurada",
    };
    const REALERT_MS = 6 * 3600e3; // re-alerta a cada 6h enquanto caida
    const nowIso = new Date().toISOString();

    const { data: prevRows } = await supabase.from("ai_provider_health").select("*");
    const prevBy: Record<string, any> = {};
    for (const r of prevRows || []) prevBy[r.provider] = r;

    type Evento = { provider: string; evento: "caiu" | "voltou" | "alerta_repetido"; status: string; detalhe: string };
    const eventos: Evento[] = [];

    for (const p of out) {
      const prev = prevBy[p.name];
      // "problema" = qualquer status != ok. no_key so vira problema se ANTES
      // havia chave (chave removida); nunca configurada = neutro, sem alerta.
      const isDown = p.status !== "ok" && !(p.status === "no_key" && (!prev || prev.status === "no_key"));
      const prevDown = !!prev && prev.status !== "ok" && prev.status !== "no_key";
      const detalhe = String((p as any).code || (p as any).detail || "").slice(0, 300);
      const emUso = p.in_use.planner || p.in_use.reply;

      let evento: Evento["evento"] | null = null;
      if (isDown && !prevDown) evento = "caiu";
      else if (!isDown && p.status === "ok" && prevDown) evento = "voltou";
      else if (isDown && prevDown && prev?.last_alert_at && (Date.now() - new Date(prev.last_alert_at).getTime()) > REALERT_MS) evento = "alerta_repetido";

      await supabase.from("ai_provider_health").upsert({
        provider: p.name,
        status: p.status,
        detalhe: detalhe || null,
        http_status: (p as any).http ?? null,
        in_use: emUso,
        checked_at: nowIso,
        last_ok_at: p.status === "ok" ? nowIso : (prev?.last_ok_at ?? null),
        down_since: isDown ? (prevDown && prev?.down_since ? prev.down_since : nowIso) : null,
        last_alert_at: evento ? nowIso : (prev?.last_alert_at ?? null),
        updated_at: nowIso,
      }, { onConflict: "provider" });

      if (evento) {
        eventos.push({ provider: p.name, evento, status: p.status, detalhe });
        await supabase.from("ai_provider_health_log").insert({
          provider: p.name, evento, status: p.status, detalhe: detalhe || null,
        }).then(() => {}, () => {});
      }
    }

    // Um e-mail unico por rodada com todos os eventos (identidade Logos navy/dourado)
    let emailOk = false;
    if (eventos.length) {
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
      const caidas = eventos.filter((e) => e.evento !== "voltou");
      const assunto = caidas.length
        ? `\u{1F534} Chave de IA com problema: ${caidas.map((e) => PROVIDER_LABEL[e.provider] || e.provider).join(", ")}`
        : `\u{1F7E2} Chave de IA voltou: ${eventos.map((e) => PROVIDER_LABEL[e.provider] || e.provider).join(", ")}`;
      const linhas = eventos.map((e) => {
        const cor = e.evento === "voltou" ? "#16a34a" : "#dc2626";
        const acao = e.status === "quota"
          ? "Acao: recarregar os creditos no painel do provedor."
          : e.status === "auth" ? "Acao: verificar/trocar a chave de API." : "";
        return `<tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">
          <strong>${PROVIDER_LABEL[e.provider] || e.provider}</strong><br>
          <span style="color:${cor};font-weight:600;">${e.evento === "voltou" ? "VOLTOU ao ar" : (STATUS_LABEL[e.status] || e.status)}</span>
          ${e.detalhe ? `<br><span style="color:#6b7280;font-size:12px;">${e.detalhe}</span>` : ""}
          ${acao ? `<br><span style="font-size:13px;">${acao}</span>` : ""}
        </td></tr>`;
      }).join("");
      const html = `<div style="background:#081431;padding:24px;font-family:Arial,sans-serif;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
          <div style="background:#081431;padding:18px 24px;">
            <span style="color:#ffffff;font-size:20px;font-weight:700;">LOGOS<span style="color:#e0a82e;">|IA</span></span>
          </div>
          <div style="padding:20px 24px;">
            <h2 style="margin:0 0 8px;color:#081431;font-size:17px;">Monitor de chaves de IA</h2>
            <p style="margin:0 0 14px;color:#374151;font-size:14px;">Checagem automatica (a cada 15 min) detectou mudanca no estado das chaves da plataforma:</p>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;">${linhas}</table>
            <p style="margin:14px 0 0;color:#6b7280;font-size:12px;">Detalhes em Administracao &rarr; Provedores de IA. Enquanto uma chave estiver caida, este aviso repete a cada 6h.</p>
          </div>
        </div></div>`;
      if (RESEND_API_KEY) {
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: "Logosai <suporte@logosiabrasil.com>", to: OWNER_EMAILS, subject: assunto, html }),
          });
          emailOk = r.ok;
          if (!r.ok) console.error("[ai-keys-monitor] resend", r.status, await r.text().catch(() => ""));
        } catch (e) { console.error("[ai-keys-monitor] resend erro", (e as any)?.message); }
      } else {
        console.error("[ai-keys-monitor] RESEND_API_KEY ausente — alerta so no painel");
      }
    }

    return json({ ok: true, monitor: true, providers: out.map((p) => ({ name: p.name, status: p.status })), eventos, email_enviado: emailOk });
  }

  // ── Erros de provedor (quota/auth) nas ultimas 24h ──
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  let providerErrors24h = 0;
  try {
    const { data: logs } = await supabase.from("pedro_v2_turn_logs").select("result").eq("dry_run", false).gte("created_at", since).limit(3000);
    for (const l of logs || []) {
      const e = (l as any)?.result?.ai_provider_errors;
      if (Array.isArray(e) && e.some((x: any) => x?.kind === "quota" || x?.kind === "auth")) providerErrors24h++;
    }
  } catch { /* */ }

  return json({
    ok: true,
    planner_provider: plannerProvider,
    reply_force_provider: replyForceProvider || null,
    reply_note: replyForceProvider ? "override global ativo" : "por agente (agent.model)",
    providers: out,
    recent_provider_errors_24h: providerErrors24h,
  });
});
