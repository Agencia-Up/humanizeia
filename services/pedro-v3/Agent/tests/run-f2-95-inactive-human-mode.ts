// ============================================================================
// F2.95 — Inbox/CRM humano com agente inativo e dedupe canônico da conversa.
//
// Contrato:
// 1) agente inativo não responde e não agenda follow-up automático;
// 2) o inbound durável continua visível e possui lead CRM pausado;
// 3) operação humana/manual continua permitida;
// 4) projeções órfã+instanciada do mesmo telefone convergem em uma conversa;
// 5) falhas/ambiguidade nunca viram HTTP 200 silencioso.
// ============================================================================
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  decideInactiveAgentHumanMode,
  ensureInactiveAgentHumanMode,
  type HumanOnlyInboundInput,
} from "../../../../supabase/functions/_shared/pedro-v2/humanOnlyInbound.ts";

let ok = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`OK  ${name}`);
    return;
  }
  fail += 1;
  failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
  console.error(`FALHA ${name}${detail ? ` :: ${detail}` : ""}`);
}

const inactiveAgent = {
  id: "agent-inactive",
  user_id: "tenant-1",
  is_active: false,
};

function inbound(overrides: Partial<HumanOnlyInboundInput> = {}): HumanOnlyInboundInput {
  return {
    persistResult: {
      status: "persisted",
      reason: "inserted",
      direction: "incoming",
      remote_message_id: "message-1",
    },
    linkedAgent: inactiveAgent,
    instanceId: "instance-1",
    phone: "5512999999999",
    ...overrides,
  };
}

console.log("\n=== F2.95 — inactive agent human-only mode ===\n");

// A. Pure decision: only a durable incoming on one inactive binding creates CRM.
{
  const persisted = decideInactiveAgentHumanMode(inbound());
  check("[A1] inbound persistido pede projeção humana", persisted.kind === "ensure");

  const deduped = decideInactiveAgentHumanMode(inbound({
    persistResult: {
      status: "deduped",
      reason: "already_exists",
      direction: "incoming",
    },
  }));
  check("[A2] retry idempotente também converge CRM", deduped.kind === "ensure");

  const active = decideInactiveAgentHumanMode(inbound({
    linkedAgent: { ...inactiveAgent, is_active: true },
  }));
  check("[A3] agente ativo não entra no caminho humano", active.kind === "skip" && active.reason === "agent_active");

  const unknownState = decideInactiveAgentHumanMode(inbound({
    linkedAgent: { ...inactiveAgent, is_active: null },
  }));
  check(
    "[A3a] estado ausente do agente falha fechado",
    unknownState.kind === "skip" && unknownState.reason === "agent_state_unknown",
  );

  const outgoing = decideInactiveAgentHumanMode(inbound({
    persistResult: {
      status: "persisted",
      reason: "inserted",
      direction: "outgoing",
    },
  }));
  check("[A4] mensagem enviada pela loja não cria lead", outgoing.kind === "skip" && outgoing.reason === "not_incoming");

  const skipped = decideInactiveAgentHumanMode(inbound({
    persistResult: { status: "skipped", reason: "group" },
  }));
  check("[A5] evento não persistido não cria CRM", skipped.kind === "skip");

  const noAgent = decideInactiveAgentHumanMode(inbound({ linkedAgent: null }));
  check("[A6] ausência de binding não adivinha agente", noAgent.kind === "skip" && noAgent.reason === "no_linked_agent");

  const missingIdentity = decideInactiveAgentHumanMode(inbound({ phone: "" }));
  check("[A7] identidade incompleta falha fechada", missingIdentity.kind === "skip" && missingIdentity.reason === "missing_identity");
}

