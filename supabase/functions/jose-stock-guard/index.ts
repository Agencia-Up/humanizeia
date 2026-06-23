import { createClient } from "npm:@supabase/supabase-js@2";
import { searchPedroStock } from "../_shared/pedro-v2/stockSearch_20260525_photo_flow.ts";

/**
 * jose-stock-guard — José: detector de anúncio de carro VENDIDO (fatia 1: só relatório).
 *
 * Carro vende -> sai do estoque pela API -> mas o anúncio continua rodando e queimando
 * verba. Este detector varre os anúncios ATIVOS da Meta, extrai o veículo de cada um
 * (modelo/ano/preço do texto do criativo) e pergunta ao MESMO motor de estoque do Pedro
 * (searchPedroStock = BNDV/RevendaMais + rankVehiclesV2) se aquele carro ainda existe.
 *   - Achou no estoque  -> disponível -> mantém.
 *   - NÃO achou         -> vendido    -> entra no relatório (candidato a pausar).
 *
 * IDENTIDADE = modelo + ano (casamento esperto, não literal). Preço entra como conferência
 * com TOLERÂNCIA (reajuste de preço sem trocar o anúncio NÃO pode marcar como vendido). Km e
 * cor (quando não estão no texto) não são exigidos — senão dá falso-positivo e pausa carro bom.
 *
 * NESTA FATIA NÃO PAUSA NADA: só devolve o relatório pro dono validar o casamento nos dados
 * reais. A desativação (proposta no gate SIM/NÃO) vem na fatia 2, depois de validado.
 */

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";
const PRICE_TOLERANCE = 0.10; // 10% — reajuste comum sem trocar o anúncio

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jose-cron, x-user-id",
};

// ── Extrai modelo/ano/preço do TEXTO do criativo (nome + corpo do anúncio) ──
function parseAdVehicle(text: string): { query: string; ano: number | null; preco: number | null } {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  // ano: 19xx/20xx. "2020/2021" -> usa o ANO-MODELO (o maior). Ignora números soltos do preço.
  const anos = [...t.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0])).filter((n) => n >= 1990 && n <= 2030);
  const ano = anos.length ? Math.max(...anos) : null;
  // preço: R$ 68.990 / 68.990,00 (milhar com ponto). Pega o maior valor plausível.
  const precos: number[] = [];
  for (const m of t.matchAll(/(\d{1,3}(?:[.\s]\d{3})+(?:,\d{2})?)/g)) {
    const n = Number(m[1].replace(/[.\s]/g, "").replace(",", "."));
    if (Number.isFinite(n) && n >= 3000 && n <= 5_000_000) precos.push(n);
  }
  const preco = precos.length ? Math.max(...precos) : null;
  return { query: t.slice(0, 240), ano, preco };
}

