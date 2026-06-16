// Aplica um arquivo .sql no projeto via Supabase Management API (read-write).
// Uso: node scripts/apply-sql-mgmt.mjs <caminho-do-sql>
// Le SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_REF de supabase/.env.local (NUNCA imprime o token).
import fs from "node:fs";

const sqlPath = process.argv[2];
if (!sqlPath) { console.error("uso: node scripts/apply-sql-mgmt.mjs <arquivo.sql>"); process.exit(1); }

const envLocal = {};
for (const l of fs.readFileSync("supabase/.env.local", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) envLocal[m[1]] = m[2].replace(/^["']|["']\s*$/g, "").trim();
}
const TOKEN = envLocal.SUPABASE_ACCESS_TOKEN;
const REF = envLocal.SUPABASE_PROJECT_REF || "seyljsqmhlopkcauhlor";
if (!TOKEN) { console.error("SUPABASE_ACCESS_TOKEN ausente em supabase/.env.local"); process.exit(1); }

const query = fs.readFileSync(sqlPath, "utf8");
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
const body = await r.text();
console.log(JSON.stringify({ status: r.status, ok: r.ok, body: body.slice(0, 600) }));
process.exit(r.ok ? 0 : 1);
