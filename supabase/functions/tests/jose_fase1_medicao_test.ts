/**
 * Concorrência REMOTA da medição de resultados (5ª auditoria).
 *
 * O cenário que os testes de lease do runner NÃO cobriam: o AbortController
 * cancela a conexão HTTP, mas a execução A continua rodando no servidor. Cinco
 * minutos depois o retry inicia a execução B. Sem claim durável por outcome, as
 * duas percorrem as MESMAS linhas.
 *
 * Comando exato:
 *   "/c/Users/User/.deno/bin/deno" test --allow-env --allow-read --no-lock \
 *     --node-modules-dir=none supabase/functions/tests/jose_fase1_medicao_test.ts
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const U = "uuuuuuuu-0000-0000-0000-000000000001";

type Outcome = {
  id: string;
  user_id: string;
  action_type: string;
  measurement_status: "pendente" | "medindo" | "medido" | "falhou";
  lease_token: string | null;
  lease_expires_at: number | null;
  measure_attempts: number;
  after_ctr: number | null;
  criado_em: number;
  lease_owner?: string | null;
  measure_retry_at?: number | null;
};

/**
 * Modelo executável de claim_apollo_outcomes / finish_apollo_outcome.
 * Replica o predicado SQL literalmente, inclusive a semântica de NULL
 * (`lease_expires_at IS NULL OR lease_expires_at <= now`).
 */
function tabelaOutcomes(linhas: Outcome[]) {
  const db = new Map(linhas.map((l) => [l.id, { ...l }]));
  return {
    claim(token: string, agora: number, leaseMs: number, limite = 50, maxTent = 3, diasMs = 7 * 86_400_000): Outcome[] {
      const elegiveis = [...db.values()]
        .filter((o) =>
          o.criado_em <= agora - diasMs &&
          o.measure_attempts < maxTent &&
          (o.measurement_status === "pendente" ||
            (o.measurement_status === "medindo" &&
              (o.lease_expires_at === null || o.lease_expires_at <= agora)) ||
            (o.measurement_status === "falhou" &&
              ((o.measure_retry_at ?? null) === null || (o.measure_retry_at as number) <= agora)))
        )
        .sort((a, b) => a.criado_em - b.criado_em)
        .slice(0, limite);

      // FOR UPDATE SKIP LOCKED: a reserva é atômica por linha.
      for (const o of elegiveis) {
        o.measurement_status = "medindo";
        o.lease_token = token;
        o.lease_expires_at = agora + leaseMs;
        o.measure_attempts += 1;
      }
      return elegiveis.map((o) => ({ ...o }));
    },
    /**
     * Espelha finish_apollo_outcome_atomic: valida token/estado, atualiza o
     * outcome E aplica o aprendizado na MESMA transacao. Se o aprendizado
     * levantar erro, TUDO e revertido (o outcome nao fica 'medido').
     */
    finish(
      id: string, token: string | null, ok: boolean,
      opts: { afterCtr?: number; agora?: number; aprender?: (u: string, a: string) => void; backoff?: number[] } = {},
    ): { finalizado: boolean; motivo?: string; aprendizado_aplicado?: boolean } {
      if (token === null) return { finalizado: false, motivo: "token_nulo", aprendizado_aplicado: false };
      const o = db.get(id);
      if (!o) return { finalizado: false, motivo: "lease_perdido_ou_nao_medindo", aprendizado_aplicado: false };
      if (o.measurement_status !== "medindo") return { finalizado: false, motivo: "lease_perdido_ou_nao_medindo", aprendizado_aplicado: false };
      if (o.lease_token !== token) return { finalizado: false, motivo: "lease_perdido_ou_nao_medindo", aprendizado_aplicado: false };

      // snapshot para "rollback" caso o aprendizado falhe
      const antes = { ...o };
      const bk = opts.backoff ?? [5, 20, 60];
      const agora = opts.agora ?? AGORA;

      o.measurement_status = ok ? "medido" : "falhou";
      if (ok && opts.afterCtr !== undefined) o.after_ctr = opts.afterCtr;
      o.lease_token = null;
      o.lease_owner = null;
      o.lease_expires_at = null;
      o.measure_retry_at = ok ? null : agora + bk[Math.min(o.measure_attempts, bk.length) - 1] * 60_000;

      let aprendeu = false;
      if (ok && opts.aprender) {
        try {
          opts.aprender(o.user_id, o.action_type);
          aprendeu = true;
        } catch (_e) {
          // MESMA TRANSACAO: desfaz o UPDATE do outcome
          db.set(id, antes);
          throw _e;
        }
      }
      return { finalizado: true, aprendizado_aplicado: ok ? aprendeu : false };
    },
    ver: (id: string) => db.get(id),
  };
}

