/**
 * pedro-v2-health-monitor — varre pedro_v2_turn_logs REAIS e GRAVA um relatorio diario de
 * "saude" em pedro_v2_health_reports, flagrando assinaturas de regressao que viemos corrigindo:
 *  - unsolicited_photos    : fotos enviadas sem o lead pedir (e sem ser aceite curto de oferta)
 *  - ctwa_ad_lost          : lead de anuncio (rajada) cujo ad_context se perdeu (corrigido v120)
 *  - ad_vehicle_unresolved : anuncio presente mas veiculo NAO resolvido
 *  - byok_block            : conta nova sem chave de IA (nao respondeu)
 *  - provider_error        : falha de provedor de IA (sem credito / chave invalida)
 *
 * Registro-only (decisao do dono): NAO envia WhatsApp; o relatorio fica na tabela pra consulta.
 * Chamado pelo cron diario (cron_pedro_v2_health) e tambem invocavel sob demanda.
 * body.hours (default 24) | body.dry_run=true -> calcula e retorna SEM gravar.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const stripPlaceholders = (s: string) => String(s || "").replace(/\[[^\]]*\]/g, " ");
const asksPhoto = (t: string) => /\b(foto|fotos|imagem|imagens|mostra|me mostra|ver o carro|manda (a|as|uma|umas)? ?foto|catalogo|album)\b/i.test(stripPlaceholders(t));
const shortAffirm = (t: string) => /^\s*(sim|pode|pode sim|isso|claro|quero|ok|blz|manda|pode mandar|aham|positivo)[\s.!]*$/i.test(stripPlaceholders(t).trim());
const adInterest = (t: string) => /\b(tenho interesse|interessei|vim do an[uú]ncio|do an[uú]ncio|mais informa|quero saber|esse carro|esse ve[ií]culo|esse an[uú]ncio)\b/i.test(stripPlaceholders(t));

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  let body: any = {};
  try { body = await req.json(); } catch { /* sem body (cron) */ }
  const hours = Number(body?.hours) > 0 ? Number(body.hours) : 24;
  const dryRun = body?.dry_run === true;
  const sinceIso = new Date(Date.now() - hours * 3600e3).toISOString();

  const { data, error } = await supabase.from("pedro_v2_turn_logs")
    .select("created_at,remote_jid,next_action,payload,result")
    .eq("dry_run", false).gte("created_at", sinceIso)
    .order("created_at", { ascending: false }).limit(3000);
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

  const flags: Record<string, any[]> = { unsolicited_photos: [], ctwa_ad_lost: [], ad_vehicle_unresolved: [], byok_block: [], provider_error: [] };
  let total = 0;
  for (const r of data || []) {
    total++;
    const res: any = r.result || {}, pl: any = r.payload || {};
    const text = String(pl.text || ""), ad: any = pl.ad_context || {}, bp: any = pl.brain_plan || {};
    const mc = Number(res.media_count || 0);
    const samp = (extra: any) => ({ at: r.created_at, jid: String(r.remote_jid).slice(-9), in: text.slice(0, 70), ...extra });
    if (mc > 0 && !asksPhoto(text) && !shortAffirm(text)) flags.unsolicited_photos.push(samp({ mc, src: res.reply_source }));
    if (ad.has_ad_context === false && adInterest(text) && !bp.search_query && ["reply_only", "clarify"].includes(String(bp.action)))
      flags.ctwa_ad_lost.push(samp({ action: bp.action }));
    if (ad.has_ad_context === true && !ad.vehicle_query && !bp.search_query) flags.ad_vehicle_unresolved.push(samp({ ad_conf: ad.confidence }));
    if (res.ai_key_source === "none" || r.next_action === "no_ai_key_configured") flags.byok_block.push(samp({}));
    const perr = Array.isArray(res.ai_provider_errors) ? res.ai_provider_errors : [];
    if (perr.some((e: any) => e?.kind === "quota" || e?.kind === "auth")) flags.provider_error.push(samp({ errs: perr.map((e: any) => e.kind) }));
  }
  const counts: Record<string, number> = {};
  for (const [k, arr] of Object.entries(flags)) counts[k] = arr.length;
  const samples: Record<string, any[]> = {};
  for (const [k, arr] of Object.entries(flags)) samples[k] = arr.slice(0, 10);
  const hasFindings = Object.values(counts).some((n) => n > 0);

  const report = { window_hours: hours, total_turns: total, since: sinceIso, counts, samples, has_findings: hasFindings };
  if (!dryRun) {
    try {
      await supabase.from("pedro_v2_health_reports").insert({ window_hours: hours, total_turns: total, counts, samples, has_findings: hasFindings });
    } catch (e) {
      return new Response(JSON.stringify({ ok: true, persisted: false, persist_error: String((e as any)?.message || e), report }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
  }
  return new Response(JSON.stringify({ ok: true, persisted: !dryRun, report }), { headers: { ...cors, "Content-Type": "application/json" } });
});
