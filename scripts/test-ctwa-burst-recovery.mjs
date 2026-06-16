// Teste de integracao do RECOVERY de anuncio em rajada (v120).
// Simula a 1a msg do burst (com externalAdReply salvo no metadata) e faz um dry-run da ULTIMA msg
// (sem anuncio) -> deve recuperar o Pulse do metadata. Auto-limpa.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']\s*$/g, "").trim();
}
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const URL = "https://seyljsqmhlopkcauhlor.supabase.co";
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const USER = "f49fd48a-4386-4009-95f3-26a5100b84f7";
const AGENT = "aee7e916-31b1-431c-ba6f-f38178fd4899";
const CHAT = "5599" + Math.floor(Math.random() * 1e7) + "@s.whatsapp.net";
const ad = {
  greetingMessageBody: "Oi! Como podemos ajudar?",
  title: "De: R$ 111.990,00 (Veículo na Troca) Por: R$ 108.990,00 (A vista)",
  body: "🚗 PULSE AUDACE T200\n\nAno: 2024/2025\nKm: 48.800\nMotor: 1.0 Turbo\nCâmbio: Automático\nCombustível: Flex\n\nDe: R$ 111.990,00 (Veículo na Troca)\nPor: R$ 108.990,00 (A vista)",
  sourceUrl: "https://www.instagram.com/p/DY92KIJDEKT/", sourceApp: "instagram",
};
const out = {};
let leadId = null, msgIds = [];
try {
  // lead minimo (pra lead?.id existir no orchestrator)
  const { data: lead, error: le } = await sb.from("ai_crm_leads").insert({ user_id: USER, agent_id: AGENT, remote_jid: CHAT, lead_name: "Teste Burst" }).select("id").maybeSingle();
  if (le) out.lead_err = le.message; else { leadId = lead.id; }
  // msg1 do burst: carrega o anuncio no metadata (como o fix v120 salva)
  const { data: m1 } = await sb.from("wa_chat_history").insert({ user_id: USER, agent_id: AGENT, instance_id: "whatsapp-carvalho-4yae", remote_jid: CHAT, role: "user", content: "Olá! Tenho interesse e queria mais informações, por favor.", metadata: { ctwa_ad: ad } }).select("id").maybeSingle();
  if (m1) msgIds.push(m1.id);
  // dry-run da ULTIMA msg do burst — SEM externalAdReply
  const r = await fetch(`${URL}/functions/v1/pedro-webhook-v2`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY, apikey: KEY }, body: JSON.stringify({ instanceName: "whatsapp-carvalho-4yae", chatid: CHAT, senderName: "Teste Burst", text: "Quantos kms", dry_run: true }) });
  const j = await r.json();
  out.build = j.build; out.ad_vehicle = (j.ad_context || {}).vehicle_query;
  out.search_query = (j.brain_plan || {}).search_query;
  out.recovered_PULSE = /pulse/i.test(JSON.stringify(j.brain_plan || {}) + String((j.reply || {}).text || ""));
  out.reply = String((j.reply || {}).text || "").slice(0, 170);
} catch (e) { out.error = String(e?.message || e); }
finally {
  for (const id of msgIds) { try { await sb.from("wa_chat_history").delete().eq("id", id); } catch (_e) {} }
  try { await sb.from("wa_chat_history").delete().eq("remote_jid", CHAT); } catch (_e) {}
  if (leadId) { try { await sb.from("ai_crm_leads").delete().eq("id", leadId); } catch (_e) {} }
  out.cleanup = "ok";
}
console.log(JSON.stringify(out, null, 2));
