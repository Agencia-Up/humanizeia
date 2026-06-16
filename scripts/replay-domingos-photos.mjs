// Replay do PAYLOAD REAL do Domingos (ctwa_diag_capture) p/ o bug "fotos sem necessidade".
// Reporta reply_source + contagem de fotos. Identidade trocada por numero fresco (estado limpo).
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

const { data } = await sb.from("ctwa_diag_capture").select("payload,created_at,markers").order("created_at", { ascending: false }).limit(200);
const hits = (data || []).filter((r) => JSON.stringify(r.payload || {}).includes("988231668")).reverse();
console.log("capturas Domingos:", hits.length);

for (const h of hits) {
  const FRESH = "55" + Math.floor(Math.random() * 1e9);
  let s = JSON.stringify(h.payload);
  // troca todas as identidades reais por um numero fresco (turn 1 limpo)
  s = s.split("5512988231668").join(FRESH).split("58858349322353").join(FRESH).split("551231996370").join(FRESH);
  const p = JSON.parse(s);
  p.dry_run = true;
  p.chatid = FRESH + "@s.whatsapp.net";
  try {
    const r = await fetch(`${URL}/functions/v1/pedro-webhook-v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY, apikey: KEY },
      body: JSON.stringify(p),
    });
    const j = await r.json();
    const bp = j.brain_plan || {};
    const reply = j.reply || {};
    console.log(JSON.stringify({
      at: h.created_at,
      markers: h.markers,
      build: j.build,
      action: bp.action,
      photo_target: bp.photo_target,
      reply_source: reply.source,
      FOTOS: Array.isArray(reply.media) ? reply.media.length : 0,
      next_action: j.next_action,
      reply: String(reply.text || "").slice(0, 130).replace(/\n/g, " "),
    }));
  } catch (e) {
    console.log("ERR", h.created_at, String(e?.message || e));
  }
}