function numField(v: any, ...keys: string[]): number {
  for (const k of keys) { const n = Number(v?.[k]); if (Number.isFinite(n) && n > 0) return n; }
  return 0;
}
function strField(v: any, ...keys: string[]): string {
  for (const k of keys) { if (v?.[k]) return String(v[k]); }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const authHeader = req.headers.get("Authorization") || "";
    const body = await req.json().catch(() => ({} as any));

    // tenant: cron (service role + x-user-id) OU JWT do usuário.
    const isCron = req.headers.get("x-jose-cron") === "true" && authHeader.includes(serviceKey);
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

    // ── Conta Meta (token) ──
    let accQ = admin.from("ad_accounts")
      .select("account_id, access_token_encrypted")
      .eq("user_id", userId!).eq("platform", "meta").eq("is_active", true);
    if (body?.ad_account_id) accQ = accQ.eq("id", body.ad_account_id);
    const { data: acc } = await accQ.order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!acc?.access_token_encrypted || !acc?.account_id) return json({ error: "Conta Meta não conectada." }, 400);
    const acct = `act_${String(acc.account_id).replace(/^act_/, "")}`;

    // ── Anúncios ATIVOS com o texto do criativo ──
    const adsUrl = new URL(`${META_GRAPH_URL}/${acct}/ads`);
    adsUrl.searchParams.set("access_token", acc.access_token_encrypted);
    adsUrl.searchParams.set("fields", "id,name,effective_status,creative{id,name,title,body,image_url,thumbnail_url}");
    adsUrl.searchParams.set("filtering", JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]));
    adsUrl.searchParams.set("limit", "200");
    const adsRes = await fetch(adsUrl.toString());
    const adsData = await adsRes.json();
    if (adsData?.error) return json({ error: `Meta: ${adsData.error.message}` }, 502);
    const ativos = (adsData?.data || []) as any[];

    const vendidos: any[] = [];
    const disponiveis: any[] = [];
    const ignorados: any[] = [];

    for (const ad of ativos) {
      const cr = ad.creative || {};
      const texto = [ad.name, cr.name, cr.title, cr.body].filter(Boolean).join(" — ");
      const veh = parseAdVehicle(texto);

      // Sem modelo/ano identificável (anúncio genérico "fale com consultor") -> não dá pra casar.
      if (!veh.ano && veh.query.replace(/[^a-zA-Z]/g, "").length < 4) {
        ignorados.push({ ad_id: ad.id, ad_name: ad.name, motivo: "anúncio genérico (sem 1 carro específico)" });
        continue;
      }

      let res: any;
      try {
        res = await searchPedroStock(admin, {
          user_id: userId!,
          query: veh.query,
          filters: veh.ano ? { ano_min: veh.ano, ano_max: veh.ano } : {},
          limit: 5,
        });
      } catch (e) {
        ignorados.push({ ad_id: ad.id, ad_name: ad.name, motivo: `erro no estoque: ${String((e as any)?.message || e).slice(0, 80)}` });
        continue;
      }

      const items = (res?.items || []) as any[];
      const thumb = cr.image_url || cr.thumbnail_url || null;

      if (!items.length) {
        // Nenhum carro do estoque casa modelo+ano -> VENDIDO.
        vendidos.push({
          ad_id: ad.id, ad_name: ad.name, thumbnail_url: thumb,
          extraido: { modelo: veh.query, ano: veh.ano, preco: veh.preco },
          motivo: veh.ano ? `nenhum ${veh.ano} desse modelo no estoque` : "modelo não encontrado no estoque",
        });
        continue;
      }

      // Achou. Confere o preço com tolerância (só sinaliza, não muda o veredito).
      const top = items[0];
      const stockPrice = numField(top, "saleValue", "salePrice", "price", "preco", "valor");
      const nomeEstoque = [strField(top, "markName", "brand", "marca"), strField(top, "modelName", "model", "modelo"), strField(top, "versionName", "version", "versao")].filter(Boolean).join(" ").trim() || "(carro do estoque)";
      let nota: string | null = null;
      if (veh.preco && stockPrice > 0) {
        const diff = Math.abs(stockPrice - veh.preco) / veh.preco;
        if (diff > PRICE_TOLERANCE) nota = `preço difere ${Math.round(diff * 100)}% (anúncio ${veh.preco} x estoque ${stockPrice}) — confira`;
      }
      disponiveis.push({
        ad_id: ad.id, ad_name: ad.name, thumbnail_url: thumb,
        extraido: { modelo: veh.query, ano: veh.ano, preco: veh.preco },
        casou_com: nomeEstoque, nota,
      });
    }

    return json({
      ok: true,
      conta: acct,
      total_ativos: ativos.length,
      resumo: { vendidos: vendidos.length, disponiveis: disponiveis.length, ignorados: ignorados.length },
      vendidos,      // candidatos a pausar (fatia 2 vai propor a desativação)
      disponiveis,   // mantém ativo
      ignorados,     // genérico / erro — não dá pra casar
      obs: "Fatia 1: detecção apenas, NÃO pausa anúncio. Valide o casamento antes de ligar a desativação automática.",
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
