// ── Onboarding da Cloud API oficial do Meta via Embedded Signup ───────────────
// Recebe o `code` do popup do Facebook (+ phone_number_id/waba_id do evento
// WA_EMBEDDED_SIGNUP) e: troca o code por token, assina o App na WABA (liga o
// webhook), registra o numero (best-effort) e cria a instancia em wa_instances
// (provider='meta'). NAO chama sync-uazapi-webhook (Meta e webhook a nivel de App).
// Espelha a checagem de dono + limite de pool do create-uazapi-instance. UAZAPI
// fica intacta — esta e SO a segunda via.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

const INSTANCE_LIMITS_BY_PLAN: Record<string, number> = { basico: 10, pro: 15, enterprise: 15 };
const DEFAULT_PLAN_LIMIT = INSTANCE_LIMITS_BY_PLAN.basico;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Diagnostico best-effort: grava a tentativa/falha em meta_onboarding_log pra
// dar pra ver por SQL em que passo o Embedded Signup quebra (e o erro cru da
// Meta). NUNCA lanca — se o insert falhar, o fluxo de conexao segue igual.
async function logAttempt(supabase: any, row: Record<string, unknown>) {
  try {
    await supabase.from("meta_onboarding_log").insert(row);
  } catch (_e) {
    /* diagnostico e best-effort — jamais interrompe a conexao */
  }
}

// App DEDICADO do WhatsApp Cloud API — separado do app de Anúncios/Marketing.
// Lê secrets próprios (WHATSAPP_APP_ID/SECRET) pra NUNCA usar por engano as
// credenciais do app de anúncios (META_APP_ID / platform_app_credentials).
function getMetaAppCreds(): { appId: string; appSecret: string } {
  return {
    appId: (Deno.env.get("WHATSAPP_APP_ID") || "").trim(),
    appSecret: (Deno.env.get("WHATSAPP_APP_SECRET") || "").trim(),
  };
}

