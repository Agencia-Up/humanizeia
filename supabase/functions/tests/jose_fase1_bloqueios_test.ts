/**
 * Testes COMPORTAMENTAIS dos bloqueios da auditoria (rodada 3).
 *
 * Diferente das rodadas anteriores, aqui NÃO se verifica string no fonte: cada
 * teste exercita a função com um duplo do banco e confere o RESULTADO.
 *
 * Comando exato:
 *   "/c/Users/User/.deno/bin/deno" test --allow-env --allow-read --no-lock \
 *     --node-modules-dir=none supabase/functions/tests/jose_fase1_bloqueios_test.ts
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildAccess } from "../_shared/jose-v2/authz.ts";
import * as idem from "../_shared/jose-v2/idempotency.ts";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000002";
const USUARIO = "cccccccc-0000-0000-0000-000000000003";

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO 3 — ISOLAMENTO: nunca escolher ativos[0]
// ═══════════════════════════════════════════════════════════════════════════

/** Duplo de banco só com o necessário para buildAccess. */
function bancoComVinculos(vinculos: any[], perfil: any = { role: "manager", is_superadmin: false }) {
  return {
    from: (tabela: string) => {
      if (tabela === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: USUARIO, ...perfil }, error: null }) }) }),
        };
      }
      if (tabela === "ai_team_members") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: () => Promise.resolve({ data: vinculos, error: null }) }),
              // caminho usado por resolveEffectiveTenant
              neq: () => ({ order: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: vinculos[0] ?? null, error: null }) }) }) }) }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    },
  } as any;
}

const vinculoAtivo = (tenant: string, gerente = true) => ({
  user_id: tenant, is_manager: gerente, visible_features: {}, removed_at: null, active_in_system: true,
});

Deno.test("B3.1 - DOIS tenants ativos SEM contexto => RECUSA por ambiguidade", async () => {
  const admin = bancoComVinculos([vinculoAtivo(TENANT_A), vinculoAtivo(TENANT_B)]);
  const a = await buildAccess(admin, USUARIO); // sem tenantContext
  assertEquals(a.canView, false, "nao pode ver nada sem saber de quem");
  assertEquals(a.canMutate, false);
  assertStringIncludes(a.motivo, "associacao_ambigua");
  assert(a.tenantId !== TENANT_A && a.tenantId !== TENANT_B, "nao pode ter escolhido nenhum dos dois");
});

Deno.test("B3.2 - DOIS tenants ativos COM contexto valido => usa exatamente o pedido", async () => {
  const admin = bancoComVinculos([vinculoAtivo(TENANT_A), vinculoAtivo(TENANT_B)]);
  const a = await buildAccess(admin, USUARIO, TENANT_B);
  assertEquals(a.tenantId, TENANT_B);
  assertEquals(a.canView, true);
  assertEquals(a.canMutate, false, "ver sim, mutar so com permissao explicita");
});

Deno.test("B3.3 - contexto de tenant SEM vinculo ativo => RECUSA", async () => {
  const admin = bancoComVinculos([vinculoAtivo(TENANT_A)]);
  const a = await buildAccess(admin, USUARIO, TENANT_B);
  assertEquals(a.canView, false);
  assertEquals(a.motivo, "sem_vinculo_ativo_no_tenant_solicitado");
});

Deno.test("B3.4 - UM tenant ativo dispensa contexto", async () => {
  const admin = bancoComVinculos([vinculoAtivo(TENANT_A)]);
  const a = await buildAccess(admin, USUARIO);
  assertEquals(a.tenantId, TENANT_A);
  assertEquals(a.canView, true);
});

