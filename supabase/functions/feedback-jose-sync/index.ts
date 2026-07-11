// feedback-jose-sync
// Robô que PRÉ-CALCULA o gasto por carro (correto, batendo com o total da conta) pros
// períodos 7/30/60 dias, BAIXA a imagem de cada criativo pro nosso bucket (sempre abre,
// não expira) e grava em feedback_jose_trafego. O painel "Por produto" lê isso na hora.
// Roda por cron (service-role + x-user-id) OU on-demand (JWT do gestor -> botão Atualizar).
// SÓ LEITURA da Meta — não altera anúncio/campanha. Resposta compacta (sem arrays gigantes).
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpendByCreative } from "../_shared/jose-v2/dashboardQueries.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id, x-jose-cron",
};
const BUCKET = "jose-criativos";
const PERIODOS = [7, 30, 60];

function brtDateStr(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
function assetKeyFrom(url?: string): string | null {
  if (!url) return null;
  const m = String(url).match(/\/(\d{6,})_/);
  return m ? m[1] : null;
}
function isServiceRole(bearer: string, serviceKey: string): boolean {
  if (bearer === serviceKey) return true;
  try {
    const pp = (bearer.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = pp.padEnd(pp.length + ((4 - pp.length % 4) % 4), "=");
    return JSON.parse(atob(pad))?.role === "service_role";
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, serviceKey);

    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const svc = isServiceRole(bearer, serviceKey);
    const xUser = req.headers.get("x-user-id");

    let callerId: string;
    if (svc && xUser) {
      callerId = xUser;
    } else {
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      callerId = user.id;
    }
    const { data: tenantId } = await admin.rpc("resolve_billing_owner_user_id", { p_user_id: callerId });
    const tenant = (tenantId as string) || callerId;

    // baixa a imagem 1x por criativo (dedupe por asset_key) e devolve a URL pública nossa
    const imgCache = new Map<string, string | null>();
    async function ensureImage(assetKey: string, url: string): Promise<string | null> {
      if (imgCache.has(assetKey)) return imgCache.get(assetKey)!;
      let out: string | null = null;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const ct = res.headers.get("content-type") || "image/jpeg";
          const ext = ct.includes("png") ? "png" : "jpg";
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.length > 0 && bytes.length < 8_000_000) {
            const path = `${tenant}/${assetKey}.${ext}`;
            const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: ct, upsert: true });
            if (!up.error) out = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
          }
        }
      } catch (_e) { out = null; }
      imgCache.set(assetKey, out);
      return out;
    }

    const resumo: Array<{ periodo: number; criativos: number; gasto_total: number; soma_criativos: number }> = [];
    for (const dias of PERIODOS) {
      const since = brtDateStr(-(dias - 1));
      const until = brtDateStr(0);
      const dados = await getSpendByCreative(admin, tenant, { timeRange: { since, until } });
      if (!dados) { resumo.push({ periodo: dias, criativos: 0, gasto_total: 0, soma_criativos: 0 }); continue; }

      const rows: any[] = [];
      let soma = 0;
      for (const c of dados.criativos) {
        const ak = assetKeyFrom(c.thumbnail_url || undefined);
        let imageUrl = c.thumbnail_url || null;
        if (ak && c.thumbnail_url) {
          const stored = await ensureImage(ak, c.thumbnail_url);
          if (stored) imageUrl = stored;
        }
        soma += Number(c.gasto) || 0;
        rows.push({
          tenant_id: tenant, periodo_dias: dias, nome: c.nome,
          gasto: c.gasto, conversas: c.conversas, status: c.status,
          image_url: imageUrl, asset_key: ak, gasto_total_periodo: dados.gasto_total,
          computed_at: new Date().toISOString(),
        });
      }
      // troca atômica-ish: apaga o período do tenant e reinsere
      await admin.from("feedback_jose_trafego").delete().eq("tenant_id", tenant).eq("periodo_dias", dias);
      if (rows.length) {
        // dedupe por nome (unique tenant+periodo+nome)
        const seen = new Set<string>();
        const uniq = rows.filter((r) => { const k = String(r.nome).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
        await admin.from("feedback_jose_trafego").insert(uniq);
      }
      resumo.push({ periodo: dias, criativos: rows.length, gasto_total: Math.round((dados.gasto_total || 0) * 100) / 100, soma_criativos: Math.round(soma * 100) / 100 });
    }

    return json({ ok: true, tenant, imagens_salvas: Array.from(imgCache.values()).filter(Boolean).length, resumo });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
