import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-06-27T12:00:00.000Z";
const CONVERSATION = "wa:test:5511999999999";
const AGENT = "agent-test";
const TURN = "turn-1";
const EFFECT = `${TURN}:message`;

let ok = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`  RED ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function expectReject(name: string, fn: () => Promise<unknown>, contains: string): Promise<void> {
  try {
    await fn();
    check(name, false, "operacao deveria falhar");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, message.includes(contains), message);
  }
}

function state(version: number, stage = "greeting") {
  return {
    schemaVersion: 1,
    version,
    conversationId: CONVERSATION,
    tenantId: TENANT,
    agentId: AGENT,
    leadId: "lead-test",
    turnNumber: 1,
    stage,
    currentObjective: null,
    plannedObjectives: [],
    slots: {},
    vehicleContext: { focus: null },
    offers: { last: null, presentedKeys: [] },
    photoLedger: { sentByVehicle: {} },
    rejected: { modelos: [] },
    recentTurns: [],
    appliedEffectIds: version > 1 ? [EFFECT] : [],
    updatedAt: NOW,
  };
}

const decision = {
  turnId: TURN,
  action: "collect_slot",
  reasonCode: "test_collect",
  reasonSummary: "Coletar dado do funil",
  confidence: 0.95,
  decisionMutations: [],
  effectPlan: [],
  responsePlan: { guidance: "Perguntar pagamento" },
  policyChecks: [],
};

const events = [{
  eventId: `${TURN}:decision`,
  conversationId: CONVERSATION,
  turnId: TURN,
  type: "decision_final",
  payloadSchemaVersion: 1,
  payload: { __redacted: true, action: "collect_slot" },
  at: NOW,
}];

const outbox = [{
  effectId: EFFECT,
  idempotencyKey: EFFECT,
  conversationId: CONVERSATION,
  turnId: TURN,
  planId: "message",
  kind: "send_message",
  payload: { __redacted: true, text: "Qual parcela fica confortavel?" },
  onSuccess: [{ op: "advance_stage", effectId: EFFECT, stage: "discovery" }],
  order: 1,
  dependsOn: [],
  providerCapability: "queryable",
  createdAt: NOW,
}];

async function main(): Promise<void> {
  console.log("\n=== PEDRO V3 SQL SCHEMA ===");
  const db = new PGlite();

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
      language sql stable as $$ select null::uuid $$;
  `);

  const schemaUrl = new URL("../../Brain/sql/v3_schema.sql", import.meta.url);
  const schemaSql = await readFile(schemaUrl, "utf8");
  await db.exec(schemaSql);
  check("schema executa integralmente em PostgreSQL", true);

  const outboxPatchUrl = new URL("../../Brain/sql/v3_f2_5_1_outbox_patch.sql", import.meta.url);
  const outboxPatchSql = await readFile(outboxPatchUrl, "utf8");
  await db.exec(outboxPatchSql);
  check("patch F2.5.1 executa integralmente em PostgreSQL", true);
  const receiptPatchUrl = new URL("../../Brain/sql/v3_f2_6h_receipt_patch.sql", import.meta.url);
  const receiptPatchSql = await readFile(receiptPatchUrl, "utf8");
  await db.exec(receiptPatchSql);
  check("patch F2.6H executa integralmente em PostgreSQL", true);

  // F2.7.4-A: aplica a migration accepted-safe (helper + coluna gerada + check + RPC) — prova que o SQL
  // do patch executa de verdade (incl. os ALTER de coluna gerada/check) sobre o schema.
  const f274PatchUrl = new URL("../../Brain/sql/v3_f2_7_4_accepted_safe_memory_patch.sql", import.meta.url);
  const f274PatchSql = await readFile(f274PatchUrl, "utf8");
  await db.exec(f274PatchSql);
  check("patch F2.7.4-A executa integralmente em PostgreSQL", true);

  // F2.7.4-A: a FONTE UNICA (v3_required_receipt_level) — usada pela coluna gerada, pelo check e pelo RPC.
  const reqLevel = async (kind: string, onSuccess: unknown[]): Promise<string> => {
    const r = await db.query<{ r: string }>(
      `select public.v3_required_receipt_level($1, $2::jsonb) as r`,
      [kind, JSON.stringify(onSuccess)],
    );
    return r.rows[0].r;
  };
  check("F2.7.4-A send_message + [append_assistant_turn] -> accepted", await reqLevel("send_message", [{ op: "append_assistant_turn" }]) === "accepted");
  check("F2.7.4-A send_message + [] -> accepted", await reqLevel("send_message", []) === "accepted");
  check("F2.7.4-A send_message + 2x append_assistant_turn -> accepted", await reqLevel("send_message", [{ op: "append_assistant_turn" }, { op: "append_assistant_turn" }]) === "accepted");
  check("F2.7.4-A send_message + mark_message_delivered -> delivered", await reqLevel("send_message", [{ op: "append_assistant_turn" }, { op: "mark_message_delivered" }]) === "delivered");
  check("F2.7.4-A send_message + activate_objective -> delivered", await reqLevel("send_message", [{ op: "activate_objective" }]) === "delivered");
  check("F2.7.4-A send_message + record_offer -> delivered", await reqLevel("send_message", [{ op: "record_offer" }]) === "delivered");
  check("F2.7.4-A send_message + set_presented_vehicle_focus -> delivered", await reqLevel("send_message", [{ op: "set_presented_vehicle_focus" }]) === "delivered");
  check("F2.7.4-A send_media -> delivered", await reqLevel("send_media", []) === "delivered");
  check("F2.7.4-A send_media + append_assistant_turn -> delivered (kind manda)", await reqLevel("send_media", [{ op: "append_assistant_turn" }]) === "delivered");
  check("F2.7.4-A crm_write -> delivered", await reqLevel("crm_write", []) === "delivered");
  check("F2.7.4-A schedule_visit -> delivered", await reqLevel("schedule_visit", []) === "delivered");
  check("F2.7.4-A handoff -> delivered", await reqLevel("handoff", []) === "delivered");
  check("F2.7.4-A notify_seller -> delivered", await reqLevel("notify_seller", []) === "delivered");

  // F2.7.4-A check `v3_outbox_applied_only_after_delivery_ck`: outcome_applied_at com receipt_level='accepted'
  // SOMENTE no caso accepted-safe. (sem FK em conversation_id; tenant proprio p/ nao colidir com TENANT abaixo)
  const T2 = "22222222-2222-2222-2222-222222222222";
  await db.query("insert into auth.users(id) values ($1::uuid) on conflict do nothing", [T2]);
  const insOutbox = (id: string, kind: string, onSuccess: unknown[]) => db.query(
    `insert into public.v3_effect_outbox
       (effect_id, idempotency_key, tenant_id, conversation_id, turn_id, plan_id, kind, payload, on_success,
        effect_order, status, receipt_level, outcome_applied_at, terminal_at)
     values ($3, $3, $1::uuid, 'wa:f274ck', $4, 'p', $5, '{"__redacted":true,"text":"oi"}'::jsonb,
        $6::jsonb, 0, 'succeeded', 'accepted', $2::timestamptz, $2::timestamptz)`,
    [T2, NOW, `${id}:p`, id, kind, JSON.stringify(onSuccess)],
  );
  await insOutbox("f274ok", "send_message", [{ op: "append_assistant_turn" }]);
  check("F2.7.4-A check ACEITA outcome_applied em accepted no caso accepted-safe", true);
  await expectReject("F2.7.4-A check REJEITA accepted+outcome com mark_message_delivered",
    () => insOutbox("f274bad1", "send_message", [{ op: "append_assistant_turn" }, { op: "mark_message_delivered" }]),
    "v3_outbox_applied_only_after_delivery_ck");
  await expectReject("F2.7.4-A check REJEITA accepted+outcome com activate_objective",
    () => insOutbox("f274bad2", "send_message", [{ op: "activate_objective" }]),
    "v3_outbox_applied_only_after_delivery_ck");
  await expectReject("F2.7.4-A check REJEITA send_media avancar so por accepted",
    () => insOutbox("f274bad3", "send_media", [{ op: "mark_photos_sent" }]),
    "v3_outbox_applied_only_after_delivery_ck");
  await expectReject("F2.7.4-A check REJEITA crm_write avancar so por accepted",
    () => insOutbox("f274bad4", "crm_write", [{ op: "advance_stage" }]),
    "v3_outbox_applied_only_after_delivery_ck");
  await expectReject("F2.7.4-A check REJEITA handoff avancar so por accepted",
    () => insOutbox("f274bad5", "handoff", [{ op: "mark_handoff_completed" }]),
    "v3_outbox_applied_only_after_delivery_ck");

  // F2.7.4-A RPC v3_commit_effect_outcome: accepted-safe APLICA em accepted (caso 7) + idempotente (caso 8) +
  // delivered POSTERIOR atualiza receipt sem reaplicar/duplicar (caso 7). Estado proprio sob T2.
  await db.query(
    `insert into public.v3_conversation_state (conversation_id, tenant_id, agent_id, schema_version, version, state)
     values ('wa:f274rpc', $1::uuid, 'agent-x', 1, 0,
       jsonb_build_object('conversationId','wa:f274rpc','tenantId',$1::text,'agentId','agent-x',
         'schemaVersion',1,'version',0,'recentTurns','[]'::jsonb))`,
    [T2],
  );
  await db.query(
    `insert into public.v3_effect_outbox
       (effect_id, idempotency_key, tenant_id, conversation_id, turn_id, plan_id, kind, payload, on_success,
        effect_order, status, receipt_level)
     values ('f274rpc:p','f274rpc:p',$1::uuid,'wa:f274rpc','f274rpc','p','send_message',
        '{"__redacted":true,"text":"oi"}'::jsonb,'[{"op":"append_assistant_turn"}]'::jsonb,0,'succeeded','accepted')`,
    [T2],
  );
  const nextState = JSON.stringify({ schemaVersion: 1, recentTurns: [{ role: "agent", text: "oi", at: NOW }] });
  const rpc1 = await db.query<{ state_version: bigint; applied: boolean }>(
    `select * from public.v3_commit_effect_outcome($1::uuid,'wa:f274rpc','f274rpc:p',0,$2::jsonb,$3::timestamptz)`,
    [T2, nextState, NOW],
  );
  check("F2.7.4-A RPC aplica append_assistant_turn em ACCEPTED (caso 7)", rpc1.rows[0].applied === true && Number(rpc1.rows[0].state_version) === 1, JSON.stringify(rpc1.rows[0]));
  const rpc2 = await db.query<{ applied: boolean }>(
    `select * from public.v3_commit_effect_outcome($1::uuid,'wa:f274rpc','f274rpc:p',1,$2::jsonb,$3::timestamptz)`,
    [T2, nextState, NOW],
  );
  check("F2.7.4-A RPC outcome ja aplicado e idempotente (caso 8)", rpc2.rows[0].applied === false);
  await db.query(
    `select public.v3_record_outbox_result($1::uuid,'f274rpc:p',null,'succeeded','delivered',$2::jsonb,null,false,null,'[]'::jsonb,$3::timestamptz)`,
    [T2, JSON.stringify({ providerMessageId: "rpc-1", delivered: true }), NOW],
  );
  const rpc3 = await db.query<{ applied: boolean }>(
    `select * from public.v3_commit_effect_outcome($1::uuid,'wa:f274rpc','f274rpc:p',1,$2::jsonb,$3::timestamptz)`,
    [T2, nextState, NOW],
  );
  const finalRpc = await db.query<{ receipt_level: string; outcome_applied_at: string | null; version: bigint }>(
    `select o.receipt_level, o.outcome_applied_at, s.version
     from public.v3_effect_outbox o join public.v3_conversation_state s on s.conversation_id = o.conversation_id
     where o.effect_id = 'f274rpc:p'`,
  );
  check("F2.7.4-A delivered POSTERIOR atualiza receipt sem reaplicar (caso 7)",
    rpc3.rows[0].applied === false
      && finalRpc.rows[0].receipt_level === "delivered"
      && finalRpc.rows[0].outcome_applied_at !== null
      && Number(finalRpc.rows[0].version) === 1,
    JSON.stringify(finalRpc.rows[0]));

  await db.query("insert into auth.users(id) values ($1::uuid)", [TENANT]);

  const tableResult = await db.query<{ count: number }>(`
    select count(*)::int as count
    from pg_tables
    where schemaname = 'public' and tablename like 'v3\\_%' escape '\\'
  `);
  check("12 tabelas v3 criadas", tableResult.rows[0].count === 12, String(tableResult.rows[0].count));

  const firstIngest = await db.query<{ inserted: boolean }>(`
    select public.v3_ingest_inbox($1::uuid, 'evt-1', $2, $3::jsonb, $4::timestamptz) as inserted
  `, [TENANT, CONVERSATION, JSON.stringify({ __redacted: true, text: "Oi" }), NOW]);
  const duplicateIngest = await db.query<{ inserted: boolean }>(`
    select public.v3_ingest_inbox($1::uuid, 'evt-1', $2, $3::jsonb, $4::timestamptz) as inserted
  `, [TENANT, CONVERSATION, JSON.stringify({ __redacted: true, text: "Oi repetido" }), NOW]);
  check("inbox INSERT e o dedupe atomico", firstIngest.rows[0].inserted && !duplicateIngest.rows[0].inserted);

  await expectReject("inbox rejeita payload nao redigido", () => db.query(`
    select public.v3_ingest_inbox($1::uuid, 'evt-secret', $2, '{"text":"123"}'::jsonb, $3::timestamptz)
  `, [TENANT, CONVERSATION, NOW]), "v3_inbox_payload_not_redacted");
  await expectReject("redaction rejeita CPF mesmo com marcador forjado", () => db.query(`
    select public.v3_ingest_inbox(
      $1::uuid, 'evt-cpf', $2,
      '{"__redacted":true,"text":"123.456.789-09"}'::jsonb,
      $3::timestamptz
    )
  `, [TENANT, CONVERSATION, NOW]), "v3_inbox_payload_not_redacted");

  // F2.6P: o payload do evento turn_claimed inclui os event_ids (hashes hex de 64 chars). Um hash com
  // 11 digitos seguidos (ex.: "...f77842555836c...") NAO pode ser falso-positivo de CPF (o que barrava
  // o commit). Mas CPF real (formatado OU cru, cercado por borda de palavra) tem de continuar barrado.
  const hashPayload = '{"eventIds":["uazapi:b265f614176af61086d5a75e46f77842555836c15a047f76a8a3b90c2f4699c8"],"__redacted":true}';
  const redHash = await db.query<{ ok: boolean }>(`select public.v3_payload_is_redacted($1::jsonb) as ok`, [hashPayload]);
  check("F2.6P: turn_claimed com hash de 11 digitos passa na redaction", redHash.rows[0]?.ok === true);
  const redFmt = await db.query<{ ok: boolean }>(`select public.v3_payload_is_redacted('{"__redacted":true,"text":"meu cpf 123.456.789-00"}'::jsonb) as ok`);
  check("F2.6P: CPF formatado AINDA e barrado", redFmt.rows[0]?.ok === false);
  const redBare = await db.query<{ ok: boolean }>(`select public.v3_payload_is_redacted('{"__redacted":true,"text":"cpf 12345678900 fim"}'::jsonb) as ok`);
  check("F2.6P: CPF cru (11 digitos isolados) AINDA e barrado", redBare.rows[0]?.ok === false);

  const lease = await db.query<{ token: string }>(`
    select token from public.v3_acquire_lease($1::uuid, $2, 'worker-1', 120000, $3::timestamptz)
  `, [TENANT, CONVERSATION, NOW]);
  check("lease adquirido", lease.rows.length === 1 && lease.rows[0].token.length > 10);
  const leaseToken = lease.rows[0].token;

  const secondLease = await db.query<{ token: string }>(`
    select token from public.v3_acquire_lease($1::uuid, $2, 'worker-2', 120000, $3::timestamptz)
  `, [TENANT, CONVERSATION, NOW]);
  check("segundo worker nao toma lease vigente", secondLease.rows.length === 0);

  const claimed = await db.query<{ ids: string[] }>(`
    select public.v3_claim_inbox_burst(
      $1::uuid, $2, $3::timestamptz, 'worker-1', $4, $5,
      interval '2 minutes', 50, $3::timestamptz
    ) as ids
  `, [TENANT, CONVERSATION, NOW, TURN, leaseToken]);
  check("claim atomico respeita lease", claimed.rows[0].ids.length === 1 && claimed.rows[0].ids[0] === "evt-1");

  const commit = await db.query<{ version: bigint }>(`
    select public.v3_commit_turn(
      $1::uuid, $2, $3, 'lead-test', $4, 0,
      $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
      array['evt-1']::text[], 'worker-1', $9, $10::timestamptz
    ) as version
  `, [
    TENANT, CONVERSATION, AGENT, TURN,
    JSON.stringify(state(0)), JSON.stringify(decision), JSON.stringify(events), JSON.stringify(outbox),
    leaseToken, NOW,
  ]);
  check("commit do turno cria versao 1", Number(commit.rows[0].version) === 1);

  const atomic = await db.query<{ version: bigint; inbox_status: string; decisions: number; outbox: number; history: number }>(`
    select
      s.version,
      i.status as inbox_status,
      (select count(*)::int from public.v3_decisions where turn_id = $2) as decisions,
      (select count(*)::int from public.v3_effect_outbox where turn_id = $2) as outbox,
      (select count(*)::int from public.v3_state_history where conversation_id = $1) as history
    from public.v3_conversation_state s
    join public.v3_inbox i on i.event_id = 'evt-1'
    where s.conversation_id = $1
  `, [CONVERSATION, TURN]);
  check(
    "CAS + state/history/decision/outbox/inbox sao atomicos",
    Number(atomic.rows[0].version) === 1
      && atomic.rows[0].inbox_status === "done"
      && atomic.rows[0].decisions === 1
      && atomic.rows[0].outbox === 1
      && atomic.rows[0].history === 1,
    JSON.stringify(atomic.rows[0]),
  );

  const claimedOutbox = await db.query<{ processing_token: string; status: string }>(`
    select processing_token, status
    from public.v3_claim_outbox('dispatcher-1', interval '1 minute', 10, $1::timestamptz)
  `, [NOW]);
  check("outbox claim usa processing token", claimedOutbox.rows.length === 1 && claimedOutbox.rows[0].status === "processing");
  const processingToken = claimedOutbox.rows[0].processing_token;

  await db.query(`
    select public.v3_record_outbox_result(
      $1::uuid, $2, $3, 'succeeded', 'accepted', $4::jsonb,
      null, false, null, '[]'::jsonb, $5::timestamptz
    )
  `, [TENANT, EFFECT, processingToken, JSON.stringify({ providerMessageId: "msg-1" }), NOW]);
  const accepted = await db.query<{ status: string; receipt_level: string; outcome_applied_at: string | null; terminal_at: string | null }>(`
    select status, receipt_level, outcome_applied_at, terminal_at
    from public.v3_effect_outbox where effect_id = $1
  `, [EFFECT]);
  check(
    "accepted critico nao avanca memoria nem terminaliza",
    accepted.rows[0].status === "succeeded"
      && accepted.rows[0].receipt_level === "accepted"
      && accepted.rows[0].outcome_applied_at === null
      && accepted.rows[0].terminal_at === null,
  );
  const locatedByProvider = await db.query<{ effect_id: string }>(`
    select effect_id from public.v3_find_outbox_by_provider_message_id($1::uuid, $2)
  `, [TENANT, "msg-1"]);
  const crossTenantProvider = await db.query<{ effect_id: string }>(`
    select effect_id from public.v3_find_outbox_by_provider_message_id($1::uuid, $2)
  `, ["22222222-2222-4222-8222-222222222222", "msg-1"]);
  check("providerMessageId localiza um unico outbox do tenant", locatedByProvider.rows.length === 1 && locatedByProvider.rows[0].effect_id === EFFECT);
  check("providerMessageId nunca cruza tenant", crossTenantProvider.rows.length === 0);
  await expectReject("providerMessageId vazio falha fechado", () => db.query(`
    select effect_id from public.v3_find_outbox_by_provider_message_id($1::uuid, '')
  `, [TENANT]), "v3_provider_message_id_invalid");

  await db.query(`
    select public.v3_record_outbox_result(
      $1::uuid, $2, null, 'succeeded', 'delivered', $3::jsonb,
      null, false, null, '[]'::jsonb, $4::timestamptz
    )
  `, [TENANT, EFFECT, JSON.stringify({ providerMessageId: "msg-1", delivered: true }), NOW]);
  const beforeOutcome = await db.query<{ version: bigint; outcome_applied_at: string | null }>(`
    select s.version, o.outcome_applied_at
    from public.v3_conversation_state s
    join public.v3_effect_outbox o on o.conversation_id = s.conversation_id
    where o.effect_id = $1
  `, [EFFECT]);
  check("delivered recebido, mas reducer ainda nao aplicado", Number(beforeOutcome.rows[0].version) === 1 && beforeOutcome.rows[0].outcome_applied_at === null);

  const outcome = await db.query<{ state_version: bigint; applied: boolean }>(`
    select * from public.v3_commit_effect_outcome(
      $1::uuid, $2, $3, 1, $4::jsonb, $5::timestamptz
    )
  `, [TENANT, CONVERSATION, EFFECT, JSON.stringify(state(1, "discovery")), NOW]);
  check("EffectOutcomeCommit aplica estado por CAS", Number(outcome.rows[0].state_version) === 2 && outcome.rows[0].applied);

  const idempotent = await db.query<{ state_version: bigint; applied: boolean }>(`
    select * from public.v3_commit_effect_outcome(
      $1::uuid, $2, $3, 1, $4::jsonb, $5::timestamptz
    )
  `, [TENANT, CONVERSATION, EFFECT, JSON.stringify(state(1, "discovery")), NOW]);
  check("EffectOutcomeCommit repetido e no-op", Number(idempotent.rows[0].state_version) === 2 && !idempotent.rows[0].applied);
  const repeatedReceipt = await db.query<{ recorded: boolean }>(`
    select public.v3_record_outbox_result(
      $1::uuid, $2, null, 'succeeded', 'delivered', $3::jsonb,
      null, false, null, '[]'::jsonb, $4::timestamptz
    ) as recorded
  `, [TENANT, EFFECT, JSON.stringify({ providerMessageId: "msg-1", delivered: true }), NOW]);
  check("receipt delivered repetido e no-op", repeatedReceipt.rows[0].recorded);

  const finalState = await db.query<{ version: bigint; stage: string; applied_at: string | null; terminal_at: string | null }>(`
    select s.version, s.state ->> 'stage' as stage,
           o.outcome_applied_at as applied_at, o.terminal_at
    from public.v3_conversation_state s
    join public.v3_effect_outbox o on o.conversation_id = s.conversation_id
    where o.effect_id = $1
  `, [EFFECT]);
  check(
    "estado entregue e ledger convergem",
    Number(finalState.rows[0].version) === 2
      && finalState.rows[0].stage === "discovery"
      && finalState.rows[0].applied_at !== null
      && finalState.rows[0].terminal_at !== null,
  );

  await expectReject("campos estruturais do outbox sao imutaveis", () => db.query(`
    update public.v3_effect_outbox
       set payload = '{"__redacted":true,"text":"forjado"}'::jsonb
     where effect_id = $1
  `, [EFFECT]), "v3_outbox_immutable_field_changed");

  await db.query(`
    select public.v3_ingest_inbox($1::uuid, 'evt-2', $2, $3::jsonb, $4::timestamptz)
  `, [TENANT, CONVERSATION, JSON.stringify({ __redacted: true, text: "Segunda" }), NOW]);
  await db.query(`
    select public.v3_claim_inbox_burst(
      $1::uuid, $2, $3::timestamptz, 'worker-1', 'turn-cas', $4,
      interval '2 minutes', 50, $3::timestamptz
    )
  `, [TENANT, CONVERSATION, NOW, leaseToken]);
  await expectReject("commit com versao obsoleta falha por CAS", () => db.query(`
    select public.v3_commit_turn(
      $1::uuid, $2, $3, 'lead-test', 'turn-cas', 0,
      $4::jsonb, $5::jsonb, '[]'::jsonb, '[]'::jsonb,
      array['evt-2']::text[], 'worker-1', $6, $7::timestamptz
    )
  `, [
    TENANT, CONVERSATION, AGENT,
    JSON.stringify(state(0)),
    JSON.stringify({ ...decision, turnId: "turn-cas" }),
    leaseToken, NOW,
  ]), "v3_cas_conflict");
  const rolledBack = await db.query<{ status: string; decisions: number }>(`
    select status,
      (select count(*)::int from public.v3_decisions where turn_id = 'turn-cas') as decisions
    from public.v3_inbox where event_id = 'evt-2'
  `);
  check("CAS falho nao deixa persistencia parcial", rolledBack.rows[0].status === "claimed" && rolledBack.rows[0].decisions === 0);

  await expectReject("grafo de efeitos rejeita dependencia inexistente", () => db.query(`
    insert into public.v3_effect_outbox (
      effect_id, idempotency_key, tenant_id, conversation_id, turn_id, plan_id,
      kind, payload, on_success, effect_order, depends_on, provider_capability
    ) values (
      'turn-bad:bad', 'turn-bad:bad', $1::uuid, $2, 'turn-bad', 'bad',
      'send_message', '{"__redacted":true,"text":"x"}'::jsonb, '[]'::jsonb,
      1, array['ghost']::text[], 'none'
    )
  `, [TENANT, CONVERSATION]), "v3_outbox_missing_dependency");

  await db.query(`
    insert into public.v3_effect_outbox (
      effect_id, idempotency_key, tenant_id, conversation_id, turn_id, plan_id,
      kind, payload, on_success, effect_order, depends_on, provider_capability
    ) values (
      'turn-media:photos', 'turn-media:photos', $1::uuid, $2, 'turn-media', 'photos',
      'send_media',
      '{"__redacted":true,"vehicleKey":"fiat|pulse|2024","photoIds":["p1","p2","p3"]}'::jsonb,
      '[]'::jsonb, 1, '{}'::text[], 'queryable'
    )
  `, [TENANT, CONVERSATION]);

  const mediaClaim = await db.query<{ processing_token: string }>(`
    select processing_token
    from public.v3_claim_outbox('dispatcher-media', interval '1 minute', 10, $1::timestamptz)
    where effect_id = 'turn-media:photos'
  `, [NOW]);
  await db.query(`
    select public.v3_record_outbox_result(
      $1::uuid, 'turn-media:photos', $2, 'succeeded', 'delivered',
      '{"providerMessageId":"media-1"}'::jsonb, null, false, null,
      $3::jsonb, $4::timestamptz
    )
  `, [
    TENANT,
    mediaClaim.rows[0].processing_token,
    JSON.stringify([
      { photoId: "p1", status: "succeeded", at: NOW },
      { photoId: "p2", status: "failed", at: NOW },
      { photoId: "p3", status: "succeeded", at: NOW },
    ]),
    NOW,
  ]);
  const mediaReceipts = await db.query<{ succeeded: number; failed: number }>(`
    select
      count(*) filter (where status = 'succeeded')::int as succeeded,
      count(*) filter (where status = 'failed')::int as failed
    from public.v3_media_receipts
    where effect_id = 'turn-media:photos'
  `);
  check("midia parcial persiste receipt por foto", mediaReceipts.rows[0].succeeded === 2 && mediaReceipts.rows[0].failed === 1);

  const mediaOutcome = await db.query<{ state_version: bigint; applied: boolean }>(`
    select * from public.v3_commit_effect_outcome(
      $1::uuid, $2, 'turn-media:photos', 2, null, $3::timestamptz
    )
  `, [TENANT, CONVERSATION, NOW]);
  check("outcome sem mutacao terminaliza sem incrementar estado", Number(mediaOutcome.rows[0].state_version) === 2 && mediaOutcome.rows[0].applied);
  // F2.5.1: claim por conversa nao mistura filas e usa token.
  await db.query(`
    insert into public.v3_effect_outbox (
      effect_id, idempotency_key, tenant_id, conversation_id, turn_id, plan_id,
      kind, payload, on_success, effect_order, depends_on, provider_capability
    ) values
      ('turn-guard:target', 'turn-guard:target', $1::uuid, 'conv-guard-target', 'turn-guard', 'target',
       'send_message', '{"__redacted":true,"text":"target"}'::jsonb, '[]'::jsonb, 1, '{}'::text[], 'idempotent'),
      ('turn-other:other', 'turn-other:other', $1::uuid, 'conv-guard-other', 'turn-other', 'other',
       'send_message', '{"__redacted":true,"text":"other"}'::jsonb, '[]'::jsonb, 1, '{}'::text[], 'idempotent')
  `, [TENANT]);
  const guardedClaim = await db.query<{ effect_id: string; processing_token: string }>(`
    select effect_id, processing_token
    from public.v3_claim_outbox_for_conversation(
      $1::uuid, 'conv-guard-target', 'worker-guard', 60000, 10, $2::timestamptz
    )
  `, [TENANT, NOW]);
  check("claim F2.5.1 isola uma conversa", guardedClaim.rows.length === 1 && guardedClaim.rows[0].effect_id === "turn-guard:target");

  const staleSkip = await db.query<{ skipped: boolean }>(`
    select public.v3_skip_outbox_guarded(
      $1::uuid, 'turn-guard:target', 'pending', null, null,
      'stale_writer', $2::timestamptz
    ) as skipped
  `, [TENANT, NOW]);
  const afterStaleSkip = await db.query<{ status: string; processing_token: string }>(`
    select status, processing_token from public.v3_effect_outbox where effect_id = 'turn-guard:target'
  `);
  check("writer stale nao cancela claim ativo", !staleSkip.rows[0].skipped && afterStaleSkip.rows[0].status === "processing" && afterStaleSkip.rows[0].processing_token === guardedClaim.rows[0].processing_token);

  await expectReject("resultado com processing token forjado falha fechado", () => db.query(`
    select public.v3_record_outbox_result(
      $1::uuid, 'turn-guard:target', 'token-forjado', 'succeeded', 'accepted',
      '{"effectId":"turn-guard:target","level":"accepted","at":"2026-06-27T12:00:00.000Z"}'::jsonb,
      null, false, null, '[]'::jsonb, $2::timestamptz
    )
  `, [TENANT, NOW]), "v3_outbox_result_transition_invalid");

  await db.query(`
    select public.v3_record_outbox_result(
      $1::uuid, 'turn-guard:target', $2, 'outcome_uncertain', null,
      '{"__redacted":true,"reason":"timeout"}'::jsonb,
      null, false, null, '[]'::jsonb, $3::timestamptz
    )
  `, [TENANT, guardedClaim.rows[0].processing_token, NOW]);
  const guardedRequeue = await db.query<{ requeued: boolean }>(`
    select public.v3_requeue_outbox_guarded(
      $1::uuid, 'turn-guard:target', 'outcome_uncertain', null, null,
      $2::timestamptz, 'reconcile_retry'
    ) as requeued
  `, [TENANT, NOW]);
  check("outcome uncertain idempotente volta a pending com guarda", guardedRequeue.rows[0].requeued);

  // Callback fora de ordem nunca rebaixa delivered nem permite fail stale.
  await db.query(`
    insert into public.v3_effect_outbox (
      effect_id, idempotency_key, tenant_id, conversation_id, turn_id, plan_id,
      kind, payload, on_success, effect_order, depends_on, provider_capability
    ) values (
      'turn-callback:message', 'turn-callback:message', $1::uuid, 'conv-callback',
      'turn-callback', 'message', 'send_message',
      '{"__redacted":true,"text":"mensagem critica"}'::jsonb,
      '[{"op":"advance_stage","effectId":"turn-callback:message","stage":"discovery"}]'::jsonb,
      1, '{}'::text[], 'queryable'
    )
  `, [TENANT]);
  const callbackClaim = await db.query<{ processing_token: string }>(`
    select processing_token from public.v3_claim_outbox_for_conversation(
      $1::uuid, 'conv-callback', 'worker-callback', 60000, 1, $2::timestamptz
    )
  `, [TENANT, NOW]);
  await db.query(`
    select public.v3_record_outbox_result(
      $1::uuid, 'turn-callback:message', $2, 'succeeded', 'accepted',
      '{"effectId":"turn-callback:message","level":"accepted","at":"2026-06-27T12:00:00.000Z"}'::jsonb,
      null, false, null, '[]'::jsonb, $3::timestamptz
    )
  `, [TENANT, callbackClaim.rows[0].processing_token, NOW]);
  await db.query(`
    select public.v3_record_outbox_result(
      $1::uuid, 'turn-callback:message', null, 'succeeded', 'delivered',
      '{"effectId":"turn-callback:message","level":"delivered","at":"2026-06-27T12:00:01.000Z"}'::jsonb,
      null, false, null, '[]'::jsonb, $2::timestamptz
    )
  `, [TENANT, NOW]);
  const staleFail = await db.query<{ failed: boolean }>(`
    select public.v3_fail_outbox_guarded(
      $1::uuid, 'turn-callback:message', 'succeeded', 'accepted', null,
      'accepted_timeout_stale', $2::timestamptz
    ) as failed
  `, [TENANT, NOW]);
  const staleAccepted = await db.query<{ recorded: boolean }>(`
    select public.v3_record_outbox_result(
      $1::uuid, 'turn-callback:message', null, 'succeeded', 'accepted',
      '{"effectId":"turn-callback:message","level":"accepted","at":"2026-06-27T12:00:00.000Z"}'::jsonb,
      null, false, null, '[]'::jsonb, $2::timestamptz
    ) as recorded
  `, [TENANT, NOW]);
  const callbackFinal = await db.query<{ status: string; receipt_level: string }>(`
    select status, receipt_level from public.v3_effect_outbox where effect_id = 'turn-callback:message'
  `);
  check("fail stale nao sobrescreve delivered", !staleFail.rows[0].failed && callbackFinal.rows[0].status === "succeeded" && callbackFinal.rows[0].receipt_level === "delivered");
  check("accepted atrasado e no-op depois de delivered", staleAccepted.rows[0].recorded && callbackFinal.rows[0].receipt_level === "delivered");

  // Falha conhecida retryable e segura mesmo quando capability=none.
  await db.query(`
    insert into public.v3_effect_outbox (
      effect_id, idempotency_key, tenant_id, conversation_id, turn_id, plan_id,
      kind, payload, on_success, effect_order, depends_on, provider_capability
    ) values (
      'turn-retry:message', 'turn-retry:message', $1::uuid, 'conv-retry',
      'turn-retry', 'message', 'send_message',
      '{"__redacted":true,"text":"retry"}'::jsonb, '[]'::jsonb,
      1, '{}'::text[], 'none'
    )
  `, [TENANT]);
  const retryClaim = await db.query<{ processing_token: string }>(`
    select processing_token from public.v3_claim_outbox_for_conversation(
      $1::uuid, 'conv-retry', 'worker-retry', 60000, 1, $2::timestamptz
    )
  `, [TENANT, NOW]);
  await db.query(`
    select public.v3_record_outbox_result(
      $1::uuid, 'turn-retry:message', $2, 'failed', null, null,
      'provider_indisponivel', true, $3::timestamptz, '[]'::jsonb, $3::timestamptz
    )
  `, [TENANT, retryClaim.rows[0].processing_token, NOW]);
  const knownFailureRetry = await db.query<{ requeued: boolean }>(`
    select public.v3_requeue_outbox_guarded(
      $1::uuid, 'turn-retry:message', 'failed', null, null,
      $2::timestamptz, 'retryable_failure_due'
    ) as requeued
  `, [TENANT, NOW]);
  check("falha conhecida retryable pode reentrar mesmo sem capability", knownFailureRetry.rows[0].requeued);
  await db.query(`
    insert into public.v3_effect_outbox (
      effect_id, idempotency_key, tenant_id, conversation_id, turn_id, plan_id,
      kind, payload, on_success, effect_order, depends_on, provider_capability
    ) values (
      'turn-terminal:message', 'turn-terminal:message', $1::uuid, 'conv-terminal',
      'turn-terminal', 'message', 'send_message',
      '{"__redacted":true,"text":"terminal"}'::jsonb, '[]'::jsonb,
      1, '{}'::text[], 'none'
    )
  `, [TENANT]);
  const terminalClaim = await db.query<{ processing_token: string }>(`
    select processing_token from public.v3_claim_outbox_for_conversation(
      $1::uuid, 'conv-terminal', 'worker-terminal', 60000, 1, $2::timestamptz
    )
  `, [TENANT, NOW]);
  await db.query(`
    select public.v3_record_outbox_result(
      $1::uuid, 'turn-terminal:message', $2, 'failed', null, null,
      'falha_terminal', false, null, '[]'::jsonb, $3::timestamptz
    )
  `, [TENANT, terminalClaim.rows[0].processing_token, NOW]);
  const reopenTerminal = await db.query<{ requeued: boolean }>(`
    select public.v3_requeue_outbox_guarded(
      $1::uuid, 'turn-terminal:message', 'failed', null, null,
      $2::timestamptz, 'nao_reabrir'
    ) as requeued
  `, [TENANT, NOW]);
  check("efeito terminal nao pode ser reaberto", !reopenTerminal.rows[0].requeued);
  const vaultPolicy = await db.query<{ public_select: boolean; rls: boolean }>(`
    select
      has_table_privilege('authenticated', 'public.v3_sensitive_vault', 'select') as public_select,
      c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v3_sensitive_vault'
  `);
  check("cofre sensivel sem leitura autenticada e com RLS", !vaultPolicy.rows[0].public_select && vaultPolicy.rows[0].rls);

  const verifyUrl = new URL("../../Brain/sql/v3_verify_after_install.sql", import.meta.url);
  const verifySql = await readFile(verifyUrl, "utf8");
  const verification = await db.query<{ check_name: string; ok: boolean; detail: string }>(verifySql);
  const verificationFailures = verification.rows.filter((row) => !row.ok);
  check(
    "verificador pos-instalacao retorna somente ok=true",
    verification.rows.length >= 40 && verificationFailures.length === 0,
    JSON.stringify(verificationFailures),
  );
  await db.close();
  console.log(`\n=== SQL: ${ok} OK | ${failed} FALHA ===`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