// B. RPC boundary: success is explicit; errors/malformed/races request retry.
{
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const successDb = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: {
          ok: true,
          reason: "inactive_agent_human_mode",
          lead_id: "lead-1",
          conversation_id: "conversation-1",
          created: true,
        },
        error: null,
      };
    },
  };
  const success = await ensureInactiveAgentHumanMode(successDb, inbound());
  check("[B1] RPC correta é chamada uma vez", calls.length === 1 && calls[0]?.name === "ensure_inactive_agent_human_lead_v1");
  check("[B2] identidade canônica chega à RPC", calls[0]?.args.p_agent === "agent-inactive" && calls[0]?.args.p_instance === "instance-1");
  check("[B3] sucesso explícito retorna lead criado", success.ok && success.status === "ensured" && success.created && success.leadId === "lead-1");

  const rpcError = await ensureInactiveAgentHumanMode({
    rpc: async () => ({ data: null, error: { message: "database unavailable" } }),
  }, inbound());
  check("[B4] erro de banco não vira falso sucesso", !rpcError.ok && rpcError.reason === "rpc_error");

  const activeRace = await ensureInactiveAgentHumanMode({
    rpc: async () => ({ data: { ok: false, reason: "agent_active" }, error: null }),
  }, inbound());
  check("[B5] ativação concorrente força retry com snapshot novo", !activeRace.ok && activeRace.reason === "agent_active");

  const malformed = await ensureInactiveAgentHumanMode({
    rpc: async () => ({ data: null, error: null }),
  }, inbound());
  check("[B6] retorno malformado falha fechado", !malformed.ok && malformed.reason === "rpc_rejected");
}

const repoRoot = resolve(import.meta.dirname, "../../../..");
const webhookPath = join(repoRoot, "supabase/functions/pedro-webhook-v2/index.ts");
const helperPath = join(repoRoot, "supabase/functions/_shared/pedro-v2/humanOnlyInbound.ts");
const recoverPath = join(repoRoot, "supabase/functions/pedro-recover-dropped/index.ts");
const cronPath = join(repoRoot, "supabase/functions/cron-lead-followup/index.ts");
const inboxPath = join(repoRoot, "src/components/pedro/AgentInboxTab.tsx");
const pauseMigrationPath = join(repoRoot, "supabase/migrations/20260729150000_conversation_pause_projection.sql");
const migrationPath = join(repoRoot, "supabase/migrations/20260730230000_inactive_agent_human_mode_and_projection_dedupe.sql");

const webhook = readFileSync(webhookPath, "utf8");
const helper = readFileSync(helperPath, "utf8");
const recover = readFileSync(recoverPath, "utf8");
const cron = readFileSync(cronPath, "utf8");
const inbox = readFileSync(inboxPath, "utf8");
const pauseMigration = readFileSync(pauseMigrationPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");

// C. Gateway order and failure semantics.
{
  const persistAt = webhook.indexOf('persistTrack("pre_dispatch")');
  const ensureAt = webhook.indexOf("ensureInactiveAgentHumanMode(supabase");
  const selectAt = webhook.indexOf("const agent = selectActiveAgent", ensureAt);
  check("[C1] inbox é durável antes do CRM humano", persistAt >= 0 && persistAt < ensureAt);
  check("[C2] CRM humano nasce antes da seleção de IA", ensureAt >= 0 && ensureAt < selectAt);
  check("[C3] lookup de agentes falho retorna 5xx", webhook.includes('error: "agent_lookup_failed"') && /agent_lookup_failed[\s\S]{0,500}\}, 500\)/.test(webhook));
  check("[C4] binding duplicado retorna 5xx", webhook.includes('error: "ambiguous_agent_binding"') && /ambiguous_agent_binding[\s\S]{0,500}\}, 500\)/.test(webhook));
  check("[C5] binding não usa find arbitrário", webhook.includes("linkedAgents.length === 1") && webhook.includes("linkedAgentBindingAmbiguous"));
}

// D. Human mode has no conversational or automation imports.
{
  const imports = [...helper.matchAll(/^import\s+.+$/gm)].map((match) => match[0]);
  check("[D1] helper só depende do resultado de persistência", imports.length === 1 && imports[0]?.includes("persistPrivateInbound"));
  check("[D2] helper não importa cérebro/remetente/follow-up", !imports.some((line) => /(orchestrator|Sender|followup|transfer)/i.test(line)));
  check("[D3] recovery legado ignora agente inativo", recover.includes('result.skipped.push("agent_inactive")') && recover.includes("agent.is_active !== true"));
  check("[D4] cron legado filtra conversa pausada", cron.includes(".eq('ai_paused', false)"));
  check("[D5] cron legado exige agente ativo", cron.includes("agentData?.is_active !== true"));
  check("[D6] UI usa atendimento_manual como autoridade", inbox.includes("!!r.atendimento_manual"));
  check(
    "[D7] cron v3-only nÃ£o escreve em acumulador inexistente",
    !cron.includes('result.skipped.push("pedro_v2_followup_disabled_v3_only")'),
  );
}