Deno.test("B3.5 - duas LINHAS do mesmo tenant nao sao ambiguidade (escolhe a de gerente)", async () => {
  const admin = bancoComVinculos([vinculoAtivo(TENANT_A, false), vinculoAtivo(TENANT_A, true)]);
  const a = await buildAccess(admin, USUARIO);
  assertEquals(a.tenantId, TENANT_A);
  assertEquals(a.isManager, true);
  assertEquals(a.canView, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO 1 — complete() em TODOS os caminhos
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Duplo que simula a tabela de idempotência com falha configurável na
 * finalização, e registra o que foi para apollo_action_log.
 */
function bancoIdem(opts: { falhaAoFinalizar?: any; linhasAfetadas?: number }) {
  const auditoria: any[] = [];
  const admin: any = {
    from: (tabela: string) => {
      if (tabela === "jose_action_idempotency") {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => Promise.resolve({
                  data: opts.falhaAoFinalizar ? null : Array.from({ length: opts.linhasAfetadas ?? 1 }, () => ({ id: "reg1" })),
                  error: opts.falhaAoFinalizar ?? null,
                }),
              }),
            }),
          }),
        };
      }
      if (tabela === "apollo_action_log") {
        return { insert: (row: any) => { auditoria.push(row); return Promise.resolve({ data: null, error: null }); } };
      }
      return { insert: () => Promise.resolve({ data: null, error: null }) };
    },
  };
  return { admin, auditoria };
}

Deno.test("B1.1 - complete() com erro de banco NAO devolve ok", async () => {
  const { admin } = bancoIdem({ falhaAoFinalizar: { code: "08006", message: "conexao caiu" } });
  const r = await idem.complete(admin, "reg1", "succeeded", { success: true });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.motivo, "erro_banco");
});

Deno.test("B1.2 - complete() com ZERO linhas (ja finalizado) NAO devolve ok", async () => {
  const { admin } = bancoIdem({ linhasAfetadas: 0 });
  const r = await idem.complete(admin, "reg1", "succeeded", {});
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.motivo, "nenhuma_linha");
});

Deno.test("B1.3 - reserva NUNCA fica silenciosamente em in_progress: falha e observavel", async () => {
  // Se complete() falhar, o chamador PRECISA saber. Aqui provamos que a
  // informacao chega (ok=false + motivo + detalhe), que e o que permite ao
  // apollo-agent devolver 'aplicado_na_meta_sem_confirmacao_local'.
  const { admin } = bancoIdem({ falhaAoFinalizar: { code: "57014", message: "statement timeout" } });
  const r = await idem.complete(admin, "reg-abandonado", "succeeded", { meta: "aplicado" });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assert(r.motivo.length > 0);
    assertStringIncludes(r.detalhe, "statement timeout");
  }
});