// Pool da conta (espelha validatePoolLimits do create-uazapi-instance).
async function validatePoolLimits(
  supabase: any,
  body: { user_id?: string; seller_member_id?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const masterId = body.user_id;
  if (!masterId) return { ok: false, error: "user_id (master_id) é obrigatório" };

  const { data: subData } = await supabase
    .from("user_subscriptions")
    .select("plan_id, status")
    .eq("user_id", masterId)
    .maybeSingle();
  const planId = (subData?.plan_id as string | undefined) || "basico";
  const poolLimit = INSTANCE_LIMITS_BY_PLAN[planId] ?? DEFAULT_PLAN_LIMIT;

  const { count: totalCount } = await supabase
    .from("wa_instances")
    .select("id", { count: "exact", head: true })
    .eq("user_id", masterId)
    .eq("is_active", true);
  if ((totalCount ?? 0) >= poolLimit) {
    return { ok: false, error: `Limite de instâncias da conta atingido (${totalCount}/${poolLimit} no plano ${planId}).` };
  }

  if (body.seller_member_id) {
    const { count: sellerCount } = await supabase
      .from("wa_instances")
      .select("id", { count: "exact", head: true })
      .eq("seller_member_id", body.seller_member_id)
      .eq("is_active", true);
    if ((sellerCount ?? 0) >= 1) {
      return { ok: false, error: "Este vendedor já possui uma instância conectada." };
    }
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json();
    const { code, phone_number_id, waba_id, friendly_name, user_id, seller_member_id } = body || {};

    // ── Auth: chamador precisa ser dono da conta (espelha create-uazapi-instance) ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(callerToken);
    if (callerErr || !caller) return json({ success: false, error: "Unauthorized" }, 401);

    const { data: callerSellerRows } = await supabase
      .from("ai_team_members")
      .select("id, user_id")
      .eq("auth_user_id", caller.id);
    const allowedMasterIds = new Set<string>([
      caller.id,
      ...((callerSellerRows || []).map((r: any) => r.user_id).filter(Boolean)),
    ]);
    if (user_id && !allowedMasterIds.has(user_id)) {
      return json({ success: false, error: "Ação não autorizada para esta conta." }, 403);
    }
    if (seller_member_id) {
      const { data: memberRow } = await supabase
        .from("ai_team_members")
        .select("id, user_id")
        .eq("id", seller_member_id)
        .maybeSingle();
      if (!memberRow || memberRow.user_id !== user_id) {
        return json({ success: false, error: "Vendedor inválido para esta conta." }, 403);
      }
    }

    if (!code || !phone_number_id || !friendly_name || !user_id) {
      return json({ success: false, error: "Campos obrigatórios: code, phone_number_id, friendly_name, user_id" }, 200);
    }

    const pool = await validatePoolLimits(supabase, { user_id, seller_member_id });
    if (!pool.ok) return json({ success: false, error: pool.error }, 200);

    const { appId, appSecret } = getMetaAppCreds();
    if (!appId || !appSecret) {
      return json({ success: false, error: "WHATSAPP_APP_ID/WHATSAPP_APP_SECRET não configurados" }, 500);
    }

    // 1) Troca o code do Embedded Signup por um token de negócio (sem redirect_uri).
    const tokenUrl = new URL(`${META_GRAPH_URL}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("code", code);
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || tokenData.error || !tokenData.access_token) {
      await logAttempt(supabase, {
        user_id, seller_member_id: seller_member_id || null, phone_number_id, waba_id: waba_id || null,
        step: "token_exchange", success: false, meta_status: tokenRes.status,
        error_text: tokenData?.error?.message || `HTTP ${tokenRes.status}`,
        raw: tokenData?.error || tokenData || null,
      });
      return json({ success: false, error: `Falha ao trocar o code: ${tokenData?.error?.message || tokenRes.status}` }, 200);
    }
    const accessToken: string = tokenData.access_token;
    const authHeaders = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    // 2) Assina o App na WABA -> habilita o webhook de mensagens dessa conta.
    let subscribeWarning: string | null = null;
    if (waba_id) {
      const subRes = await fetch(`${META_GRAPH_URL}/${waba_id}/subscribed_apps`, { method: "POST", headers: authHeaders });
      if (!subRes.ok) {
        subscribeWarning = `subscribed_apps HTTP ${subRes.status} ${await subRes.text().catch(() => "")}`;
        console.warn("[meta-embedded-signup]", subscribeWarning);
        await logAttempt(supabase, {
          user_id, seller_member_id: seller_member_id || null, phone_number_id, waba_id: waba_id || null,
          step: "subscribe", success: false, meta_status: subRes.status, error_text: subscribeWarning, raw: null,
        });
      }
    } else {
      subscribeWarning = "waba_id ausente — App não assinado (inbound pode não chegar)";
    }

    // 3) Registra o número (best-effort: Embedded Signup geralmente já registra).
    try {
      const pin = String(Math.floor(100000 + Math.random() * 900000));
      const regRes = await fetch(`${META_GRAPH_URL}/${phone_number_id}/register`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      });
      if (!regRes.ok) {
        console.warn("[meta-embedded-signup] register (ignorado):", regRes.status, await regRes.text().catch(() => ""));
      }
    } catch (e) {
      console.warn("[meta-embedded-signup] register exception (ignorado):", (e as any)?.message || e);
    }

    // 4) Lê o número exibido / verified_name / qualidade.
    const phoneRes = await fetch(
      `${META_GRAPH_URL}/${phone_number_id}?fields=verified_name,display_phone_number,quality_rating`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const phoneData = await phoneRes.json().catch(() => ({}));
    if (!phoneRes.ok || phoneData.error) {
      await logAttempt(supabase, {
        user_id, seller_member_id: seller_member_id || null, phone_number_id, waba_id: waba_id || null,
        step: "read_phone", success: false, meta_status: phoneRes.status,
        error_text: phoneData?.error?.message || `HTTP ${phoneRes.status}`,
        raw: phoneData?.error || phoneData || null,
      });
      return json({ success: false, error: `Não foi possível ler o número: ${phoneData?.error?.message || phoneRes.status}` }, 200);
    }
    const phoneNumber = phoneData.display_phone_number || null;
    const verifiedName = phoneData.verified_name || friendly_name;

    // 5) Cria a instância (provider='meta', já conectada).
    const instanceSlug = String(friendly_name)
      .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "meta-instance";

    const { data: newInstance, error: insertErr } = await supabase
      .from("wa_instances")
      .insert({
        user_id,
        seller_member_id: seller_member_id || null,
        instance_name: `meta-${instanceSlug}-${Date.now().toString(36)}`,
        friendly_name: verifiedName,
        api_url: META_GRAPH_URL,
        api_key_encrypted: accessToken,
        phone_number: phoneNumber,
        status: "connected",
        is_active: true,
        provider: "meta",
        meta_config: {
          phone_number_id,
          waba_id: waba_id || null,
          access_token_encrypted: accessToken,
          quality_rating: phoneData.quality_rating || null,
        },
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[meta-embedded-signup] insert error:", insertErr);
      await logAttempt(supabase, {
        user_id, seller_member_id: seller_member_id || null, phone_number_id, waba_id: waba_id || null,
        step: "insert", success: false, error_text: insertErr.message, raw: insertErr as any,
      });
      return json({ success: false, error: insertErr.message }, 500);
    }

    await logAttempt(supabase, {
      user_id, seller_member_id: seller_member_id || null, phone_number_id, waba_id: waba_id || null,
      step: "success", success: true, error_text: subscribeWarning,
      raw: { instance_id: newInstance.id, verified_name: verifiedName, phone_number: phoneNumber, quality_rating: phoneData.quality_rating || null },
    });

    return json({
      success: true,
      instance_id: newInstance.id,
      provider: "meta",
      phone_number: phoneNumber,
      verified_name: verifiedName,
      warning: subscribeWarning,
    });
  } catch (error: unknown) {
    console.error("[meta-embedded-signup] Error:", error);
    // Exceção crua (best-effort). user_id/phone estão em escopo do try acima, então
    // aqui registramos só o essencial pra saber que caiu por exceção e o porquê.
    await logAttempt(supabase, {
      step: "exception", success: false,
      error_text: error instanceof Error ? error.message : "Unknown error",
      raw: error instanceof Error ? { name: error.name, stack: error.stack } : { error: String(error) },
    });
    return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
