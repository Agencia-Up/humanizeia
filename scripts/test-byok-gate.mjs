// Teste do GATE BYOK contra o banco REAL (sem mexer em conta de produção).
// Exercita os MESMOS primitivos que resolveAiKey() usa: RPC get_client_ai_key + profiles.created_at vs cutoff.
// Cria um usuario de teste POS-corte, valida que ele resolve para 'none', e LIMPA no final.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']\s*$/g, "").trim();
}
const URL = "https://seyljsqmhlopkcauhlor.supabase.co";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const CUTOFF = Date.parse("2026-06-16T03:00:00Z"); // == BYOK_GRANDFATHER_CUTOFF

// Replica EXATA da decisao de resolveAiKey (sem fallback de env, so a logica de source).
async function resolveSource(userId) {
  // 1. chave do cliente
  const { data: ck } = await sb.rpc("get_client_ai_key", { p_user_id: userId, p_provider: "openai" });
  if (typeof ck === "string" && ck.trim().length > 0) return { source: "client", hasClientKey: true };
  // 2. grandfathered?
  const { data: prof } = await sb.from("profiles").select("created_at").eq("id", userId).maybeSingle();
  const createdMs = prof?.created_at ? Date.parse(prof.created_at) : NaN;
  const grandfathered = Number.isFinite(createdMs) ? createdMs <= CUTOFF : true; // fail-open
  return { source: grandfathered ? "platform" : "none", hasClientKey: false, created_at: prof?.created_at || null, grandfathered };
}

const out = {};

// (A) Conta REAL grandfathered: a instancia do carvalho.
const { data: inst } = await sb
  .from("wa_instances")
  .select("user_id, instance_name")
  .eq("instance_name", "whatsapp-carvalho-4yae")
  .maybeSingle();
out.carvalho_instance = inst ? { user_id: inst.user_id } : null;
if (inst?.user_id) out.carvalho_resolve = await resolveSource(inst.user_id);

// (B) Conta NOVA pos-corte: cria user de teste, empurra created_at pra depois do corte, resolve, limpa.
let testUserId = null;
try {
  const email = `byok-test-${Math.floor(Math.random() * 1e9)}@example.invalid`;
  const { data: created, error: cErr } = await sb.auth.admin.createUser({ email, email_confirm: true, password: "Tmp!" + Math.random().toString(36).slice(2) });
  if (cErr) throw cErr;
  testUserId = created.user.id;
  // garante linha em profiles com created_at POS-corte (se trigger ja criou, faz UPDATE; senao INSERT)
  const postCutoff = "2026-07-01T12:00:00Z";
  const { data: existing } = await sb.from("profiles").select("id").eq("id", testUserId).maybeSingle();
  if (existing) await sb.from("profiles").update({ created_at: postCutoff }).eq("id", testUserId);
  else await sb.from("profiles").insert({ id: testUserId, created_at: postCutoff });
  out.new_account_resolve = await resolveSource(testUserId);
} catch (e) {
  out.new_account_error = String(e?.message || e);
} finally {
  if (testUserId) {
    try { await sb.from("profiles").delete().eq("id", testUserId); } catch (_e) {}
    try { await sb.auth.admin.deleteUser(testUserId); } catch (_e) {}
    out.cleanup = "ok";
  }
}

console.log(JSON.stringify(out, null, 2));
