import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

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

const productionEnv = readEnv(path.join(root, ".env"));
const stagingEnv = {
  ...readEnv(path.join(root, ".env.staging.local")),
  ...readEnv(path.join(root, "supabase", ".env.staging.keys.local")),
};

const source = {
  name: "production",
  url: productionEnv.SUPABASE_URL || productionEnv.VITE_SUPABASE_URL,
  key: productionEnv.SUPABASE_SERVICE_ROLE_KEY,
};

const target = {
  name: "staging",
  url: stagingEnv.SUPABASE_URL || stagingEnv.VITE_SUPABASE_URL,
  key: stagingEnv.SUPABASE_SERVICE_ROLE_KEY,
};

for (const cfg of [source, target]) {
  if (!cfg.url || !cfg.key) {
    throw new Error(`Missing Supabase URL/service key for ${cfg.name}.`);
  }
}

const dangerousRuntimeTables = new Set([
  "followup_queue",
  "wa_queue",
  "rule_execution_log",
  "agent_executions",
  "orchestrator_tasks",
  "notifications",
  "meta_capi_batches",
  "meta_capi_events",
]);

const clearTargetBeforeCopy = new Set([
  "crm_pipeline_stages",
  "crm_leads",
  "jose_segment_profiles",
]);

const tables = [
  "organizations",
  "profiles",
  "organization_members",
  "organization_invites",
  "user_subscriptions",
  "token_transactions",
  "pme_config",
  "platform_integrations",
  "connected_accounts",
  "ad_accounts",
  "meta_pixels",
  "whatsapp_config",
  "whatsapp_destinatarios",
  "report_templates",
  "report_template_destinatarios",
  "crm_pipeline_stages",
  "crm_leads",
  "crm_activities",
  "wa_contact_lists",
  "wa_contacts",
  "wa_instances",
  "wa_ai_agents",
  "ai_team_members",
  "quick_messages",
  "agent_knowledge",
  "knowledge_bases",
  "knowledge_sources",
  "knowledge_chunks",
  "agent_knowledge_bases",
  "ai_crm_leads",
  "ai_lead_transfers",
  "pedro_crm_notes",
  "pedro_manager_feedback",
  "pedro_followup_schedules",
  "wa_chat_history",
  "wa_campaigns",
  "wa_inbox",
  "wa_automations",
  "wa_audit_logs",
  "wa_tags",
  "capture_forms",
  "capture_form_submissions",
  "followup_sequences",
  "followup_sequence_steps",
  "campaigns",
  "campaign_metrics",
  "copies",
  "copy_formulas",
  "copy_performance",
  "creatives",
  "creative_uploads",
  "creative_performance",
  "creative_ab_tests",
  "creative_copy_pairs",
  "creative_selection_log",
  "ad_copies",
  "ab_tests",
  "ab_test_variants",
  "ai_insights",
  "ai_learnings",
  "apollo_cron_config",
  "apollo_benchmarks",
  "apollo_learning",
  "apollo_sessions",
  "apollo_metric_snapshots",
  "apollo_health_scores",
  "apollo_diagnostics",
  "apollo_alerts",
  "apollo_recommendations",
  "apollo_action_log",
  "apollo_action_outcomes",
  "audiences",
  "automation_rules",
  "client_briefings",
  "email_drafts",
  "funnel_flows",
  "geo_performance",
  "historico_reports",
  "jose_segment_profiles",
  "lead_interactions",
  "leads",
  "meta_cache",
  "paulo_carousels",
  "sales_data",
  "saved_reports",
  "shopify_daily_metrics",
  "shopify_orders",
  "social_posts",
  "strategy_plans",
  "swipe_files",
  "training_sections",
  "training_videos",
  "user_quiz_responses",
].filter((table) => !dangerousRuntimeTables.has(table));

const pageSize = 1000;

function endpoint(baseUrl, table, query = "") {
  return `${baseUrl.replace(/\/$/, "")}/rest/v1/${table}${query}`;
}

function headers(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw body.
  }
  if (!res.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return { res, body };
}

async function tableExists(cfg, table) {
  const url = endpoint(cfg.url, table, "?select=*&limit=1");
  const res = await fetch(url, { headers: headers(cfg.key) });
  return res.ok;
}

async function fetchRows(table) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const url = endpoint(source.url, table, "?select=*");
    const { body } = await request(url, {
      headers: headers(source.key, {
        Range: `${from}-${to}`,
        Prefer: "count=exact",
      }),
    });
    rows.push(...body);
    if (!Array.isArray(body) || body.length < pageSize) break;
  }
  return rows;
}

async function upsertRows(table, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += pageSize) {
    const chunk = rows.slice(i, i + pageSize);
    await request(endpoint(target.url, table), {
      method: "POST",
      headers: headers(target.key, {
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify(chunk),
    });
  }
}

async function clearTargetTable(table) {
  await request(endpoint(target.url, table, "?id=not.is.null"), {
    method: "DELETE",
    headers: headers(target.key, {
      Prefer: "return=minimal",
    }),
  });
}

const results = [];

for (const table of tables) {
  const sourceExists = await tableExists(source, table);
  const targetExists = await tableExists(target, table);
  if (!sourceExists || !targetExists) {
    results.push({ table, status: "skipped", rows: 0, reason: "missing table" });
    continue;
  }

  try {
    if (clearTargetBeforeCopy.has(table)) {
      await clearTargetTable(table);
    }
    const rows = await fetchRows(table);
    await upsertRows(table, rows);
    results.push({ table, status: "ok", rows: rows.length });
    console.log(`${table}: ${rows.length}`);
  } catch (error) {
    results.push({ table, status: "error", rows: 0, reason: error.message });
    console.error(`${table}: ERROR ${error.message}`);
  }
}

const failed = results.filter((r) => r.status === "error");
const skipped = results.filter((r) => r.status === "skipped");
const copied = results
  .filter((r) => r.status === "ok")
  .reduce((total, r) => total + r.rows, 0);

console.log(JSON.stringify({ copied, failed, skipped }, null, 2));

if (failed.length) {
  process.exitCode = 1;
}
