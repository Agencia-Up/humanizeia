import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

let ok = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, pass: boolean, detail = ""): void {
  if (pass) {
    ok += 1;
    console.log(`  OK  ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    console.error(`  FALHA  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function syntaxOk(source: string, fileName: string): boolean {
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName,
    reportDiagnostics: true,
  });
  return !(result.diagnostics ?? []).some((item) => item.category === ts.DiagnosticCategory.Error);
}

console.log("\n=== F2.97 — fila local durável do primeiro ingresso v3 ===\n");

const repoRoot = resolve(import.meta.dirname, "../../../..");
const webhookPath = join(repoRoot, "supabase/functions/pedro-webhook-v2/index.ts");
const workerPath = join(repoRoot, "supabase/functions/pedro-v3-ingress-replay/index.ts");
const migrationPath = join(repoRoot, "supabase/migrations/20260805140000_pedro_v3_durable_ingress_queue.sql");
const webhook = readFileSync(webhookPath, "utf8");
const worker = readFileSync(workerPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");

// A. O ACK local precede qualquer rede externa.
{
  const enqueueAt = webhook.indexOf('"pedro_v3_enqueue_ingress_v1"');
  const bridgeAt = webhook.indexOf("const callBridge", enqueueAt);
  const callAt = webhook.indexOf("bridgePedroV3BeforeAck", bridgeAt);
  check("[A1] enqueue local existe", enqueueAt >= 0);
  check("[A2] enqueue ocorre antes de chamar o bridge", enqueueAt >= 0 && enqueueAt < bridgeAt && bridgeAt < callAt);
  check("[A3] falha do enqueue local continua 5xx", /v3_local_ingress_enqueue_failed[\s\S]{0,180}\}, 503\)/.test(webhook));
  check("[A4] timeout externo vira 202 enfileirado", webhook.includes('reason: "v3_ingress_queued_for_replay"') && /v3_ingress_queued_for_replay[\s\S]{0,240}\}, 202\)/.test(webhook));
  check("[A5] sucesso confirma a fila local", webhook.includes('"pedro_v3_mark_ingress_delivered_v1"'));
}

// B. CRM e fila nascem atomicamente e convergem com a identidade real do v3.
{
  const fnStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.pedro_v3_enqueue_ingress_v1");
  const fnEnd = migration.indexOf("REVOKE ALL ON FUNCTION public.pedro_v3_enqueue_ingress_v1", fnStart);
  const enqueueFn = migration.slice(fnStart, fnEnd);
  check("[B1] tabela tem event_id como PK", /event_id text PRIMARY KEY/i.test(migration));
  check("[B2] payload e identidade possuem constraint cruzada", migration.includes("pedro_v3_ingress_queue_identity_ck") && migration.includes("payload->>'eventId' = event_id"));
  check("[B3] CRM mínimo usa a unique canônica", enqueueFn.includes("ON CONFLICT (agent_id, remote_jid) DO NOTHING"));
  check("[B4] CRM nasce antes da fila na mesma função", enqueueFn.indexOf("INSERT INTO public.ai_crm_leads") < enqueueFn.indexOf("INSERT INTO public.pedro_v3_ingress_queue"));
  check("[B5] fila e RPCs não são expostas ao cliente", migration.includes("ENABLE ROW LEVEL SECURITY") && migration.includes("FROM PUBLIC, anon, authenticated"));
  check("[B6] instância de vendedor e binding incorreto falham fechados", enqueueFn.includes("seller_instance") && enqueueFn.includes("agent_not_bound_to_instance"));
}

// C. Replay concorrente, sem abandono e obediente à pausa atual.
{
  check("[C1] claim usa SKIP LOCKED", /FOR UPDATE SKIP LOCKED/i.test(migration));
  check("[C2] lease travado pode ser retomado", migration.includes("processing_started_at < p_now - interval '5 minutes'"));
  check("[C3] falha volta para pending com backoff", migration.includes("ELSE 'pending'") && migration.includes("make_interval(secs => v_delay)"));
  check("[C4] não existe estado dead que abandone lead", !/status IN \([^)]*dead/i.test(migration));
  check("[C5] cron roda a cada minuto", migration.includes("'pedro-v3-ingress-replay-1min'") && migration.includes("'* * * * *'"));
  check("[C6] worker revalida pausa/agente antes do bridge", worker.indexOf('"is_ai_automation_allowed_v2"') < worker.indexOf("const bridge = await callPedroV3Bridge"));
  check("[C7] bloqueio humano cancela replay tardio", worker.includes('settle("cancelled"') && worker.includes("automation_blocked:"));
  check("[C8] falha externa é reprogramada", worker.includes('settle("retry"') && worker.includes("bridge.serviceStatus"));
  check("[C9] replay usa o lead real no gate de pausa", worker.includes("p_lead_id: row.lead_id"));
  check("[C10] lote é pequeno e concorrente para caber no cron", worker.includes("p_limit: 5") && worker.includes("Promise.all(rows.map"));
}

// D. Auth e sintaxe dos dois entrypoints.
{
  check("[D1] worker exige service_role exata", worker.includes("bearer(req) !== serviceRoleKey"));
  check("[D2] webhook compila", syntaxOk(webhook, webhookPath));
  check("[D3] worker compila", syntaxOk(worker, workerPath));
}

console.log(`\nF2.97: ${ok} OK / ${fail} FALHA\n`);
if (fail > 0) {
  for (const item of failures) console.error(` - ${item}`);
  process.exit(1);
}
