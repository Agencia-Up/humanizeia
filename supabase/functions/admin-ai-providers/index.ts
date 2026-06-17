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

  // ── Config efetiva (overrides de provedor) ──
  const plannerProvider = (Deno.env.get("PEDRO_PLANNER_PROVIDER") || "openai").toLowerCase();
  const replyForceProvider = (Deno.env.get("PEDRO_REPLY_FORCE_PROVIDER") || "").toLowerCase();

  // ── Probe ao vivo das chaves da PLATAFORMA ──
  const oaKey = Deno.env.get("OPENAI_API_KEY") || "";
  const dsKey = Deno.env.get("DEEPSEEK_API_KEY") || "";
  const anKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("CLAUDE_API_KEY") || "";
  const providers = await Promise.all([
    probeOpenAICompat("openai", "https://api.openai.com/v1/chat/completions", oaKey, "gpt-4o-mini"),
    probeOpenAICompat("deepseek", "https://api.deepseek.com/v1/chat/completions", dsKey, "deepseek-chat"),
    probeAnthropic(anKey, "claude-haiku-4-5"),
  ]);

  // marca quem esta EM USO (planner e/ou reply)
  const inUse = (name: string) => {
    const usedByPlanner = plannerProvider === name;
    const usedByReply = replyForceProvider ? replyForceProvider === name : name === "openai"; // sem force, reply segue agent.model (default openai)
    return { planner: usedByPlanner, reply: usedByReply };
  };
  const out = providers.map((p) => ({ ...p, in_use: inUse(p.name) }));

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
