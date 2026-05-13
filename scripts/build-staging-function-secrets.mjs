import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outFile = path.join(root, "supabase", ".env.staging.function-secrets.local");

function readEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function envLine(key, value) {
  if (!value) return null;
  const escaped = String(value).replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
  return `${key}=${escaped}`;
}

async function fetchRows(env, table, query) {
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${table}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : [];
}

const env = readEnv(path.join(root, "supabase", ".env.staging.keys.local"));
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing staging service env file.");
}

const instances = await fetchRows(
  env,
  "wa_instances",
  "select=api_url,api_key_encrypted,status,is_active&api_url=not.is.null&api_key_encrypted=not.is.null&order=is_active.desc,last_connected_at.desc&limit=1",
);
const adAccounts = await fetchRows(
  env,
  "ad_accounts",
  "select=account_id,access_token_encrypted,is_active&access_token_encrypted=not.is.null&order=is_active.desc,updated_at.desc&limit=1",
);

const lines = [
  envLine("EVOLUTION_API_URL", instances[0]?.api_url),
  envLine("EVOLUTION_API_KEY", instances[0]?.api_key_encrypted),
  envLine("META_ACCESS_TOKEN", adAccounts[0]?.access_token_encrypted),
  envLine("META_AD_ACCOUNT_ID", adAccounts[0]?.account_id),
].filter(Boolean);

fs.writeFileSync(outFile, `${lines.join("\n")}\n`);
console.log(`Wrote ${lines.length} staging function secrets to ${outFile}`);
