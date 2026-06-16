// Health scan do Pedro v2: varre pedro_v2_turn_logs REAIS e flagra assinaturas de regressao
// (as que viemos corrigindo). Uso: node scripts/pedro-health-scan.mjs [horas]   (default 48h)
// Report-only (NAO envia nada). Base do monitor diario.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']\s*$/g, "").trim();
}
const sb = createClient("https://seyljsqmhlopkcauhlor.supabase.co", env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const HOURS = Number(process.argv[2]) || 48;
const sinceIso = new Date(Date.now() - HOURS * 3600e3).toISOString();

const { data, error } = await sb.from("pedro_v2_turn_logs")
  .select("created_at,remote_jid,intent,next_action,payload,result")
  .eq("dry_run", false).gte("created_at", sinceIso)
  .order("created_at", { ascending: false }).limit(2000);
if (error) { console.log("ERR", error.message); Deno?.exit?.(1); process.exit(1); }

const stripPlaceholders = (s) => String(s || "").replace(/\[[^\]]*\]/g, " ");
const asksPhoto = (t) => /\b(foto|fotos|imagem|imagens|mostra|me mostra|ver o carro|manda (a|as|uma|umas)? ?foto|catalogo|album)\b/i.test(stripPlaceholders(t));
const shortAffirm = (t) => /^\s*(sim|pode|pode sim|isso|claro|quero|ok|blz|manda|pode mandar|aham|positivo)[\s.!]*$/i.test(stripPlaceholders(t).trim());
const adInterest = (t) => /\b(tenho interesse|interessei|vim do an[uú]ncio|do an[uú]ncio|mais informa|quero saber|esse carro|esse ve[ií]culo|esse an[uú]ncio)\b/i.test(stripPlaceholders(t));

const flags = { unsolicited_photos: [], ctwa_ad_lost: [], ad_vehicle_unresolved: [], byok_block: [], provider_error: [] };
let total = 0;
for (const r of data || []) {
  total++;
  const res = r.result || {}, pl = r.payload || {};
  const text = String(pl.text || ""), ad = pl.ad_context || {}, bp = pl.brain_plan || {};
  const mc = Number(res.media_count || 0);
  const jid = String(r.remote_jid).slice(-9);
  const samp = (extra) => ({ at: r.created_at, jid, in: text.slice(0, 70), ...extra });
  // 1) fotos sem pedido (e sem ser aceite curto de oferta)
  if (mc > 0 && !asksPhoto(text) && !shortAffirm(text)) flags.unsolicited_photos.push(samp({ mc, src: res.reply_source }));
  // 2) anuncio PERDIDO: lead claramente de anuncio mas ad_context vazio + agente sem veiculo
  if (ad.has_ad_context === false && adInterest(text) && !bp.search_query && ["reply_only", "clarify"].includes(String(bp.action)))
    flags.ctwa_ad_lost.push(samp({ action: bp.action }));
  // 3) anuncio presente mas veiculo NAO resolvido
  if (ad.has_ad_context === true && !ad.vehicle_query && !bp.search_query) flags.ad_vehicle_unresolved.push(samp({ ad_conf: ad.confidence }));
  // 4) BYOK: conta nova sem chave
  if (res.ai_key_source === "none" || r.next_action === "no_ai_key_configured") flags.byok_block.push(samp({}));
  // 5) falha de provedor de IA (quota/auth)
  const perr = Array.isArray(res.ai_provider_errors) ? res.ai_provider_errors : [];
  if (perr.some((e) => e?.kind === "quota" || e?.kind === "auth")) flags.provider_error.push(samp({ errs: perr.map((e) => e.kind) }));
}

console.log(`\n== HEALTH SCAN — ultimas ${HOURS}h | ${total} turns reais (desde ${sinceIso.slice(0, 16)}) ==\n`);
for (const [k, arr] of Object.entries(flags)) {
  console.log(`${arr.length === 0 ? "✅" : "⚠️ "} ${k}: ${arr.length}`);
  for (const s of arr.slice(0, 6)) console.log("    " + JSON.stringify(s));
}
