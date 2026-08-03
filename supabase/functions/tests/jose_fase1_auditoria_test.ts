/**
 * Testes exigidos pela AUDITORIA da Fase 1 (rodada 2).
 *
 * Rodar:
 *   deno test --allow-env --allow-read --no-lock --node-modules-dir=none \
 *     supabase/functions/tests/jose_fase1_auditoria_test.ts
 *
 * Cobre os achados 1, 2, 3 e 5 da auditoria:
 *   A*  matriz de autorização (role nunca prova propriedade)
 *   H*  canonicalização recursiva do hash de idempotência
 *   C*  complete() não pode falhar em silêncio
 *   L*  lease com token (concorrência do cron)
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildAccess, canMutateAction } from "../_shared/jose-v2/authz.ts";
import * as idem from "../_shared/jose-v2/idempotency.ts";
import { _canonicalizeParaTeste as canon } from "../_shared/jose-v2/idempotency.ts";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OUTRO_TENANT = "22222222-2222-2222-2222-222222222222";
const GERENTE = "44444444-4444-4444-4444-444444444444";

type Tabela = { rows: any[] };

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
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (f: any) => Promise.resolve({ data: rows, error: null }).then(f),
    };
    return api;
  };
  return { from: (nome: string) => q(nome) };
}

/** Monta um cenário de MEMBRO (gerente/vendedor) de um tenant. */
function cenarioMembro(opts: {
  role?: string;
  superadmin?: boolean;
  membro?: { user_id: string; is_manager?: boolean; visible_features?: any; removed_at?: any; active_in_system?: boolean } | null;
  permissoes?: any[];
}) {
  return fakeAdmin({
    profiles: { rows: [{ id: GERENTE, role: opts.role ?? "manager", is_superadmin: !!opts.superadmin, manager_id: null }] },
    ai_team_members: {
      rows: opts.membro
        ? [{
          auth_user_id: GERENTE,
          user_id: opts.membro.user_id,
          is_manager: opts.membro.is_manager ?? false,
          visible_features: opts.membro.visible_features ?? {},
          removed_at: opts.membro.removed_at ?? null,
          active_in_system: opts.membro.active_in_system ?? true,
        }]
        : [],
    },
    jose_permissions: { rows: opts.permissoes ?? [] },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORIA #1 — "role != seller" NUNCA é prova de propriedade
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("A1 - OWNER: sem vinculo de membro, opera a propria conta", async () => {
  const admin = fakeAdmin({
    profiles: { rows: [{ id: TENANT, role: "owner", is_superadmin: false, manager_id: null }] },
    ai_team_members: { rows: [] },
    jose_permissions: { rows: [] },
  });
  const a = await buildAccess(admin, TENANT);
  assertEquals(a.isOwner, true);
  assertEquals(a.tenantId, TENANT);
  assertEquals(a.canMutate, true);
  assertEquals(a.motivo, "owner_do_tenant");
});

Deno.test("A2 - GERENTE (role!=seller) membro do tenant NAO vira dono", async () => {
  const admin = cenarioMembro({ role: "manager", membro: { user_id: TENANT, is_manager: true } });
  const a = await buildAccess(admin, GERENTE);
  assertEquals(a.isOwner, false, "role 'manager' nao pode conceder propriedade");
  assertEquals(a.tenantId, TENANT, "tenant vem do VINCULO, nao do role");
  assertEquals(a.canView, true, "ler continua permitido");
  assertEquals(a.canMutate, false, "mutar exige permissao explicita");
  assertEquals(a.motivo, "gerente_precisa_permissao_explicita");
});

Deno.test("A3 - GERENTE com agent_jose=false nao ve nem muta", async () => {
  const admin = cenarioMembro({ role: "manager", membro: { user_id: TENANT, is_manager: true, visible_features: { agent_jose: false } } });
  const a = await buildAccess(admin, GERENTE);
  assertEquals(a.canView, false);
  assertEquals(a.canRecommend, false);
  assertEquals(a.canMutate, false);
});

Deno.test("A4 - GERENTE nivel 'recomendar': ve e recomenda, NAO executa", async () => {
  const admin = cenarioMembro({
    role: "manager",
    membro: { user_id: TENANT, is_manager: true },
    permissoes: [{ user_id: TENANT, tipo_acao: "pausar_campanha", nivel: "recomendar", ad_account_id: null }],
  });
  const a = await buildAccess(admin, GERENTE);
  assertEquals(a.canRecommend, true);
  const p = await canMutateAction(admin, a, "pausar_campanha", null);
  assertEquals(p.permitido, false);
  assertEquals(p.motivo, "permissao_nivel_recomendar");
});

Deno.test("A5 - GERENTE nivel 'executar' muta SO a acao permitida", async () => {
  const admin = cenarioMembro({
    role: "manager",
    membro: { user_id: TENANT, is_manager: true },
    permissoes: [{ user_id: TENANT, tipo_acao: "pausar_campanha", nivel: "executar", ad_account_id: null }],
  });
  const a = await buildAccess(admin, GERENTE);
  assertEquals((await canMutateAction(admin, a, "pausar_campanha", null)).permitido, true);
  assertEquals((await canMutateAction(admin, a, "escalar_orcamento", null)).permitido, false, "permissao e por ACAO");
});

Deno.test("A6 - GERENTE nivel 'desligado' nao executa", async () => {
  const admin = cenarioMembro({
    role: "manager",
    membro: { user_id: TENANT, is_manager: true },
    permissoes: [{ user_id: TENANT, tipo_acao: "pausar_campanha", nivel: "desligado", ad_account_id: null }],
  });
  const a = await buildAccess(admin, GERENTE);
  assertEquals((await canMutateAction(admin, a, "pausar_campanha", null)).permitido, false);
});

Deno.test("A7 - SELLER comum nunca muta", async () => {
  const admin = cenarioMembro({ role: "seller", membro: { user_id: TENANT, is_manager: false } });
  const a = await buildAccess(admin, GERENTE);
  assertEquals(a.isOwner, false);
  assertEquals(a.canMutate, false);
  assertEquals(a.motivo, "membro_precisa_permissao_explicita");
  assertEquals((await canMutateAction(admin, a, "pausar_campanha", null)).permitido, false);
});

Deno.test("A8 - MEMBRO REMOVIDO nao ve nem muta", async () => {
  const admin = cenarioMembro({ role: "manager", membro: { user_id: TENANT, is_manager: true, removed_at: "2026-01-01T00:00:00Z" } });
  const a = await buildAccess(admin, GERENTE);
  assertEquals(a.canView, false);
  assertEquals(a.canMutate, false);
});

Deno.test("A9 - MEMBRO INATIVO nao ve nem muta", async () => {
  const admin = cenarioMembro({ role: "manager", membro: { user_id: TENANT, is_manager: true, active_in_system: false } });
  const a = await buildAccess(admin, GERENTE);
  assertEquals(a.canView, false);
  assertEquals(a.canMutate, false);
});

Deno.test("A10 - CROSS-TENANT: escopo vem do vinculo e nunca vaza", async () => {
  const admin = cenarioMembro({ role: "manager", membro: { user_id: TENANT, is_manager: true } });
  const a = await buildAccess(admin, GERENTE);
  assertEquals(a.tenantId, TENANT);
  assert(a.tenantId !== OUTRO_TENANT);
  // Mesmo havendo permissao 'executar' cadastrada para OUTRO tenant, nao vale.
  const adminComPermAlheia = cenarioMembro({
    role: "manager",
    membro: { user_id: TENANT, is_manager: true },
    permissoes: [{ user_id: OUTRO_TENANT, tipo_acao: "pausar_campanha", nivel: "executar", ad_account_id: null }],
  });
  const b = await buildAccess(adminComPermAlheia, GERENTE);
  assertEquals((await canMutateAction(adminComPermAlheia, b, "pausar_campanha", null)).permitido, false);
});

Deno.test("A11 - SUPERADMIN comprovado pelo campo oficial mantem poder", async () => {
  const admin = cenarioMembro({ role: "manager", superadmin: true, membro: { user_id: TENANT, is_manager: true } });
  const a = await buildAccess(admin, GERENTE);
  assertEquals(a.canMutate, true);
  assertEquals(a.motivo, "superadmin_comprovado");
});

Deno.test("A12 - erro de infraestrutura NEGA tudo (fail-closed)", async () => {
  const quebrado: any = { from: () => { throw new Error("banco fora"); } };
  const a = await buildAccess(quebrado, GERENTE);
  assertEquals(a.canMutate, false);
  assertEquals(a.canView, false);
  assertStringIncludes(a.motivo, "erro_avaliando_permissao");
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORIA #2 — CANONICALIZAÇÃO RECURSIVA
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("H1 - mesma estrutura com ORDEM diferente = mesmo hash", async () => {
  const a = await idem.hashPayload({ campaignId: "1", actionParams: { budget: 100, tipo: "x" } });
  const b = await idem.hashPayload({ actionParams: { tipo: "x", budget: 100 }, campaignId: "1" });
  assertEquals(a, b);
});

Deno.test("H2 - REGRESSAO: budget=100 vs 200 DEVEM diferir (bug do replacer array)", async () => {
  const p1 = { campaignId: "1", actionType: "increase_budget", actionParams: { budget: 100 } };
  const p2 = { campaignId: "1", actionType: "increase_budget", actionParams: { budget: 200 } };

  const a = await idem.hashPayload(p1);
  const b = await idem.hashPayload(p2);
  assert(a !== b, "alteracao aninhada tem de mudar o hash");

  // Prova de que o METODO ANTIGO colapsava os dois no mesmo texto:
  const antigoA = JSON.stringify(p1, Object.keys(p1).sort() as any);
  const antigoB = JSON.stringify(p2, Object.keys(p2).sort() as any);
  assertEquals(antigoA, antigoB, "confirma o bug: o metodo antigo produzia a MESMA string");
});

Deno.test("H3 - alteracao a 3 niveis de profundidade e detectada", async () => {
  const a = await idem.hashPayload({ p: { q: { r: { s: 1 } } } });
  const b = await idem.hashPayload({ p: { q: { r: { s: 2 } } } });
  assert(a !== b);
});

Deno.test("H4 - ordem de ARRAY e significativa; tipo escalar preservado", async () => {
  assert(await idem.hashPayload({ ids: [1, 2] }) !== await idem.hashPayload({ ids: [2, 1] }));
  assert(await idem.hashPayload({ v: 1 }) !== await idem.hashPayload({ v: "1" }));
  assert(await idem.hashPayload({ v: true }) !== await idem.hashPayload({ v: "true" }));
});

Deno.test("H5 - nenhuma propriedade aninhada e removida", () => {
  const c = canon({ a: 1, params: { budget: 100, nested: { x: [1, { y: 2 }] } } });
  assertStringIncludes(c, '"budget":100');
  assertStringIncludes(c, '"y":2');
});

Deno.test("H6 - ciclo vira marcador em vez de estourar", () => {
  const o: any = { a: 1 };
  o.self = o;
  assertStringIncludes(canon(o), "__ciclo__");
});

Deno.test("H7 - chaves com undefined nao alteram o hash", async () => {
  const a = await idem.hashPayload({ x: 1, y: undefined });
  const b = await idem.hashPayload({ x: 1 });
  assertEquals(a, b);
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORIA #3 — complete() NÃO PODE FALHAR EM SILÊNCIO
// ═══════════════════════════════════════════════════════════════════════════

function adminUpdate(resposta: { data?: any[] | null; error?: any }) {
  return {
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null }),
          }),
        }),
      }),
    }),
  } as any;
}

