import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const tempSql = path.join(root, "supabase", ".temp", "logosia-staging-auth-users.sql");
const stagingPassword = process.env.STAGING_AUTH_PASSWORD || "LogosIA@Teste2026!";

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

function sqlString(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
}

async function request(url, key) {
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function fetchAllUsers(sourceUrl, sourceKey) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const url = `${sourceUrl.replace(/\/$/, "")}/auth/v1/admin/users?page=${page}&per_page=1000`;
    const payload = await request(url, sourceKey);
    const batch = Array.isArray(payload) ? payload : payload?.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users.filter((user) => user?.id && user?.email);
}

const productionEnv = readEnv(path.join(root, ".env"));
const sourceUrl = productionEnv.SUPABASE_URL || productionEnv.VITE_SUPABASE_URL;
const sourceKey = productionEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!sourceUrl || !sourceKey) {
  throw new Error("Missing production Supabase URL/service key.");
}

const users = await fetchAllUsers(sourceUrl, sourceKey);
if (!users.length) {
  throw new Error("No production auth users returned by admin API.");
}

const values = users.map((user) => {
  const email = user.email.toLowerCase();
  const rawAppMeta = {
    provider: "email",
    providers: ["email"],
    ...(user.app_metadata || {}),
  };
  const rawUserMeta = user.user_metadata || {};
  return `(
    '00000000-0000-0000-0000-000000000000'::uuid,
    ${sqlString(user.id)}::uuid,
    'authenticated',
    'authenticated',
    ${sqlString(email)},
    crypt(${sqlString(stagingPassword)}, gen_salt('bf')),
    now(),
    ${sqlJson(rawAppMeta)},
    ${sqlJson(rawUserMeta)},
    false,
    coalesce(${sqlString(user.created_at)}::timestamptz, now()),
    now(),
    ${sqlString(user.phone || null)},
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    false
  )`;
});

const identityValues = users.map((user) => {
  const email = user.email.toLowerCase();
  const identityData = {
    sub: user.id,
    email,
    email_verified: true,
    phone_verified: false,
  };
  return `(
    ${sqlString(user.id)},
    ${sqlString(user.id)}::uuid,
    ${sqlJson(identityData)},
    'email',
    now(),
    coalesce(${sqlString(user.created_at)}::timestamptz, now()),
    now(),
    ${sqlString(user.id)}::uuid
  )`;
});

const sql = `
create extension if not exists pgcrypto;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at,
  phone,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token,
  is_anonymous
) values
${values.join(",\n")}
on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  confirmation_token = '',
  recovery_token = '',
  email_change = '',
  email_change_token_new = '',
  email_change_token_current = '',
  phone_change = '',
  phone_change_token = '',
  reauthentication_token = '',
  updated_at = now(),
  is_anonymous = false;

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at,
  id
) values
${identityValues.join(",\n")}
on conflict (provider, provider_id) do update set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  updated_at = now();
`;

fs.mkdirSync(path.dirname(tempSql), { recursive: true });
fs.writeFileSync(tempSql, sql);

if (!process.argv.includes("--apply")) {
  console.log(`Generated ${tempSql} for ${users.length} auth users.`);
  process.exit(0);
}

const result = spawnSync("cmd", [
  "/c",
  "scripts\\supabase-logosia-staging.cmd",
  "db",
  "query",
  "--linked",
  "-f",
  tempSql,
], {
  cwd: root,
  encoding: "utf8",
  stdio: "pipe",
});

if (result.error) {
  throw result.error;
}

if (result.stdout?.trim()) console.log(result.stdout.trim());
if (result.stderr?.trim()) console.error(result.stderr.trim());

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Synced ${users.length} auth users into staging.`);