// E. Database contract: AI blocked, manual allowed, dedupe and CRM are idempotent.
{
  check("[E1] gate bloqueia agente inativo para IA", /v_agent_active[\s\S]+reason', 'agent_inactive'/m.test(pauseMigration));
  check("[E2] gate mantém ações humanas", pauseMigration.includes("manual_message") && pauseMigration.includes("manual_transfer") && pauseMigration.includes("seller_ack"));
  check("[E3] RPC humana é restrita a service_role", migration.includes("REVOKE ALL ON FUNCTION public.ensure_inactive_agent_human_lead_v1") && migration.includes("GRANT EXECUTE ON FUNCTION public.ensure_inactive_agent_human_lead_v1") && migration.includes("TO service_role"));
  check(
    "[E4] RPC exclui linha de vendedor",
    /SELECT\s+i\.seller_member_id[\s\S]+IF\s+v_seller\s+IS\s+NOT\s+NULL\s+THEN[\s\S]+reason',\s*'seller_instance'/m.test(migration),
  );
  check("[E5] lead humano nasce pausado e sem próximo follow-up", /ai_paused[\s\S]+followup_5min_sent[\s\S]+next_followup_at/m.test(migration) && migration.includes("true, NULL"));
  check("[E6] projeção reconhece instance_ids", migration.includes("ANY(coalesce(a.instance_ids, '{}'::uuid[]))"));
  check("[E7] null+instância conhecida converge só quando inequívoca", migration.includes("v_known_count <> 1") && migration.includes("ai_conv_index_adopt_instance"));
  check("[E8] merge não soma eventos duplicados", /message_count\s*=\s*greatest\([\s\S]{0,180}v_orphan\.message_count/m.test(migration) && !migration.includes("w.message_count + v_orphan.message_count"));
  check("[E9] timestamps nunca persistem -infinity no CRM", !/last_(?:interaction|user_reply)_at\s*=\s*greatest\(\s*coalesce\([^)]+'-infinity'/m.test(migration));
  check("[E10] existe uma única definição da RPC", (migration.match(/CREATE OR REPLACE FUNCTION public\.ensure_inactive_agent_human_lead_v1/gi) ?? []).length === 1);
  check(
    "[E11] vínculo Pedro órfão pode convergir sem sobrescrever CRM vivo",
    /c\.crm_source\s*=\s*'pedro'[\s\S]{0,260}NOT EXISTS[\s\S]{0,260}old_lead\.id\s*=\s*c\.crm_lead_id/m.test(migration),
  );
  check(
    "[E12] RPC não retorna sucesso se a projeção recusou o vínculo",
    migration.includes("GET DIAGNOSTICS v_projection_updated = ROW_COUNT")
      && migration.includes("'projection_crm_conflict'"),
  );
  check(
    "[E13] estado nulo do agente não é tratado como inativo",
    migration.includes("v_agent_active IS DISTINCT FROM false")
      && migration.includes("'agent_state_unknown'"),
  );
}

// F. Edge files remain syntactically valid after wiring.
{
  for (const [name, source] of [
    ["webhook", webhook],
    ["helper", helper],
    ["recover", recover],
  ] as const) {
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: `${name}.ts`,
      reportDiagnostics: true,
    });
    const errors = (transpiled.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    check(`[F-${name}] TypeScript sintaticamente válido`, errors.length === 0, JSON.stringify(errors));
  }
}

console.log(`\nF2.95: ${ok} OK / ${fail} FALHA\n`);
if (fail > 0) {
  for (const item of failures) console.error(` - ${item}`);
  process.exit(1);
}