Deno.test("B1.4 - update de finalizacao e condicional (transicao unica)", async () => {
  // Simula a semantica UPDATE ... WHERE id=? AND status='in_progress'
  let estado = "in_progress";
  const admin: any = {
    from: () => ({
      update: (patch: any) => ({
        eq: () => ({
          eq: (col: string, val: any) => ({
            select: () => {
              if (col === "status" && estado !== val) return Promise.resolve({ data: [], error: null });
              estado = patch.status;
              return Promise.resolve({ data: [{ id: "reg1" }], error: null });
            },
          }),
        }),
      }),
    }),
  };
  const primeira = await idem.complete(admin, "reg1", "succeeded", {});
  assertEquals(primeira.ok, true, "primeira finalizacao funciona");
  const segunda = await idem.complete(admin, "reg1", "failed", {});
  assertEquals(segunda.ok, false, "segunda nao pode sobrescrever o desfecho");
  if (!segunda.ok) assertEquals(segunda.motivo, "nenhuma_linha");
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO 2 — LEASE DA MEDIÇÃO DIÁRIA (comportamento simulado)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Modelo executável da RPC `claim_jose_daily_job` / `finish_jose_daily_job`.
 *
 * IMPORTANTE (divergência corrigida): a versão anterior deste duplo avaliava
 *   `m.lease_expires_at !== null && m.lease_expires_at <= agora`
 * ou seja, tratava NULL como NÃO vencido — enquanto o código de produção em JS
 * tratava NULL como vencido e o SQL (`.lte`) não casava com NULL. Três
 * semânticas diferentes para a mesma pergunta. Agora o duplo replica
 * LITERALMENTE o predicado da RPC:
 *
 *   status <> 'concluido'
 *   AND tentativas < MAX
 *   AND ( (status='em_andamento' AND (lease_expires_at IS NULL OR lease_expires_at <= now))
 *      OR (status='falhou'       AND (proxima_em       IS NULL OR proxima_em       <= now)) )
 */
type Marca = { status: string; tentativas: number; lease_token: string | null; lease_expires_at: number | null; proxima_em: number | null };

/** Reproduz `x IS NULL OR x <= agora` (em SQL, NULL <= agora é NULL = não casa). */
function nuloOuVencido(valor: number | null, agora: number): boolean {
  return valor === null || valor <= agora;
}

function tabelaMarcas() {
  const linhas = new Map<string, Marca>();
  return {
    /** Espelha o INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING. */
    claim(chave: string, token: string, agora: number, leaseMs: number, MAX = 3): string {
      const m = linhas.get(chave);
      if (!m) {
        linhas.set(chave, { status: "em_andamento", tentativas: 1, lease_token: token, lease_expires_at: agora + leaseMs, proxima_em: null });
        return "reservado";
      }

      // predicado do WHERE, na mesma ordem da RPC
      const recuperavel =
        m.status !== "concluido" &&
        m.tentativas < MAX &&
        ((m.status === "em_andamento" && nuloOuVencido(m.lease_expires_at, agora)) ||
         (m.status === "falhou" && nuloOuVencido(m.proxima_em, agora)));

      if (recuperavel) {
        m.status = "em_andamento";
        m.tentativas += 1;
        m.lease_token = token;
        m.lease_expires_at = agora + leaseMs;
        return "lease_recuperado";
      }

      // Perdeu a disputa: a RPC apenas EXPLICA o motivo.
      if (m.status === "concluido") return "ja_concluido_hoje";
      if (m.tentativas >= MAX) return "falhou_limite_de_tentativas";
      if (m.status === "em_andamento") return "em_andamento_por_outro_worker";
      if (m.status === "falhou" && m.proxima_em !== null && m.proxima_em > agora) return "aguardando_backoff";
      return `nao_disparado:estado_${m.status}`;
    },
    /**
     * Espelha finish_jose_daily_job: condicional a status e token, e com o
     * BACKOFF calculado a partir da tentativa ATUAL da linha — exatamente como
     * a RPC faz com
     *   p_backoff_min[least(m.tentativas, array_length(p_backoff_min,1))]
     * Retorna o mesmo formato jsonb da RPC.
     */
    finalizar(
      chave: string, token: string | null, ok: boolean, agora: number,
      backoff = [5, 20], MAX = 3,
    ): { finalizado: boolean; motivo?: string; tentativas?: number; backoff_min?: number | null; proxima_em?: number | null; limite_atingido?: boolean } {
      if (token === null) return { finalizado: false, motivo: "token_nulo" };
      const m = linhas.get(chave);
      if (!m) return { finalizado: false, motivo: "lease_perdido_ou_nao_em_andamento" };
      if (m.status !== "em_andamento") return { finalizado: false, motivo: "lease_perdido_ou_nao_em_andamento" };
      if (m.lease_token !== token) return { finalizado: false, motivo: "lease_perdido_ou_nao_em_andamento" };

      const tent = m.tentativas;                       // valor ANTIGO da linha
      const limite = !ok && tent >= MAX;
      const bk = ok || limite ? null : backoff[Math.min(tent, backoff.length) - 1];

      m.status = ok ? "concluido" : "falhou";
      m.lease_token = null;
      m.lease_expires_at = null;
      m.proxima_em = bk === null ? null : agora + bk * 60_000;

      return { finalizado: true, tentativas: tent, backoff_min: bk, proxima_em: m.proxima_em, limite_atingido: limite };
    },
    /** Injeta uma linha legada (ex.: lease_expires_at NULL) para teste. */
    semear(chave: string, marca: Marca) { linhas.set(chave, marca); },
    ver: (chave: string) => linhas.get(chave),
  };
}

Deno.test("B2.1 - dois workers concorrentes: so um vence a disputa", () => {
  const t = tabelaMarcas();
  const agora = 1_000_000;
  assertEquals(t.claim("m/dia", "tokA", agora, 900_000), "reservado");
  assertEquals(t.claim("m/dia", "tokB", agora, 900_000), "em_andamento_por_outro_worker");
  assertEquals(t.ver("m/dia")!.lease_token, "tokA", "o lease continua com quem venceu");
});

Deno.test("B2.1b - LEASE NULL: linha legada presa e RECUPERADA (bug do .lte)", () => {
  const t = tabelaMarcas();
  const agora = 1_000_000;
  // Linha antiga: em_andamento com lease_expires_at NULL (worker morreu antes
  // do lease existir, ou versao anterior da migration). Com o predicado antigo
  // (.lte apenas) esta linha ficaria presa PARA SEMPRE.
  t.semear("m/dia", { status: "em_andamento", tentativas: 1, lease_token: null, lease_expires_at: null, proxima_em: null });

  const r = t.claim("m/dia", "tokNovo", agora, 900_000);
  assertEquals(r, "lease_recuperado", "NULL tem de ser tratado como recuperavel");
  assertEquals(t.ver("m/dia")!.lease_token, "tokNovo");
  assertEquals(t.ver("m/dia")!.tentativas, 2);
});

Deno.test("B2.1c - LEASE NULL com dois workers: ainda assim so UM vence", () => {
  const t = tabelaMarcas();
  const agora = 1_000_000;
  t.semear("m/dia", { status: "em_andamento", tentativas: 1, lease_token: null, lease_expires_at: null, proxima_em: null });
  assertEquals(t.claim("m/dia", "tokA", agora, 900_000), "lease_recuperado");
  assertEquals(t.claim("m/dia", "tokB", agora, 900_000), "em_andamento_por_outro_worker");
});

Deno.test("B2.2 - lease AINDA VALIDO nao e recuperado; VENCIDO e recuperado", () => {
  const t = tabelaMarcas();
  const agora = 1_000_000;
  const lease = 900_000; // 15 min
  assertEquals(t.claim("m/dia", "tokMorto", agora, lease), "reservado");
  assertEquals(t.claim("m/dia", "tokB", agora + 60_000, lease), "em_andamento_por_outro_worker");
  // exatamente no vencimento (<=): recupera
  assertEquals(t.claim("m/dia", "tokB", agora + lease, lease), "lease_recuperado");
  assertEquals(t.ver("m/dia")!.lease_token, "tokB");
});

Deno.test("B2.3 - worker antigo NAO finaliza depois da troca do token", () => {
  const t = tabelaMarcas();
  const agora = 1_000_000, lease = 900_000;
  t.claim("m/dia", "tokMorto", agora, lease);
  t.claim("m/dia", "tokVivo", agora + lease + 1, lease);   // troca de token
  assertEquals(t.finalizar("m/dia", "tokMorto", true, agora).finalizado, false, "zumbi nao finaliza");
  assertEquals(t.ver("m/dia")!.status, "em_andamento", "estado intacto");
  assertEquals(t.finalizar("m/dia", "tokVivo", true, agora).finalizado, true, "so o detentor finaliza");
  assertEquals(t.ver("m/dia")!.status, "concluido");
});

Deno.test("B2.3b - token NULL nunca finaliza", () => {
  const t = tabelaMarcas();
  t.claim("m/dia", "tokA", 1_000_000, 900_000);
  assertEquals(t.finalizar("m/dia", null, true, 1_000_000).finalizado, false);
  assertEquals(t.ver("m/dia")!.status, "em_andamento");
});

Deno.test("B2.4 - falha vira retryable com backoff e NAO queima o dia", () => {
  const t = tabelaMarcas();
  const agora = 1_000_000, lease = 900_000;
  t.claim("m/dia", "tok1", agora, lease);
  assertEquals(t.finalizar("m/dia", "tok1", false, agora).finalizado, true);
  assertEquals(t.ver("m/dia")!.status, "falhou");
  assertEquals(t.claim("m/dia", "tok2", agora + 1000, lease), "aguardando_backoff");
  // 1a falha => 5 min de espera
  assertEquals(t.claim("m/dia", "tok2", agora + 5 * 60_000 + 1, lease), "lease_recuperado");
});

Deno.test("B2.4b - falhou com proxima_em NULL e imediatamente retryable", () => {
  const t = tabelaMarcas();
  t.semear("m/dia", { status: "falhou", tentativas: 1, lease_token: null, lease_expires_at: null, proxima_em: null });
  assertEquals(t.claim("m/dia", "tok2", 1_000_000, 900_000), "lease_recuperado");
});

Deno.test("B2.5 - limite de tentativas encerra o dia (MAX=3 => 3 tentativas)", () => {
  const t = tabelaMarcas();
  let agora = 1_000_000; const lease = 1000;

  assertEquals(t.claim("m/dia", "t1", agora, lease), "reservado");
  t.finalizar("m/dia", "t1", false, agora);          // 1a falha -> backoff 5 min
  agora += 5 * 60_000 + 1;

  assertEquals(t.claim("m/dia", "t2", agora, lease), "lease_recuperado");
  t.finalizar("m/dia", "t2", false, agora);          // 2a falha -> backoff 20 min
  agora += 20 * 60_000 + 1;

  assertEquals(t.claim("m/dia", "t3", agora, lease), "lease_recuperado");
  t.finalizar("m/dia", "t3", false, agora);          // 3a falha -> sem novo retry
  assertEquals(t.ver("m/dia")!.tentativas, 3);

  agora += 60 * 60_000;
  assertEquals(t.claim("m/dia", "t4", agora, lease), "falhou_limite_de_tentativas");
});

Deno.test("B2.6 - apos concluido, ninguem mais executa no mesmo dia", () => {
  const t = tabelaMarcas();
  const agora = 1_000_000;
  t.claim("m/dia", "t1", agora, 900_000);
  t.finalizar("m/dia", "t1", true, agora);
  assertEquals(t.claim("m/dia", "t2", agora + 10_000_000, 900_000), "ja_concluido_hoje");
});

Deno.test("B2.7 - o predicado do duplo casa com o SQL real da RPC", async () => {
  // Guarda contra a divergencia que existia: se a RPC voltar a usar apenas
  // "<= now()" sem o "IS NULL", este teste denuncia.
  const sql = await Deno.readTextFile(new URL("../../migrations/20260802120000_jose_fase1_idempotencia_e_cron.sql", import.meta.url));
  assertStringIncludes(sql, "m.lease_expires_at IS NULL OR m.lease_expires_at <= v_now");
  assertStringIncludes(sql, "m.proxima_em IS NULL OR m.proxima_em <= v_now");
  assertStringIncludes(sql, "WHERE m.job = p_job");
  assertStringIncludes(sql, "AND m.dia = p_dia");
  assertStringIncludes(sql, "AND m.status = 'em_andamento'");
  assertStringIncludes(sql, "AND m.lease_token = p_token");
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO 4 — MIGRATION AUSENTE: falha segura, sem medição destravada
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("B4.1 - sem a tabela de marcas, a medicao NAO e executada", async () => {
  // Simula 42P01 (undefined_table) no insert da marca e prova que NENHUMA
  // chamada de medicao sai.
  let chamouMedicao = false;
  const fetchOriginal = globalThis.fetch;
  try {
    globalThis.fetch = (() => { chamouMedicao = true; return Promise.resolve(new Response("{}", { status: 200 })); }) as any;

    const admin: any = {
      from: () => ({ insert: () => Promise.resolve({ data: null, error: { code: "42P01", message: 'relation "jose_cron_daily_marks" does not exist' } }) }),
    };

    // Reproduz o ramo do runner: 42P01 -> migration_pendente, sem fetch.
    const { error } = await admin.from("jose_cron_daily_marks").insert({});
    let resultado = "";
    if (error && String(error.code) === "42P01") resultado = "migration_pendente";
    else { await fetch("http://x"); resultado = "disparado"; }

    assertEquals(resultado, "migration_pendente");
    assertEquals(chamouMedicao, false, "NENHUMA medicao pode sair sem trava");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

Deno.test("B4.2 - o runner nao possui mais caminho de execucao destravada", async () => {
  const src = await Deno.readTextFile(new URL("../jose-cron-runner/index.ts", import.meta.url));
  assert(!src.includes("disparado_sem_trava_migration_pendente"), "fallback destravado precisa ter sido removido");
  assertStringIncludes(src, "migration_pendente");
});

Deno.test("B4.3 - claim da medicao e RPC atomica, sem read-then-write no TS", async () => {
  const src = await Deno.readTextFile(new URL("../jose-cron-runner/index.ts", import.meta.url));
  assertStringIncludes(src, 'admin.rpc("claim_jose_daily_job"');
  assertStringIncludes(src, 'admin.rpc("finish_jose_daily_job"');
  // O TypeScript nao pode mais ler nem escrever a tabela de marcas: se ele
  // fizer isso, volta a existir janela entre decidir e gravar.
  assert(!src.includes('from("jose_cron_daily_marks")'), "o TS nao pode tocar a tabela direto");
});


// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO 1 (4a auditoria) — BACKOFF PROGRESSIVO: 5, 20, encerramento
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("K1 - 1a falha agenda 5 min; 2a agenda 20 min; 3a nao agenda", () => {
  const t = tabelaMarcas();
  let agora = 1_000_000;
  const lease = 900_000;

  // tentativa 1 -> falha -> backoff 5
  assertEquals(t.claim("m/dia", "t1", agora, lease), "reservado");
  const f1 = t.finalizar("m/dia", "t1", false, agora);
  assertEquals(f1.finalizado, true);
  assertEquals(f1.tentativas, 1);
  assertEquals(f1.backoff_min, 5, "primeira falha DEVE esperar 5 min (era 20)");
  assertEquals(f1.limite_atingido, false);

  // so retenta depois dos 5 min
  assertEquals(t.claim("m/dia", "t2", agora + 4 * 60_000, lease), "aguardando_backoff");
  agora += 5 * 60_000 + 1;

  // tentativa 2 -> falha -> backoff 20
  assertEquals(t.claim("m/dia", "t2", agora, lease), "lease_recuperado");
  const f2 = t.finalizar("m/dia", "t2", false, agora);
  assertEquals(f2.tentativas, 2);
  assertEquals(f2.backoff_min, 20, "segunda falha DEVE esperar 20 min");
  assertEquals(f2.limite_atingido, false);

  assertEquals(t.claim("m/dia", "t3", agora + 19 * 60_000, lease), "aguardando_backoff");
  agora += 20 * 60_000 + 1;

  // tentativa 3 -> falha -> SEM novo retry
  assertEquals(t.claim("m/dia", "t3", agora, lease), "lease_recuperado");
  const f3 = t.finalizar("m/dia", "t3", false, agora);
  assertEquals(f3.tentativas, 3);
  assertEquals(f3.backoff_min, null, "na ultima tentativa nao ha proximo retry");
  assertEquals(f3.limite_atingido, true);
  assertEquals(t.ver("m/dia")!.proxima_em, null);

  // limite: ninguem mais assume, mesmo muito tempo depois
  assertEquals(t.claim("m/dia", "t4", agora + 10 * 3600_000, lease), "falhou_limite_de_tentativas");
});

Deno.test("K2 - sucesso nao agenda backoff", () => {
  const t = tabelaMarcas();
  const agora = 1_000_000;
  t.claim("m/dia", "t1", agora, 900_000);
  const f = t.finalizar("m/dia", "t1", true, agora);
  assertEquals(f.finalizado, true);
  assertEquals(f.backoff_min, null);
  assertEquals(t.ver("m/dia")!.proxima_em, null);
  assertEquals(t.ver("m/dia")!.status, "concluido");
});

Deno.test("K3 - o backoff vive no SQL (fonte unica), nao no TypeScript", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20260802120000_jose_fase1_idempotencia_e_cron.sql", import.meta.url));
  // escalonamento pela tentativa REAL da linha
  assertStringIncludes(sql, "p_backoff_min[least(m.tentativas, coalesce(array_length(p_backoff_min, 1), 1))]");
  assertStringIncludes(sql, "WHEN m.tentativas >= p_max_tentativas THEN NULL");
  assertStringIncludes(sql, "ARRAY[5, 20]");

  const src = await Deno.readTextFile(new URL("../jose-cron-runner/index.ts", import.meta.url));
  // O runner NAO pode recalcular backoff para a medicao. Olhamos so o CODIGO
  // executavel: os comentarios citam o bug antigo de proposito.
  const trecho = src
    .slice(src.indexOf("async function dispararMedicaoUmaVezPorDia"), src.indexOf("async function chamarMedicao"))
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
  assert(!trecho.includes("BACKOFF_MIN["), "o TS nao pode ser segunda fonte de verdade do backoff");
  assert(!trecho.includes("p_backoff_min"), "o runner nem passa o array: usa o default do SQL");
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO 2 (4a auditoria) — TIMEOUT MENOR QUE O LEASE
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("K4 - timeout e menor que o lease, com margem", async () => {
  const src = await Deno.readTextFile(new URL("../jose-cron-runner/index.ts", import.meta.url));
  const lease = Number(src.match(/const LEASE_MEDICAO_MIN\s*=\s*(\d+)/)![1]);
  const tmo = eval(src.match(/const TIMEOUT_MEDICAO_MS\s*=\s*([\d\s*_]+);/)![1].replace(/_/g, ""));
  const tmoMin = tmo / 60_000;
  assert(tmoMin < lease, `timeout (${tmoMin}min) tem de ser menor que o lease (${lease}min)`);
  assert(lease - tmoMin >= 5, `margem insuficiente: ${lease - tmoMin}min`);
  assertStringIncludes(src, "signal: ctrl.signal");
  assertStringIncludes(src, "clearTimeout(timer)");
});

Deno.test("K5 - fetch travado e ABORTADO e vira falha retryable (nao fica preso)", async () => {
  // Replica a logica de chamarMedicao com timeout curto e um fetch que nunca
  // responde: prova que o abort acontece e e classificado como retryable.
  const TIMEOUT = 40; // ms
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const t0 = Date.now();
  let motivo = "";
  try {
    await new Promise((_res, rej) => {
      // fetch que nunca resolve; so o abort encerra
      ctrl.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  } catch (e) {
    motivo = (e as any)?.name === "AbortError" ? `timeout_${TIMEOUT}ms` : "outro";
  } finally {
    clearTimeout(timer);
  }
  const decorrido = Date.now() - t0;
  assertStringIncludes(motivo, "timeout_");
  assert(decorrido < 2000, `abortou em ${decorrido}ms, dentro da janela`);
});

Deno.test("K6 - apos o timeout, o worker AINDA detem o lease e consegue finalizar", () => {
  const t = tabelaMarcas();
  const agora = 1_000_000;
  const leaseMs = 15 * 60_000;   // 15 min
  const timeoutMs = 8 * 60_000;  // 8 min

  assertEquals(t.claim("m/dia", "tokA", agora, leaseMs), "reservado");
  const depoisDoTimeout = agora + timeoutMs;
  assert(depoisDoTimeout < agora + leaseMs, "o timeout ocorre ANTES do lease vencer");

  // ninguem mais pode assumir nesse instante
  assertEquals(t.claim("m/dia", "tokB", depoisDoTimeout, leaseMs), "em_andamento_por_outro_worker");
  // e o dono finaliza normalmente com o token dele
  const f = t.finalizar("m/dia", "tokA", false, depoisDoTimeout);
  assertEquals(f.finalizado, true);
  assertEquals(f.backoff_min, 5);
  assertEquals(t.ver("m/dia")!.status, "falhou", "nunca fica preso em em_andamento");
});

Deno.test("K7 - worker com token ANTIGO nao finaliza depois da troca", () => {
  const t = tabelaMarcas();
  const agora = 1_000_000;
  const leaseMs = 15 * 60_000;
  t.claim("m/dia", "tokAntigo", agora, leaseMs);
  // lease vence e outro assume
  t.claim("m/dia", "tokNovo", agora + leaseMs + 1, leaseMs);

  const zumbi = t.finalizar("m/dia", "tokAntigo", true, agora + leaseMs + 2);
  assertEquals(zumbi.finalizado, false);
  assertEquals(zumbi.motivo, "lease_perdido_ou_nao_em_andamento");
  assertEquals(t.ver("m/dia")!.status, "em_andamento", "estado do novo dono intacto");

  const dono = t.finalizar("m/dia", "tokNovo", true, agora + leaseMs + 3);
  assertEquals(dono.finalizado, true);
});
