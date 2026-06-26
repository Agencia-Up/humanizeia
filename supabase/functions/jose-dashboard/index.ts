import { createClient } from "npm:@supabase/supabase-js@2";
import { getDashboardCards } from "../_shared/jose-v2/dashboardQueries.ts";
import { isFeatureEnabled } from "../_shared/jose-v2/flags.ts";
import { analyzeCreativeImage } from "../_shared/jose-v2/visionAnalysis.ts";

/**
 * jose-dashboard — José Cabine de Comando / Bloco A (cards Power BI).
 *
 * Calcula os cards da Cabine (vitrine da Meta + verdade do lead_quality_by_ad),
 * cacheia em jose_dashboard_snapshots e devolve. Fonte única: usa as MESMAS funções
 * de dashboardQueries.ts que o chat do José (Bloco B) vai chamar — anti-divergência.
 *
 * Dois modos:
 *  - Usuário (JWT): on-demand ao abrir a aba Cabine.
 *  - Cron (service role + x-jose-cron:true + x-user-id): aquecer o cache (futuro).
 * Sempre atrás do flag 'cabine_cards' (fail-safe off).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jose-cron, x-user-id",
};

function isServiceRoleRequest(authHeader: string, serviceKey: string): boolean {
  if (!authHeader) return false;
  if (serviceKey && authHeader.includes(serviceKey)) return true;
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const payloadPart = token.split(".")[1] || "";
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    const payload = JSON.parse(atob(padded));
    const ref = (Deno.env.get("SUPABASE_URL") || "").match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1];
    return payload.role === "service_role" && (!ref || payload.ref === ref) && (!payload.exp || payload.exp * 1000 > Date.now());
  } catch (_e) {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const body = await req.json().catch(() => ({} as any));

    // Resolve o tenant: cron (service role) confia no x-user-id; senão valida o JWT.
    const isCron = req.headers.get("x-jose-cron") === "true" && isServiceRoleRequest(authHeader, serviceKey);
    let userId: string | undefined;
    if (isCron) {
      userId = req.headers.get("x-user-id") || body?.user_id;
      if (!userId) return json({ error: "x-user-id obrigatório no cron" }, 400);
    } else {
      if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    }

    // Flag desligado => não calcula nada (fail-safe).
    if (!(await isFeatureEnabled(admin, userId!, "cabine_cards"))) {
      return json({ enabled: false, reason: "flag_off" });
    }

    // Ação: o José OLHA a arte de UM criativo (botão "Analisar arte" na galeria).
    // On-demand (só quando o dono clica) -> custo de IA controlado. Reusa o visionAnalysis.
    if (body?.action === "analisar_criativo") {
      const imageUrl = String(body?.image_url || "");
      if (!imageUrl) return json({ error: "image_url obrigatório" }, 400);
      let nicho = "generico";
      try {
        const { data: acc } = await admin.from("ad_accounts").select("nicho").eq("user_id", userId!).eq("is_active", true).limit(1).maybeSingle();
        if (acc?.nicho) nicho = acc.nicho;
      } catch (_e) { /* nicho default */ }
      const res = await analyzeCreativeImage(admin, { user_id: userId!, nicho, image_url: imageUrl });
      if (!res.ok || !res.analise) return json({ error: res.error || "falha_analise" }, 502);
      return json({ analise: res.analise });
    }

    const cards = await getDashboardCards(admin, userId!, {
      adAccountId: body?.ad_account_id,
      datePreset: body?.date_preset || body?.periodo || "last_7d",
      timeRange: body?.time_range,
    });
    if (!cards) return json({ enabled: true, cards: null, reason: "sem_conta_meta" });

    // Cacheia o snapshot (best-effort). Usa o id de conta RESOLVIDO (nunca nulo aqui).
    try {
      await admin.from("jose_dashboard_snapshots").upsert({
        user_id: userId,
        ad_account_id: cards.ad_account_id,
        periodo: cards.periodo,
        payload: cards,
        computed_at: new Date().toISOString(),
      }, { onConflict: "user_id,ad_account_id,periodo" });
    } catch (_e) { /* cache best-effort */ }

    return json({ enabled: true, cards });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