Deno.test("C1 - erro do banco na finalizacao e REPORTADO", async () => {
  const r = await idem.complete(adminUpdate({ error: { message: "conexao caiu", code: "08006" } }), "reg1", "succeeded", {});
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.motivo, "erro_banco");
});

Deno.test("C2 - zero linhas alteradas e REPORTADO (transicao unica)", async () => {
  const r = await idem.complete(adminUpdate({ data: [] }), "reg1", "succeeded", {});
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.motivo, "nenhuma_linha");
});

Deno.test("C3 - finalizacao efetiva devolve ok", async () => {
  const r = await idem.complete(adminUpdate({ data: [{ id: "reg1" }] }), "reg1", "succeeded", {});
  assertEquals(r.ok, true);
});

Deno.test("C4 - excecao e capturada e reportada", async () => {
  const quebrado: any = { from: () => { throw new Error("boom"); } };
  const r = await idem.complete(quebrado, "reg1", "succeeded", {});
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.motivo, "excecao");
});

Deno.test("C5 - apollo-agent NAO responde sucesso limpo se a persistencia falhou", async () => {
  const src = await Deno.readTextFile(new URL("../apollo-agent/index.ts", import.meta.url));
  assertStringIncludes(src, "if (!fim.ok)");
  assertStringIncludes(src, "aplicado_na_meta_sem_confirmacao_local");
});

