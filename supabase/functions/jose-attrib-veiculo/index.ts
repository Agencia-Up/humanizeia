import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * jose-attrib-veiculo — puxa o VEÍCULO do anúncio que está na conversa (Pedro) e usa como
 * atribuição no José. Diretriz do dono: dado real do Pedro que dá pra atribuir às campanhas,
 * tem que ser puxado e ser útil.
 *
 * O lead chega atribuído pelo TÍTULO genérico ("Fale agora com um de nossos consultores"),
 * mas o `ctwa_ad` guardado em wa_chat_history.metadata diz o CARRO específico (no greeting ou
 * no body). Aqui a gente extrai esse carro e grava em ai_crm_leads.ad_name — assim a qualidade
 * por anúncio (view lead_quality_by_ad, tabela ANÚNCIO, chat, relatório) passa a ser POR CARRO,
 * não um blob genérico. Só mexe em quem tem carro extraível; o resto fica como está.
 *
 * Idempotente: roda quantas vezes quiser. On-demand (botão na Cabine) ou cron.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jose-cron, x-user-id",
};

// "Veículos revisados", "Como podemos ajudar", "Preencha o formulário" etc. = anúncio GENÉRICO
// (sem 1 carro). Não atribui — senão inventaria um "carro" que não existe.
const GENERICO = /ve[íi]culos revisados|diversos modelos|aten[çc][ãa]o|pensando em trocar|preencha o formul|como podemos ajudar|melhores ofertas|confira as op/i;

function clean(s: string): string {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

// Extrai o carro do ctwa_ad: 1º do greeting ("saber mais sobre o X?"), 2º do body (1ª linha).
function extractVehicle(ctwaAd: any): string | null {
  if (!ctwaAd || typeof ctwaAd !== "object") return null;
  const greeting = String(ctwaAd.greetingMessageBody || "");
  const body = String(ctwaAd.body || ctwaAd.description || "");

  const m = greeting.match(/(?:saber mais sobre (?:o |a |os |as )?|encontrou (?:o |a )|interesse (?:n[oa] )?)\s*([^?\n]+?)(?:\?|\s+por\s+R\$|$)/i);
  if (m && m[1] && !GENERICO.test(m[1])) { const v = clean(m[1]); if (v.length >= 3) return v; }

  if (body && !GENERICO.test(body)) {
    const firstLine = body.split("\n")[0].replace(/^[^\p{L}\p{N}]+/u, "").replace(/[!:].*$/s, "").trim();
    if (firstLine && firstLine.length >= 3 && firstLine.length <= 60 && !GENERICO.test(firstLine)) return clean(firstLine);
  }
  return null;
}

const normJid = (s: string) => String(s || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const authHeader = req.headers.get("Authorization") || "";
    const body = await req.json().catch(() => ({} as any));

    const isCron = req.headers.get("x-jose-cron") === "true" && authHeader.includes(serviceKey);
    let userId: string | undefined;
    if (isCron) {
      userId = req.headers.get("x-user-id") || body?.user_id;
      if (!userId) return json({ error: "x-user-id obrigatório no cron" }, 400);
    } else {
      if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error } = await uc.auth.getUser();
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    }

    // ctwa_ad por conversa (remote_jid) — o MAIS ANTIGO (o clique original do anúncio).
    const { data: hist } = await admin.from("wa_chat_history")
      .select("remote_jid, metadata, created_at")
      .eq("user_id", userId!)
      .not("metadata->ctwa_ad", "is", null)
      .order("created_at", { ascending: true })
      .limit(5000);
    const adByJid = new Map<string, any>();
    for (const h of (hist || []) as any[]) {
      const k = normJid(h.remote_jid);
      if (k && !adByJid.has(k)) adByJid.set(k, (h.metadata as any)?.ctwa_ad);
    }

    const { data: leads } = await admin.from("ai_crm_leads")
      .select("id, remote_jid, ad_name").eq("user_id", userId!);

    let comVeiculo = 0, atualizados = 0;
    const ups: Promise<any>[] = [];
    for (const l of (leads || []) as any[]) {
      const ad = adByJid.get(normJid(l.remote_jid));
      if (!ad) continue;
      const veic = extractVehicle(ad);
      if (!veic) continue;
      comVeiculo++;
      if (l.ad_name !== veic) {
        atualizados++;
        ups.push(admin.from("ai_crm_leads").update({ ad_name: veic }).eq("id", l.id));
      }
    }
    await Promise.all(ups);

    return json({
      ok: true,
      conversas_com_anuncio: adByJid.size,
      leads_com_veiculo_extraido: comVeiculo,
      ad_name_atualizados: atualizados,
      obs: "Atribuição por carro do anúncio (do greeting/body da conversa). A tabela ANÚNCIO passa a separar por veículo.",
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
