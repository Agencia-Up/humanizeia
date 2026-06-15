// Regressão de LEITURA DE ANÚNCIO (CTWA) com PAYLOAD REAL.
// Pega as capturas reais em ctwa_diag_capture (payloads que o uazapi entregou de verdade),
// extrai o veiculo esperado do greetingMessageBody, e REPLAYA cada payload pelo dry-run do
// agente — checando se a resposta cita o MODELO e o ANO certos do anuncio.
// Uso: node scripts/replay-ctwa.mjs [N]   (N = quantas capturas recentes; default 15)
// Por que existe: testes com anuncio "injetado simplificado" passavam mas o caminho REAL
// (aninhado + corpo promocional "custo-beneficio") quebrava. Aqui validamos o caminho REAL.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']\s*$/g, "").trim();
}
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const URL = "https://seyljsqmhlopkcauhlor.supabase.co";
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const N = Number(process.argv[2]) || 15;

function deepFind(obj, key, d = 0) {
  if (!obj || typeof obj !== "object" || d > 14) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (k === key && v) return v;
    if (v && typeof v === "object") { const r = deepFind(v, key, d + 1); if (r) return r; }
  }
  return null;
}
function expectedFromGreeting(greeting) {
  const m = String(greeting || "").match(/sobre\s+(?:o|a|os|as)?\s*(.+?)\s*(?:dispon[ií]ve|por\s+r\$|\?)/i);
  const veh = m ? m[1].trim() : "";
  const ym = String(greeting || "").match(/\b(19|20)\d{2}\b/);
  const model = veh.split(/\s+/).filter((w) => !/^(19|20)\d{2}$/.test(w)).slice(0, 3).join(" ");
  return { veh, model, year: ym ? ym[0] : null };
}

const rows = (await sb.from("ctwa_diag_capture").select("payload, created_at").order("created_at", { ascending: false }).limit(N)).data || [];
let pass = 0, fail = 0, skip = 0;
for (const row of rows) {
  const greeting = deepFind(row.payload, "greetingMessageBody");
  if (!greeting) { skip++; continue; }
  const exp = expectedFromGreeting(greeting);
  if (!exp.model) { skip++; continue; }
  const FRESH = "55" + Math.floor(Math.random() * 1e9);
  let s = JSON.stringify(row.payload);
  const realPhone = deepFind(row.payload, "sender_pn");
  const realLid = deepFind(row.payload, "sender");
  for (const id of [realPhone, realLid]) {
    if (id) { const dig = String(id).replace(/\D/g, ""); if (dig) s = s.split(dig).join(FRESH); }
  }
  const p = JSON.parse(s); p.dry_run = true; p.chatid = FRESH + "@s.whatsapp.net";
  let reply = "";
  try {
    const r = await fetch(`${URL}/functions/v1/pedro-webhook-v2`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY, apikey: KEY }, body: JSON.stringify(p) });
    const j = await r.json();
    reply = typeof j.reply === "string" ? j.reply : (j.reply && j.reply.text) || "";
    if (j.next_action && /transfer|silence|hold/.test(j.next_action)) { skip++; continue; }
  } catch (e) { reply = "ERRO: " + e.message; }
  const rl = reply.toLowerCase();
  const modelTok = exp.model.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const modelOk = modelTok.some((w) => rl.includes(w));
  const yearOk = !exp.year || rl.includes(exp.year);
  const ok = modelOk && yearOk && reply && !/n[aã]o temos/i.test(reply);
  console.log(`${ok ? "OK  " : "FAIL"} | esperado: ${exp.model}${exp.year ? " " + exp.year : ""} | reply: ${reply.slice(0, 110).replace(/\n/g, " ")}`);
  if (ok) pass++; else fail++;
}
console.log(`\n== ${pass} OK | ${fail} FAIL | ${skip} pulados (sem greeting/transferido) ==`);