/** Modelo de apply_apollo_learning: upsert atômico por (user, category, insight). */
function tabelaLearning() {
  const db = new Map<string, { ocorrencias: number; sucessos: number; media: number; confianca: number; linhas: number }>();
  return {
    aplicar(user: string, acao: string, outcome: string, score: number) {
      const k = `${user}|action_outcome|${acao}`;
      const at = db.get(k);
      if (!at) {
        const novo = { ocorrencias: 1, sucessos: outcome === "improved" ? 1 : 0, media: score, confianca: 0.05, linhas: 1 };
        db.set(k, novo);
        return { ...novo };
      }
      // média incremental, como no SQL
      at.media = Math.round((((at.media * at.ocorrencias) + score) / (at.ocorrencias + 1)) * 100) / 100;
      at.ocorrencias += 1;
      at.sucessos += outcome === "improved" ? 1 : 0;
      at.confianca = Math.min(1.0, at.ocorrencias * 0.05);
      return { ...at };
    },
    ver: (user: string, acao: string) => db.get(`${user}|action_outcome|${acao}`),
    totalLinhas: () => db.size,
  };
}

const AGORA = 1_000_000_000;
const DEZ_DIAS = 10 * 86_400_000;
const LEASE = 10 * 60_000;

function outcomesPendentes(n: number): Outcome[] {
  return Array.from({ length: n }, (_v, i) => ({
    id: `o${i + 1}`,
    user_id: U,
    action_type: "pause_campaign",
    measurement_status: "pendente" as const,
    lease_token: null,
    lease_expires_at: null,
    measure_attempts: 0,
    after_ctr: null,
    criado_em: AGORA - DEZ_DIAS,
    lease_owner: null,
    measure_retry_at: null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// O CENÁRIO DA AUDITORIA: A continua no servidor, B começa após o retry
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("R1 - execucao A reserva; execucao B (retry) NAO pega os mesmos outcomes", () => {
  const t = tabelaOutcomes(outcomesPendentes(3));

  // Execução A começa e reserva tudo
  const doA = t.claim("tokA", AGORA, LEASE);
  assertEquals(doA.length, 3);

  // Cliente aborta em 8 min, mas A CONTINUA no servidor.
  // O retry dispara B 5 min depois (13 min do início? não: 8+5 = 13 min > lease de 10)
  // Primeiro, dentro do lease: B nao pega nada.
  const doB = t.claim("tokB", AGORA + 5 * 60_000, LEASE);
  assertEquals(doB.length, 0, "B nao pode processar os mesmos outcomes que A detem");
});

Deno.test("R2 - somente UMA execucao finaliza cada outcome", () => {
  const t = tabelaOutcomes(outcomesPendentes(1));
  t.claim("tokA", AGORA, LEASE);

  // A (ainda viva no servidor) finaliza
  assertEquals(t.finish("o1", "tokA", true, { afterCtr: 2.0 }).finalizado, true);
  // B tenta finalizar o mesmo: nao altera
  assertEquals(t.finish("o1", "tokB", true, { afterCtr: 9.9 }).finalizado, false);
  assertEquals(t.ver("o1")!.after_ctr, 2.0, "o valor de A permanece");
});

Deno.test("R3 - apos o lease VENCER, B assume e A (zumbi) nao finaliza mais", () => {
  const t = tabelaOutcomes(outcomesPendentes(1));
  t.claim("tokA", AGORA, LEASE);

  // A travou; passou o lease -> B assume
  const depois = AGORA + LEASE + 1;
  const doB = t.claim("tokB", depois, LEASE);
  assertEquals(doB.length, 1, "lease vencido tem de ser recuperavel");

  // A volta a vida e tenta gravar: NAO consegue
  const zumbi = t.finish("o1", "tokA", true, { afterCtr: 9.9 });
  assertEquals(zumbi.finalizado, false);
  assertEquals(zumbi.motivo, "lease_perdido_ou_nao_medindo");
  assertEquals(t.ver("o1")!.after_ctr, null, "nada do zumbi foi gravado");

  // B finaliza normalmente
  assertEquals(t.finish("o1", "tokB", true, { afterCtr: 2.0 }).finalizado, true);
  assertEquals(t.ver("o1")!.after_ctr, 2.0);
});

Deno.test("R4 - lease VALIDO nao e roubado", () => {
  const t = tabelaOutcomes(outcomesPendentes(1));
  t.claim("tokA", AGORA, LEASE);
  assertEquals(t.claim("tokB", AGORA + LEASE - 1, LEASE).length, 0, "dentro da validade ninguem assume");
});

Deno.test("R5 - lease NULL em 'medindo' e recuperado (linha legada)", () => {
  const t = tabelaOutcomes([{
    id: "o1", user_id: U, action_type: "pause_campaign",
    measurement_status: "medindo", lease_token: null, lease_expires_at: null,
    measure_attempts: 1, after_ctr: null, criado_em: AGORA - DEZ_DIAS,
  }]);
  assertEquals(t.claim("tokB", AGORA, LEASE).length, 1, "NULL conta como recuperavel");
});

Deno.test("R6 - token NULL nunca finaliza", () => {
  const t = tabelaOutcomes(outcomesPendentes(1));
  t.claim("tokA", AGORA, LEASE);
  const r = t.finish("o1", null, true, { afterCtr: 5 });
  assertEquals(r.finalizado, false);
  assertEquals(r.motivo, "token_nulo");
});

Deno.test("R7 - 'medido' nao volta para a fila", () => {
  const t = tabelaOutcomes(outcomesPendentes(1));
  t.claim("tokA", AGORA, LEASE);
  t.finish("o1", "tokA", true, { afterCtr: 2.0 });
  assertEquals(t.claim("tokB", AGORA + 10 * 3600_000, LEASE).length, 0);
});

Deno.test("R8 - limite de tentativas tira o outcome da fila", () => {
  const t = tabelaOutcomes([{
    id: "o1", user_id: U, action_type: "pause_campaign",
    measurement_status: "falhou", lease_token: null, lease_expires_at: null,
    measure_attempts: 3, after_ctr: null, criado_em: AGORA - DEZ_DIAS,
  }]);
  assertEquals(t.claim("tokA", AGORA, LEASE).length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// APRENDIZADO: incremento único e média que não se perde
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("R9 - apollo_learning incrementa UMA vez por medicao confirmada", () => {
  const l = tabelaLearning();
  l.aplicar(U, "pause_campaign", "improved", 40);
  const r = l.aplicar(U, "pause_campaign", "improved", 60);
  assertEquals(r.ocorrencias, 2, "duas medicoes = duas ocorrencias, nunca quatro");
  assertEquals(r.sucessos, 2);
  assertEquals(r.media, 50, "media incremental (40,60) = 50");
  assertEquals(l.totalLinhas(), 1, "upsert por chave unica: uma linha por padrao");
});

Deno.test("R10 - duas execucoes concorrentes NAO perdem atualizacao da media", () => {
  // Com read-then-write, A e B liam media=40/n=1 e ambos gravavam n=2 -> perda.
  // Com INSERT ... ON CONFLICT DO UPDATE cada chamada aplica sobre o valor
  // corrente, entao o resultado e o mesmo de duas chamadas sequenciais.
  const l = tabelaLearning();
  l.aplicar(U, "pause_campaign", "improved", 40);   // execucao A
  l.aplicar(U, "pause_campaign", "declined", 10);   // execucao B (concorrente)
  const v = l.ver(U, "pause_campaign")!;
  assertEquals(v.ocorrencias, 2, "nenhuma atualizacao perdida");
  assertEquals(v.sucessos, 1);
  assertEquals(v.media, 25, "(40 + 10) / 2");
});

Deno.test("R11 - confianca cresce com a amostra e tem teto", () => {
  const l = tabelaLearning();
  for (let i = 0; i < 25; i++) l.aplicar(U, "pause_campaign", "improved", 50);
  const v = l.ver(U, "pause_campaign")!;
  assertEquals(v.ocorrencias, 25);
  assertEquals(v.confianca, 1, "teto em 1.0");
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTADOR REPRESENTA PERSISTÊNCIA REAL
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("R12 - erro no update NAO contabiliza 'medido'", () => {
  // Espelha o contrato do TS: so incrementa quando finish devolve finalizado=true.
  const t = tabelaOutcomes(outcomesPendentes(2));
  t.claim("tokA", AGORA, LEASE);

  let medidos = 0;
  for (const id of ["o1", "o2"]) {
    // simula o segundo outcome tendo o lease roubado no meio do caminho
    if (id === "o2") { t.ver("o2")!.lease_token = "outro"; }
    const r = t.finish(id, "tokA", true, { afterCtr: 2.0 });
    if (r.finalizado) medidos++;
  }
  assertEquals(medidos, 1, "so conta o que o banco confirmou");
});

Deno.test("R13 - o codigo NAO tem mais read-then-write nem erro engolido", async () => {
  const src = await Deno.readTextFile(new URL("../apollo-measure-outcomes/index.ts", import.meta.url));
  // usa as RPCs
  assertStringIncludes(src, 'rpc("claim_apollo_outcomes"');
  assertStringIncludes(src, 'rpc("finish_apollo_outcome_atomic"');
  // o edge NAO chama mais o aprendizado separadamente: quem chama e a RPC
  assert(!src.includes('rpc("apply_apollo_learning"'), "aprendizado nao pode ser 2a transacao no edge");
  // nao le/escreve as tabelas direto
  assert(!src.includes('from("apollo_learning")'), "aprendizado nao pode ser read-then-write no TS");
  assert(!src.includes('from("apollo_action_outcomes")'), "outcomes so via RPC");
  // nada de catch vazio engolindo erro de persistencia
  assert(!/\.catch\(\(\)\s*=>\s*\{\}\)/.test(src), "catch vazio nao pode voltar");
  // sem as RPCs, falha segura
  assertStringIncludes(src, "migration_pendente");
});

Deno.test("R14 - drift: o codigo usa o schema REAL de apollo_learning", async () => {
  const src = await Deno.readTextFile(new URL("../apollo-measure-outcomes/index.ts", import.meta.url));
  // colunas inexistentes em producao nao podem aparecer
  for (const inexistente of ["pattern_type", "occurrence_count", "success_count", "avg_improvement_score", "success_rate", "confidence_score", "last_seen"]) {
    assert(!src.includes(inexistente), `coluna inexistente em producao ainda referenciada: ${inexistente}`);
  }
  const sql = await Deno.readTextFile(new URL("../../migrations/20260802140000_jose_fase1_medicao_concorrente.sql", import.meta.url));
  // a RPC grava no schema real
  assertStringIncludes(sql, "(user_id, category, insight, evidence, confidence, times_validated, is_active)");
  assertStringIncludes(sql, "ON CONFLICT (user_id, category, insight) DO UPDATE");
});


// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO 1 (6a auditoria) — FINALIZAÇÃO E APRENDIZADO ATÔMICOS
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("T1 - falha no UPSERT de aprendizado NAO deixa o outcome como medido", () => {
  const t = tabelaOutcomes(outcomesPendentes(1));
  t.claim("tokA", AGORA, LEASE);

  let estourou = false;
  try {
    t.finish("o1", "tokA", true, {
      afterCtr: 2.0,
      aprender: () => { throw new Error("upsert de aprendizado falhou"); },
    });
  } catch (_e) { estourou = true; }

  assert(estourou, "a RPC precisa propagar o erro");
  const o = t.ver("o1")!;
  assertEquals(o.measurement_status, "medindo", "o outcome NAO pode ter virado 'medido'");
  assertEquals(o.after_ctr, null, "nada foi gravado");
  assertEquals(o.lease_token, "tokA", "o lease continua com o dono para retry");
});

Deno.test("T2 - outcome e aprendizado sao persistidos JUNTOS", () => {
  const t = tabelaOutcomes(outcomesPendentes(1));
  const l = tabelaLearning();
  t.claim("tokA", AGORA, LEASE);

  const r = t.finish("o1", "tokA", true, {
    afterCtr: 2.0,
    aprender: (u, a) => { l.aplicar(u, a, "improved", 40); },
  });

  assertEquals(r.finalizado, true);
  assertEquals(r.aprendizado_aplicado, true);
  assertEquals(t.ver("o1")!.measurement_status, "medido");
  assertEquals(l.ver(U, "pause_campaign")!.ocorrencias, 1);
});

Deno.test("T3 - token vencido nao altera outcome NEM aprendizado", () => {
  const t = tabelaOutcomes(outcomesPendentes(1));
  const l = tabelaLearning();
  t.claim("tokA", AGORA, LEASE);
  t.claim("tokB", AGORA + LEASE + 1, LEASE);   // B assume

  let aprendeu = false;
  const r = t.finish("o1", "tokA", true, {
    afterCtr: 9.9,
    aprender: (u, a) => { aprendeu = true; l.aplicar(u, a, "improved", 99); },
  });

  assertEquals(r.finalizado, false);
  assertEquals(r.aprendizado_aplicado, false);
  assertEquals(aprendeu, false, "o aprendizado nem chega a ser chamado");
  assertEquals(l.totalLinhas(), 0);
  assertEquals(t.ver("o1")!.after_ctr, null);
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO 2 — CLAIM INCREMENTAL: nada fica pré-reservado esperando
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("T4 - reserva 1 por vez: nenhum item fica esperando na fila interna", () => {
  const t = tabelaOutcomes(outcomesPendentes(5));
  let agora = AGORA;

  // Laco do edge: reserva 1, processa, finaliza, repete.
  for (let i = 0; i < 5; i++) {
    const lote = t.claim("tokA", agora, LEASE, 1);   // p_limit = 1
    assertEquals(lote.length, 1, "so um item por vez");
    // durante o processamento, os OUTROS continuam livres (nao reservados)
    const reservadosAgora = [...Array(5)].map((_v, k) => t.ver(`o${k + 1}`)!)
      .filter((o) => o.measurement_status === "medindo").length;
    assertEquals(reservadosAgora, 1, "nunca ha mais de um item reservado");
    agora += 60_000;                                  // chamada a Meta ~60s
    t.finish(lote[0].id, "tokA", true, { afterCtr: 2.0, agora });
  }
  assertEquals([...Array(5)].map((_v, k) => t.ver(`o${k + 1}`)!.measurement_status)
    .every((st) => st === "medido"), true);
});

Deno.test("T5 - duas execucoes NAO fazem duas chamadas externas para o mesmo outcome", () => {
  const t = tabelaOutcomes(outcomesPendentes(2));
  const chamadasMeta: string[] = [];
  let agora = AGORA;

  // Execucao A pega o primeiro
  const a1 = t.claim("tokA", agora, LEASE, 1);
  chamadasMeta.push(a1[0].id);

  // Execucao B (retry, 60s depois) — pega o SEGUNDO, nunca o mesmo
  agora += 60_000;
  const b1 = t.claim("tokB", agora, LEASE, 1);
  chamadasMeta.push(b1[0].id);

  assert(a1[0].id !== b1[0].id, "execucoes concorrentes pegam itens diferentes");
  assertEquals(new Set(chamadasMeta).size, chamadasMeta.length, "nenhuma campanha recebeu duas chamadas");
});

Deno.test("T6 - com lease curto, o item processado ainda pertence ao worker", () => {
  // O problema antigo: 50 itens com lease de 10 min e 60s por item -> o item 11
  // ja estaria fora do lease. Com claim de 1, o lease so corre durante o item.
  const t = tabelaOutcomes(outcomesPendentes(1));
  const leaseCurto = 5 * 60_000;
  t.claim("tokA", AGORA, leaseCurto, 1);
  const aposMeta = AGORA + 60_000;             // 1 chamada de 60s
  assert(aposMeta < AGORA + leaseCurto, "o item termina bem dentro do lease");
  assertEquals(t.finish("o1", "tokA", true, { afterCtr: 2.0, agora: aposMeta }).finalizado, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO 3 — BACKOFF DE FALHAS
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("T7 - falha agenda measure_retry_at e o claim respeita (5, 20, 60)", () => {
  const t = tabelaOutcomes(outcomesPendentes(1));
  let agora = AGORA;

  // 1a falha -> 5 min
  t.claim("tokA", agora, LEASE, 1);
  t.finish("o1", "tokA", false, { agora });
  assertEquals(t.ver("o1")!.measurement_status, "falhou");
  assertEquals(t.ver("o1")!.measure_retry_at, agora + 5 * 60_000);
  assertEquals(t.claim("tokA", agora + 60_000, LEASE, 1).length, 0, "dentro do backoff nao reserva");

  // 2a falha -> 20 min
  agora += 5 * 60_000;
  assertEquals(t.claim("tokA", agora, LEASE, 1).length, 1, "passado o backoff, reserva");
  t.finish("o1", "tokA", false, { agora });
  assertEquals(t.ver("o1")!.measure_retry_at, agora + 20 * 60_000);

  // 3a falha -> 60 min
  agora += 20 * 60_000;
  assertEquals(t.claim("tokA", agora, LEASE, 1).length, 1);
  t.finish("o1", "tokA", false, { agora });
  assertEquals(t.ver("o1")!.measure_retry_at, agora + 60 * 60_000);

  // limite de tentativas: nao reserva mais
  agora += 60 * 60_000;
  assertEquals(t.claim("tokA", agora, LEASE, 1).length, 0, "3 tentativas esgotadas");
});

Deno.test("T8 - conclusao limpa lease e retry", () => {
  const t = tabelaOutcomes(outcomesPendentes(1));
  t.claim("tokA", AGORA, LEASE, 1);
  t.finish("o1", "tokA", true, { afterCtr: 2.0, agora: AGORA });
  const o = t.ver("o1")!;
  assertEquals(o.lease_token, null);
  assertEquals(o.lease_owner, null);
  assertEquals(o.lease_expires_at, null);
  assertEquals(o.measure_retry_at, null, "sucesso nao agenda retry");
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO 4 — VOCABULÁRIO
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("T9 - vocabulario 'declined' permanece; 'worsened' nao aparece", async () => {
  const src = await Deno.readTextFile(new URL("../apollo-measure-outcomes/index.ts", import.meta.url));
  const sql = await Deno.readTextFile(new URL("../../migrations/20260802140000_jose_fase1_medicao_concorrente.sql", import.meta.url));
  assertStringIncludes(src, '"declined"');
  assert(!src.includes("worsened"), "vocabulario divergente no edge");
  assert(!sql.includes("worsened"), "vocabulario divergente na migration");
  assertStringIncludes(sql, "improved | neutral | declined");
});

Deno.test("T10 - a RPC atomica existe e o aprendizado roda DENTRO dela", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20260802140000_jose_fase1_medicao_concorrente.sql", import.meta.url));
  assertStringIncludes(sql, "CREATE OR REPLACE FUNCTION public.finish_apollo_outcome_atomic");
  assertStringIncludes(sql, "v_aprend := public.apply_apollo_learning(v_user, v_acao, p_outcome, p_score);");
  // Sem EXCEPTION dentro da atomica: o erro tem de propagar e reverter tudo.
  // Olhamos so o CODIGO executavel — o comentario da funcao cita "EXCEPTION"
  // de proposito, para explicar por que ele nao existe ali.
  const corpo = sql
    .slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.finish_apollo_outcome_atomic"),
           sql.indexOf("REVOKE ALL ON FUNCTION public.finish_apollo_outcome_atomic"))
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  assert(!corpo.includes("EXCEPTION"), "a atomica nao pode capturar erro: isso quebraria a atomicidade");
  assertStringIncludes(corpo, "'aprendizado_aplicado'");
});
