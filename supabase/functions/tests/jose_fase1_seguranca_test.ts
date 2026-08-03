/**
 * Testes da Fase 1 do José — provas exigidas pelo dono.
 *
 * Rodar:
 *   deno test --allow-env --no-lock --node-modules-dir=none \
 *     supabase/functions/tests/jose_fase1_seguranca_test.ts
 *
 * Cada teste corresponde a uma prova pedida:
 *   T1  vendedor NÃO altera campanha
 *   T2  tenant NÃO acessa conta Meta de outro
 *   T3  body NÃO controla auto_execute        (regra documentada + T3b no agente)
 *   T4  fallback Meta global NÃO existe
 *   T5  idempotência (replay não repete gasto)
 *   T6  approval gate (guardrail 'gate' vira aprovação, não execução)
 *   T7  falha da Meta NÃO vira sucesso
 *   T8  JWT forjado (ataque do atob) é REJEITADO
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { requireInternalCaller } from "../_shared/jose-v2/internalAuth.ts";
import { buildAccess, canMutateAction, type JoseAccess } from "../_shared/jose-v2/authz.ts";
import { resolveOwnedAdAccount, assertResourceBelongsToAccount } from "../_shared/jose-v2/ownership.ts";
import * as idem from "../_shared/jose-v2/idempotency.ts";
import { orcamentoPlausivel, mapTipoAcao } from "../_shared/jose-v2/actionTaxonomy.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Fakes mínimos do client Supabase (encadeamento .from().select().eq()...)
// ─────────────────────────────────────────────────────────────────────────────
type Tabela = { rows: any[]; onInsert?: (row: any) => { error?: any; data?: any } };

function fakeAdmin(tabelas: Record<string, Tabela>) {
  const q = (nome: string) => {
    let rows = [...(tabelas[nome]?.rows ?? [])];
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { rows = rows.filter((r) => r[col] === val); return api; },
      neq: (col: string, val: any) => { rows = rows.filter((r) => r[col] !== val); return api; },
      is: (col: string, val: any) => { rows = rows.filter((r) => (r[col] ?? null) === val); return api; },
      or: () => api,
      not: () => api,
      gte: () => api,
      order: () => api,
      limit: (n: number) => { rows = rows.slice(0, n); return api; },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { code: "PGRST116" } }),
      insert: (row: any) => {
        const res = tabelas[nome]?.onInsert?.(row) ?? { data: { id: "novo-id", ...row } };
        const chain: any = {
          select: () => chain,
          maybeSingle: () => Promise.resolve({ data: res.error ? null : (res.data ?? { id: "novo-id" }), error: res.error ?? null }),
          single: () => Promise.resolve({ data: res.error ? null : (res.data ?? { id: "novo-id" }), error: res.error ?? null }),
          then: (f: any) => Promise.resolve({ data: res.data ?? null, error: res.error ?? null }).then(f),
        };
        return chain;
      },
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      then: (f: any) => Promise.resolve({ data: rows, error: null }).then(f),
    };
    return api;
  };
  return { from: (nome: string) => q(nome) };
}

const TENANT = "11111111-1111-1111-1111-111111111111";
const OUTRO_TENANT = "22222222-2222-2222-2222-222222222222";
const VENDEDOR = "33333333-3333-3333-3333-333333333333";

// ═══════════════════════════════════════════════════════════════════════════
// T8 — JWT FORJADO É REJEITADO (o ataque que o `atob` permitia)
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("T8 - JWT forjado com role=service_role e REJEITADO", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-real-do-servidor-1234567890");
  Deno.env.delete("JOSE_INTERNAL_SECRET");
  Deno.env.delete("JOSE_REQUIRE_REPLAY_GUARD");

  // Exatamente o ataque: header/payload em base64url, assinatura lixo.
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const forjado = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    role: "service_role",
    ref: "seyljsqmhlopkcauhlor",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.assinatura_invalida`;

  const r = await requireInternalCaller(new Request("http://x", { headers: { Authorization: `Bearer ${forjado}` } }));
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 401);
});

Deno.test("T8b - sem Authorization e REJEITADO; com a chave real e ACEITO", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-real-do-servidor-1234567890");
  const semAuth = await requireInternalCaller(new Request("http://x"));
  assertEquals(semAuth.ok, false);

  const comChave = await requireInternalCaller(
    new Request("http://x", { headers: { Authorization: "Bearer chave-real-do-servidor-1234567890" } }),
  );
  assertEquals(comChave.ok, true);
  if (comChave.ok) assertEquals(comChave.via, "service_role");
});

Deno.test("T8c - chave quase certa (1 char a menos) e REJEITADA", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-real-do-servidor-1234567890");
  const r = await requireInternalCaller(
    new Request("http://x", { headers: { Authorization: "Bearer chave-real-do-servidor-123456789" } }),
  );
  assertEquals(r.ok, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// T1 — VENDEDOR NÃO ALTERA CAMPANHA
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("T1 - vendedor sem permissao explicita NAO pode mutar", async () => {
  const admin = fakeAdmin({
    profiles: { rows: [{ id: VENDEDOR, role: "seller", manager_id: TENANT }] },
    ai_team_members: { rows: [{ auth_user_id: VENDEDOR, user_id: TENANT, is_manager: false, visible_features: {}, removed_at: null, active_in_system: true }] },
    jose_permissions: { rows: [] }, // tabela VAZIA, como em produção
  });

  const access = await buildAccess(admin, VENDEDOR);
  assertEquals(access.isSeller, true);
  assertEquals(access.tenantId, TENANT, "vê os dados da master (leitura permitida)");
  assertEquals(access.canView, true, "leitura NAO pode falhar fechada");
  assertEquals(access.canMutate, false, "mas NAO pode mutar");

  const perm = await canMutateAction(admin, access, "pausar_campanha", null);
  assertEquals(perm.permitido, false);
  assertEquals(perm.motivo, "sem_permissao_explicita");
});

Deno.test("T1b - vendedor COM permissao explicita 'executar' pode mutar aquela acao", async () => {
  const admin = fakeAdmin({
    profiles: { rows: [{ id: VENDEDOR, role: "seller", manager_id: TENANT }] },
    ai_team_members: { rows: [{ auth_user_id: VENDEDOR, user_id: TENANT, is_manager: true, visible_features: {}, removed_at: null, active_in_system: true }] },
    jose_permissions: { rows: [{ user_id: TENANT, tipo_acao: "pausar_campanha", nivel: "executar", ad_account_id: null }] },
  });
  const access = await buildAccess(admin, VENDEDOR);
  const ok = await canMutateAction(admin, access, "pausar_campanha", null);
  assertEquals(ok.permitido, true);

  // ...mas NÃO para outra ação sem permissão
  const nao = await canMutateAction(admin, access, "escalar_orcamento", null);
  assertEquals(nao.permitido, false);
});

Deno.test("T1c - dono/master pode mutar sem precisar de linha em jose_permissions", async () => {
  const admin = fakeAdmin({
    profiles: { rows: [{ id: TENANT, role: "owner", manager_id: null }] },
    ai_team_members: { rows: [] },
    jose_permissions: { rows: [] },
  });
  const access = await buildAccess(admin, TENANT);
  assertEquals(access.canMutate, true);
  assertEquals(access.tenantId, TENANT);
});

Deno.test("T1d - vendedor sem vinculo ativo nao ve nem muta", async () => {
  const admin = fakeAdmin({
    profiles: { rows: [{ id: VENDEDOR, role: "seller", manager_id: TENANT }] },
    ai_team_members: { rows: [] }, // desligado
    jose_permissions: { rows: [] },
  });
  const access = await buildAccess(admin, VENDEDOR);
  assertEquals(access.canView, false);
  assertEquals(access.canMutate, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// T2 — TENANT NÃO ACESSA CONTA META DE OUTRO
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("T2 - conta de OUTRO tenant e recusada", async () => {
  const admin = fakeAdmin({
    ad_accounts: {
      rows: [
        { id: "db1", user_id: TENANT, account_id: "act_111", access_token_encrypted: "tok1", is_active: true },
        { id: "db2", user_id: OUTRO_TENANT, account_id: "act_999", access_token_encrypted: "tok9", is_active: true },
      ],
    },
  });

  const proprio = await resolveOwnedAdAccount(admin, TENANT, "act_111");
  assertEquals(proprio.ok, true);

  const alheia = await resolveOwnedAdAccount(admin, TENANT, "act_999");
  assertEquals(alheia.ok, false);
  if (!alheia.ok) assertEquals(alheia.error, "conta_meta_nao_pertence_ao_tenant");
});

Deno.test("T2b - recurso (campanha) de outra conta e recusado", async () => {
  const fetchOriginal = globalThis.fetch;
  try {
    globalThis.fetch = ((_u: any, _i?: any) =>
      Promise.resolve(new Response(JSON.stringify({ account_id: "act_999" }), { status: 200 }))) as any;

    const r = await assertResourceBelongsToAccount("tok", "act_111", "120000000000", "campaign");
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.error, "campaign_de_outra_conta");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

Deno.test("T2c - falha ao verificar propriedade NEGA (fail-closed)", async () => {
  const fetchOriginal = globalThis.fetch;
  try {
    globalThis.fetch = (() => Promise.reject(new Error("rede caiu"))) as any;
    const r = await assertResourceBelongsToAccount("tok", "act_111", "120000000000", "campaign");
    assertEquals(r.ok, false);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// T4 — FALLBACK META GLOBAL NÃO EXISTE
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("T4 - tenant sem conta NAO cai para a conta da plataforma", async () => {
  // Mesmo com os secrets globais definidos, tem de dar erro operacional.
  Deno.env.set("META_ACCESS_TOKEN", "token-da-plataforma");
  Deno.env.set("META_AD_ACCOUNT_ID", "act_plataforma");

  const admin = fakeAdmin({ ad_accounts: { rows: [] } });
  const r = await resolveOwnedAdAccount(admin, TENANT, null);

  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.error, "tenant_sem_conta_meta_conectada");
    assertStringIncludes(String(r.detalhe), "Conecte uma conta");
  }
  Deno.env.delete("META_ACCESS_TOKEN");
  Deno.env.delete("META_AD_ACCOUNT_ID");
});

Deno.test("T4b - o codigo-fonte nao contem mais fallback global nas acoes", async () => {
  const src = await Deno.readTextFile(new URL("../apollo-agent/index.ts", import.meta.url));
  // Pode haver menção em comentário explicativo, mas NÃO pode haver retorno usando o secret.
  assert(
    !/return\s*\{\s*accessToken:\s*secretToken/.test(src),
    "ainda existe 'return { accessToken: secretToken ... }' (fallback global)",
  );
  assert(
    !/accessToken\s*=\s*secretToken/.test(src),
    "ainda existe atribuicao 'accessToken = secretToken' (fallback global)",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// T3 — BODY NÃO CONTROLA auto_execute
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("T3 - auto_execute nao e mais desestruturado do body", async () => {
  const src = await Deno.readTextFile(new URL("../apollo-agent/index.ts", import.meta.url));
  assert(
    !/const\s*\{[^}]*\bauto_execute\s*=\s*false\b[^}]*\}\s*=\s*body/s.test(src),
    "auto_execute ainda sai do destructuring do body",
  );
  assertStringIncludes(src, 'from("apollo_cron_config")', "deve ler a config do banco");
  assertStringIncludes(src, "config_ausente_fail_closed", "sem config -> fail-closed");
});

// ═══════════════════════════════════════════════════════════════════════════
// T5 — IDEMPOTÊNCIA
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("T5 - replay da mesma chave devolve a resposta anterior sem re-executar", async () => {
  const anterior = {
    id: "reg1", user_id: TENANT, idempotency_key: "chave-repetida-123",
    status: "succeeded", response: { success: true, meta_id: "abc" },
    request_hash: await idem.hashPayload({ a: 1 }),
  };
  const admin = fakeAdmin({
    jose_action_idempotency: {
      rows: [anterior],
      onInsert: () => ({ error: { code: "23505" } }), // já existe
    },
  });

  const r = await idem.begin(admin, { tenantId: TENANT, key: "chave-repetida-123", actionType: "pausar_campanha", payload: { a: 1 } });
  assertEquals(r.estado, "repetido");
  if (r.estado === "repetido") {
    assertEquals(r.status, 200);
    assertEquals((r.resposta as any).meta_id, "abc");
  }
});

Deno.test("T5b - mesma chave com payload DIFERENTE e recusada (422)", async () => {
  const admin = fakeAdmin({
    jose_action_idempotency: {
      rows: [{ id: "reg1", user_id: TENANT, idempotency_key: "k12345678", status: "succeeded", response: {}, request_hash: "hash-de-outro-payload" }],
      onInsert: () => ({ error: { code: "23505" } }),
    },
  });
  const r = await idem.begin(admin, { tenantId: TENANT, key: "k12345678", actionType: "pausar_campanha", payload: { b: 2 } });
  assertEquals(r.estado, "conflito_de_payload");
});

Deno.test("T5c - acao ainda em voo nao executa em paralelo", async () => {
  const admin = fakeAdmin({
    jose_action_idempotency: {
      rows: [{ id: "reg1", user_id: TENANT, idempotency_key: "k12345678", status: "in_progress", response: null, request_hash: await idem.hashPayload({ a: 1 }) }],
      onInsert: () => ({ error: { code: "23505" } }),
    },
  });
  const r = await idem.begin(admin, { tenantId: TENANT, key: "k12345678", actionType: "pausar_campanha", payload: { a: 1 } });
  assertEquals(r.estado, "em_voo");
});

Deno.test("T5d - banco indisponivel NAO libera execucao (fail-closed)", async () => {
  const admin = fakeAdmin({
    jose_action_idempotency: { rows: [], onInsert: () => ({ error: { code: "08006", message: "conexao caiu" } }) },
  });
  const r = await idem.begin(admin, { tenantId: TENANT, key: "k12345678", actionType: "pausar_campanha", payload: {} });
  assertEquals(r.estado, "indisponivel");
});

// ═══════════════════════════════════════════════════════════════════════════
// T6 / T7 — APPROVAL GATE e FALHA DA META
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("T6 - guardrail 'gate' cria aprovacao e NAO executa (codigo 202)", async () => {
  const src = await Deno.readTextFile(new URL("../apollo-agent/index.ts", import.meta.url));
  assertStringIncludes(src, 'guard.decision === "gate"');
  assertStringIncludes(src, 'from("jose_action_approvals")');
  assertStringIncludes(src, "aguardando_aprovacao");

  // O caminho de gate NÃO pode executar na Meta. Recorta DENTRO de
  // handleExecuteAction (o indexOf cru pegaria antes o bloco de auto-execução).
  const inicioHandler = src.indexOf("async function handleExecuteAction(");
  assert(inicioHandler > 0, "handleExecuteAction nao encontrado");
  const gateNoHandler = src.indexOf('if (guard.decision === "gate")', inicioHandler);
  const executaNoHandler = src.indexOf("// ── 7) EXECUTA NA META", inicioHandler);
  assert(gateNoHandler > 0 && executaNoHandler > gateNoHandler, "ordem gate->executa invertida");
  const trecho = src.slice(gateNoHandler, executaNoHandler);
  assert(!trecho.includes("executeMetaAction("), "o caminho de aprovacao nao pode executar na Meta");
  assertStringIncludes(trecho, "202", "gate deve responder 202 (aceito, aguardando)");
});

Deno.test("T7 - erro da Meta vira 502, nunca 200", async () => {
  const src = await Deno.readTextFile(new URL("../apollo-agent/index.ts", import.meta.url));
  assertStringIncludes(src, "const metaFalhou =");
  assertStringIncludes(src, "metaFalhou ? 502 : 200");
});

Deno.test("T7b - cron so considera sucesso com response.ok E corpo coerente", async () => {
  const src = await Deno.readTextFile(new URL("../jose-cron-runner/index.ts", import.meta.url));
  assertStringIncludes(src, "const sucesso = response.ok && corpoOk");

  // Não pode reportar 'ok' fixo. Ignora COMENTÁRIOS (que citam o bug antigo de
  // propósito) e olha só o código executável.
  const semComentarios = src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
    .join("\n");
  assert(!/status:\s*"ok"/.test(semComentarios), "não pode mais reportar 'ok' fixo no código");
  // next_run_at definitivo só depois do resultado
  const idxLease = src.indexOf("const leaseAte =");
  const idxFinal = src.indexOf("SÓ AGORA agenda o próximo dia");
  assert(idxLease > 0 && idxFinal > idxLease, "o agendamento definitivo tem de vir DEPOIS da execucao");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sanidade de orçamento e taxonomia
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("T9 - orcamento absurdo e recusado; valor normal passa", () => {
  Deno.env.delete("JOSE_LIMITE_ORCAMENTO_DIARIO"); // default 5000
  assertEquals(orcamentoPlausivel(150).ok, true);
  assertEquals(orcamentoPlausivel(999999).ok, false);
  assertEquals(orcamentoPlausivel(-5).ok, false);
  assertEquals(orcamentoPlausivel("abc").ok, false);
  assertEquals(orcamentoPlausivel(undefined).ok, true, "ausencia nao e erro");
});

Deno.test("T10 - taxonomia mapeia acoes da Meta para o vocabulario de governanca", () => {
  assertEquals(mapTipoAcao("pause_campaign"), "pausar_campanha");
  assertEquals(mapTipoAcao("increase_budget"), "escalar_orcamento");
  assertEquals(mapTipoAcao("decrease_budget"), "reduzir_orcamento");
  assertEquals(mapTipoAcao("clone_campaign"), "criar_campanha");
});
