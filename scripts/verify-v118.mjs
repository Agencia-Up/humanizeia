import fs from "node:fs";
const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']\s*$/g, "").trim();
}
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const URL = "https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-webhook-v2";
async function run(text, name) {
  const chatid = "5599" + Math.floor(Math.random() * 1e7) + "@s.whatsapp.net";
  const r = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY, apikey: KEY }, body: JSON.stringify({ instanceName: "whatsapp-carvalho-4yae", chatid, senderName: "Joao", text, dry_run: true }) });
  const j = await r.json();
  const bp = j.brain_plan || {}, reply = j.reply || {}, sr = j.stock_result || {};
  const items = (sr.items || []).map((v) => ({ m: `${v.marca} ${v.modelo}`.slice(0, 18), ano: v.ano, p: v.preco }));
  return { name, build: j.build, action: bp.action, preco_max: bp.search_filters?.preco_max, src: reply.source, FOTOS: Array.isArray(reply.media) ? reply.media.length : 0, pronto: reply.pronto_para_transferir, next: j.next_action, items, reply: String(reply.text || "").slice(0, 150).replace(/\n/g, " ") };
}
const cases = [
  ["tem corolla ate 50 mil?", "PRICE corolla<=50k (nada de carro >50k como se coubesse)"],
  ["tem onix ate 30 mil?", "PRICE onix<=30k (sem carro sem-preco furando teto)"],
  ["[áudio recebido]", "AUDIO falho (nao prometer escutar; pedir texto)"],
  ["tem video do onix?", "VIDEO (FOTOS=0; oferecer fotos honesto)"],
  ["quero financiar o Onix, meu nome e Joao", "FINANCE (pronto_para_transferir=true)"],
  ["voces financiam?", "FINANCE info-only (NAO transferir)"],
  ["manda foto do onix", "REGRESSAO foto (FOTOS>0)"],
];
for (const [t, n] of cases) {
  try { console.log("\n### " + n + "\n" + JSON.stringify(await run(t, n), null, 0)); }
  catch (e) { console.log("\n### " + n + "\nERR " + String(e?.message || e)); }
}