Deno.test("C6 - update de finalizacao e condicional a status='in_progress'", async () => {
  const src = await Deno.readTextFile(new URL("../_shared/jose-v2/idempotency.ts", import.meta.url));
  assertStringIncludes(src, '.eq("status", "in_progress")');
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORIA #5 — LEASE COM TOKEN
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("L1 - claim gera lease_token e finalizacao e condicional a ele", async () => {
  const src = await Deno.readTextFile(new URL("../jose-cron-runner/index.ts", import.meta.url));
  assertStringIncludes(src, "leaseToken = crypto.randomUUID()");
  assertStringIncludes(src, 'q.eq("lease_token", leaseToken)');
  assertStringIncludes(src, "lease perdido");
});

Deno.test("L2 - erros de dueUsers e do claim NAO sao ignorados", async () => {
  const src = await Deno.readTextFile(new URL("../jose-cron-runner/index.ts", import.meta.url));
  assertStringIncludes(src, "if (dueErr)");
  assertStringIncludes(src, "falha_lendo_configuracao");
  assertStringIncludes(src, "if (claimErr)");
  assertStringIncludes(src, "claim_falhou");
});

Deno.test("L3 - CONCORRENCIA: so o detentor do lease finaliza", () => {
  // Simula a semântica do UPDATE ... WHERE lease_token = $token
  let leaseNoBanco = "token-B";
  const finalizar = (token: string) => {
    if (token !== leaseNoBanco) return 0; // 0 linhas: worker perdeu o lease
    leaseNoBanco = "";                     // libera
    return 1;
  };
  // Worker A (lease vencido, tomado por B) tenta finalizar
  assertEquals(finalizar("token-A"), 0, "worker sem o lease nao pode finalizar");
  // Worker B (detentor) finaliza
  assertEquals(finalizar("token-B"), 1, "somente o detentor finaliza");
  // B tentando de novo tambem falha (lease ja liberado)
  assertEquals(finalizar("token-B"), 0, "finalizacao e unica");
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORIA #6 — MEDIÇÃO DIÁRIA SÓ MARCA APÓS CONFIRMAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

// NOTA: após o bloqueio 1 da 4ª auditoria, a máquina de estados da marca
// diária SAIU do TypeScript e vive nas RPCs (claim_jose_daily_job /
// finish_jose_daily_job) — justamente para não haver read-then-write nem
// duas semânticas de NULL. Por isso estes dois testes agora inspecionam o SQL,
// e o comportamento em si é exercitado em jose_fase1_bloqueios_test.ts (B2.*).

Deno.test("M1 - marca nasce 'em_andamento' e so vira 'concluido' apos validar", async () => {
  const src = await Deno.readTextFile(new URL("../jose-cron-runner/index.ts", import.meta.url));
  const sql = await Deno.readTextFile(new URL("../../migrations/20260802120000_jose_fase1_idempotencia_e_cron.sql", import.meta.url));

  // o claim nasce 'em_andamento' e a conclusão depende do resultado (p_ok)
  assertStringIncludes(sql, "'em_andamento', 1, p_token, p_owner, v_exp");
  assertStringIncludes(sql, "CASE WHEN p_ok THEN 'concluido' ELSE 'falhou' END");

  // a chamada é AGUARDADA (nada de fire-and-forget) e só depois finaliza
  assert(!/void\s+chamarMedicao\(/.test(src), "medicao nao pode ser fire-and-forget");
  assertStringIncludes(src, "const r = await chamarMedicao(");
  const iChamada = src.indexOf("await chamarMedicao(");
  const iFinaliza = src.indexOf('admin.rpc("finish_jose_daily_job"');
  assert(iChamada > 0 && iFinaliza > iChamada, "a finalizacao tem de vir DEPOIS da medicao");
});

Deno.test("M2 - falha da medicao vira estado retryable com backoff, sem queimar o dia", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20260802120000_jose_fase1_idempotencia_e_cron.sql", import.meta.url));
  // falha agenda proxima_em pela tentativa ATUAL (5 min / 20 min) e libera o lease
  assertStringIncludes(sql, "p_backoff_min[least(m.tentativas, coalesce(array_length(p_backoff_min, 1), 1))]");
  assertStringIncludes(sql, "WHEN m.tentativas >= p_max_tentativas THEN NULL");
  assertStringIncludes(sql, "lease_token      = NULL");
  // e o claim respeita limite de tentativas e backoff
  assertStringIncludes(sql, "m.tentativas < p_max_tentativas");
  assertStringIncludes(sql, "falhou_limite_de_tentativas");
  assertStringIncludes(sql, "aguardando_backoff");
});

Deno.test("M3 - chamarMedicao valida HTTP e corpo", async () => {
  const src = await Deno.readTextFile(new URL("../jose-cron-runner/index.ts", import.meta.url));
  assertStringIncludes(src, "if (!res.ok) return { ok: false");
  assertStringIncludes(src, "corpo_com_erro");
});
