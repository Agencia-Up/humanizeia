// feedback-jose-trafego
// Fornece pro painel "Por produto" (Feedbacks) o GASTO por criativo do José
// respeitando o INTERVALO DE DATAS do filtro — puxando AO VIVO da Meta (histórico
// completo), não do último snapshot (que é só de 1 dia / 7 dias). Reusa a função
// canônica getDashboardCards(timeRange) do José (mesma fonte da Cabine) pra não
// divergir. Também devolve o cache de carros lidos por imagem (jose_criativo_carro).
// SÓ LEITURA — não altera campanha/anúncio nenhum. NÃO depende do flag da Cabine.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpendByCreative } from "../_shared/jose-v2/dashboardQueries.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // tenant = dono da conta (mesmo escopo dos relatórios de feedback e do José)
    const { data: tenantId } = await admin.rpc("resolve_billing_owner_user_id", { p_user_id: user.id });
    const tenant = (tenantId as string) || user.id;

    const body = await req.json().catch(() => ({} as any));
    const since = ISO_DATE.test(String(body?.since || "")) ? String(body.since) : undefined;
    const until = ISO_DATE.test(String(body?.until || "")) ? String(body.until) : undefined;
    const timeRange = since && until ? { since, until } : undefined;

    // carros lidos por imagem (cache de visão) — sempre devolve, independe de ter Meta
    const { data: carrosRows } = await admin
      .from("jose_criativo_carro").select("asset_key,carro")
      .eq("tenant_id", tenant).not("carro", "is", null).neq("carro", "indefinido");
    const carros_ia = Array.isArray(carrosRows) ? carrosRows : [];

    // gasto por criativo AO VIVO da Meta pro intervalo pedido — HISTÓRICO completo
    // (inclui anúncios pausados que gastaram no período; não só os ativos de hoje).
    let dados: any = null;
    try {
      dados = await getSpendByCreative(admin, tenant, timeRange ? { timeRange } : { datePreset: "last_30d" });
    } catch (e) {
      return json({ ok: true, tem_dados: false, criativos: [], carros_ia, erro_meta: String((e as any)?.message || e) });
    }

    if (!dados) return json({ ok: true, tem_dados: false, criativos: [], carros_ia, reason: "sem_conta_meta" });

    return json({
      ok: true,
      tem_dados: true,
      computed_at: new Date().toISOString(),
      periodo: dados.periodo,
      gasto_total: dados.gasto_total,
      criativos: Array.isArray(dados.criativos) ? dados.criativos : [],
      carros_ia,
    });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
