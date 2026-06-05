// ============================================================================
// platform-app-credentials
// ----------------------------------------------------------------------------
// Edge function ADMIN-ONLY para o operador da plataforma gerir as chaves dos
// apps de integracao (Meta, Google Ads, TikTok) pelo painel.
//
// Seguranca:
//  - So o admin da plataforma pode chamar (email fixo OU profiles.is_superadmin).
//  - Os segredos NUNCA voltam pro frontend. action 'status' devolve so flags
//    (configurado / nao configurado).
//  - A tabela platform_app_credentials tem RLS sem policies; so esta function
//    (service_role) le/escreve.
//
// Acoes:
//  - { action: 'status' }                    -> { meta:{app_id,app_secret}, google_ads:{...}, tiktok:{...} } (booleans)
//  - { action: 'save', provider, app_id?, app_secret?, extra? } -> grava (so os campos enviados)
//  - { action: 'clear', provider }           -> apaga a linha do provider
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = "wandercarvalho31@gmail.com";
const PROVIDERS = ["meta", "google_ads", "tiktok"];
// chaves de 'extra' permitidas por provider (evita lixo no jsonb)
const EXTRA_KEYS: Record<string, string[]> = {
  meta: [],
  google_ads: ["developer_token"],
  tiktok: [],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    // ── 1. Autentica o chamador pelo JWT ──────────────────────────────────
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user }, error: userErr } = await anon.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    // ── 2. Confere se e o admin da plataforma ─────────────────────────────
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    let isAdmin = user.email === ADMIN_EMAIL;
    if (!isAdmin) {
      const { data: prof } = await svc
        .from("profiles")
        .select("is_superadmin")
        .eq("id", user.id)
        .maybeSingle();
      isAdmin = prof?.is_superadmin === true;
    }
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "status";

    // ── 3a. STATUS — so flags, nunca os valores ───────────────────────────
    if (action === "status") {
      const { data } = await svc
        .from("platform_app_credentials")
        .select("provider, app_id, app_secret, extra");
      const out: Record<string, any> = {};
      for (const p of PROVIDERS) {
        const row = (data || []).find((r: any) => r.provider === p);
        const extraFlags: Record<string, boolean> = {};
        for (const k of EXTRA_KEYS[p]) {
          extraFlags[k] = !!(row?.extra && String(row.extra[k] || "").trim());
        }
        out[p] = {
          app_id_set: !!(row?.app_id && String(row.app_id).trim()),
          app_secret_set: !!(row?.app_secret && String(row.app_secret).trim()),
          extra: extraFlags,
          updated_at: row?.updated_at || null,
        };
      }
      return json({ ok: true, status: out });
    }

    // ── 3b. SAVE — grava so os campos enviados (nao apaga o que nao veio) ──
    if (action === "save") {
      const provider = String(body.provider || "");
      if (!PROVIDERS.includes(provider)) return json({ error: "invalid_provider" }, 400);

      // Le a linha atual pra mesclar (campo vazio/undefined nao sobrescreve).
      const { data: cur } = await svc
        .from("platform_app_credentials")
        .select("app_id, app_secret, extra")
        .eq("provider", provider)
        .maybeSingle();

      const next: Record<string, any> = {
        provider,
        app_id: cur?.app_id ?? null,
        app_secret: cur?.app_secret ?? null,
        extra: { ...(cur?.extra || {}) },
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      };

      // app_id / app_secret: so atualiza se veio string nao-vazia.
      if (typeof body.app_id === "string" && body.app_id.trim()) next.app_id = body.app_id.trim();
      if (typeof body.app_secret === "string" && body.app_secret.trim()) next.app_secret = body.app_secret.trim();

      // extra: so as chaves permitidas, so se vier valor nao-vazio.
      if (body.extra && typeof body.extra === "object") {
        for (const k of EXTRA_KEYS[provider]) {
          const v = body.extra[k];
          if (typeof v === "string" && v.trim()) next.extra[k] = v.trim();
        }
      }

      const { error } = await svc
        .from("platform_app_credentials")
        .upsert(next, { onConflict: "provider" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ── 3c. CLEAR — apaga a linha do provider ─────────────────────────────
    if (action === "clear") {
      const provider = String(body.provider || "");
      if (!PROVIDERS.includes(provider)) return json({ error: "invalid_provider" }, 400);
      const { error } = await svc
        .from("platform_app_credentials")
        .delete()
        .eq("provider", provider);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err: any) {
    return json({ error: err?.message ?? "internal_error" }, 500);
  }
});
