// Troca o modelo (provider/model) de um agente wa_ai_agents. Escrita via SERVICE-ROLE (o MCP é read-only).
// Uso: node scripts/set-agent-model.mjs <agent_id> <provider/model>
// Ex.: node scripts/set-agent-model.mjs aee7e916-31b1-431c-ba6f-f38178fd4899 openai/gpt-4.1-mini
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']\s*$/g, "").trim();
}
const sb = createClient("https://seyljsqmhlopkcauhlor.supabase.co", env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [, , agentId, model] = process.argv;
if (!agentId || !model) { console.log("uso: node scripts/set-agent-model.mjs <agent_id> <provider/model>"); Deno?.exit?.(1); process.exit(1); }

const before = (await sb.from("wa_ai_agents").select("id,name,model").eq("id", agentId).maybeSingle()).data;
const { data, error } = await sb.from("wa_ai_agents").update({ model }).eq("id", agentId).select("id,name,model").maybeSingle();
console.log(JSON.stringify({ before, after: data, error: error?.message || null }));
