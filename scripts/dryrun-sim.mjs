// Helper de simulação (dry-run) do Pedro v2 para o check-up pré-lançamento.
// Uso: node scripts/dryrun-sim.mjs "<mensagem>" "<chatid-ou-vazio>" "<greeting-anuncio-opcional>"
// NAO envia mensagem (dry_run:true). Imprime UMA linha JSON com o resultado.
import fs from "node:fs";

const [, , message, chatidArg, greeting] = process.argv;
const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']\s*$/g, "").trim();
}
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const chatid = (chatidArg && chatidArg.trim())
  ? chatidArg.trim()
  : `5599${Math.floor(Math.random() * 1e7).toString().padStart(7, "0")}@s.whatsapp.net`;

const body = {
  instanceName: "whatsapp-carvalho-4yae",
  chatid,
  senderName: "Teste",
  text: message || "",
  dry_run: true,
};
if (greeting && greeting.trim()) {
  // externalAdReply no TOPO do payload (caminho que o dry-run le sem quebrar a extracao do
  // texto). NAO usar `body.message` aninhado: zera o texto da vez no harness do dry-run.
  body.externalAdReply = {
    title: "📲 Fale agora com um de nossos consultores!",
    body: "🚗 Veículos revisados e prontos para você!",
    greetingMessageBody: greeting.trim(),
    sourceUrl: "https://fb.me/abc123XYZ",
  };
}

try {
  const r = await fetch("https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-webhook-v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY, apikey: KEY },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({ _raw: "non-json status " + r.status }));
  const bp = j.brain_plan || {};
  const sr = j.stock_result || {};
  const items = (sr.items || []).slice(0, 5).map((v) => `${v.marca || ""} ${v.modelo || ""} ${v.ano || ""} R$${v.preco ?? "?"}`.trim());
  const reply = typeof j.reply === "string" ? j.reply : (j.reply && j.reply.text) || "";
  const fotos = (j.reply && j.reply.media ? j.reply.media.length : 0);
  console.log(JSON.stringify({
    chatid, build: j.build || null, action: bp.action, intent: bp.intent,
    search_query: bp.search_query, tipo: bp.search_filters && bp.search_filters.tipo_veiculo,
    preco_max: bp.search_filters && bp.search_filters.preco_max,
    stock_total: sr.total, items, fotos, next_action: j.next_action, reply,
    raw: j._raw || null,
  }));
} catch (e) {
  console.log(JSON.stringify({ error: String(e && e.message || e) }));
}
