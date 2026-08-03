import { createClient } from "npm:@supabase/supabase-js@2";
import { requireInternalCaller, internalAuthDenied } from "../_shared/jose-v2/internalAuth.ts";

const RUNNER_VERSION = "fase2-lease-retry-v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jose-internal-secret, x-jose-ts, x-jose-nonce",
};

/**
 * jose-cron-runner — agendador do José (chamado pelo pg_cron a cada minuto)
 *
 * ─── O QUE MUDOU (Fase 1 + Fase 2) ─────────────────────────────────────────
 *
 * 1) AUTENTICAÇÃO. Antes decodificava o JWT com `atob` e confiava no claim
 *    `role: "service_role"` — sem verificar assinatura. Qualquer um forjava o
 *    token e ganhava execução privilegiada. Agora: comparação em tempo
 *    constante contra o segredo real (internalAuth), sem decodificar nada.
 *
 * 2) next_run_at NÃO PULA MAIS O DIA. O código antigo empurrava next_run_at
 *    para o dia seguinte ANTES de chamar o agente (para evitar execução
 *    duplicada). Efeito colateral: qualquer falha custava 24h de relatório ao
 *    cliente, em silêncio. Agora usamos um LEASE CURTO: a reserva empurra
 *    next_run_at só por LEASE_MIN minutos — tempo suficiente para nenhum outro
 *    tick pegar o mesmo tenant — e o horário definitivo só é gravado DEPOIS de
 *    saber o resultado.
 *
 * 3) response.ok E CORPO são conferidos. Antes fazia `.json().catch(()=>({}))`
 *    e reportava `status:"ok"` mesmo com 401/500 da Meta ou do agente.
 *
 * 4) RETRY COM BACKOFF E LIMITE, com status/tentativa/erro/duração
 *    persistidos em apollo_cron_config + histórico em jose_cron_runs.
 *
 * 5) PRÉ-REQUISITOS VALIDADOS ANTES de gastar chamada: conta Meta, token e
 *    destinatário do relatório. Sem isso, registra 'skipped' com o motivo em
 *    vez de falhar silenciosamente.
 *
 * 6) apollo-measure-outcomes roda 1x/dia de verdade (trava em
 *    jose_cron_daily_marks). Antes era `utcHour === 6` sem marcador — com o
 *    runner rodando a cada minuto, disparava até 60x na mesma hora.
 *
 * COMPATIBILIDADE: as colunas de status são novas (migration
 * 20260802120000). Enquanto a migration não for aplicada, as gravações extras
 * degradam para o comportamento antigo em vez de quebrar o cron.
 */

const LEASE_MIN = 10;          // janela da reserva enquanto o agente trabalha
const MAX_ATTEMPTS = 3;        // tentativas antes de desistir do dia
const BACKOFF_MIN = [5, 20];   // espera após 1ª e 2ª falha (minutos)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const auth = await requireInternalCaller(req, { admin });
  if (!auth.ok) return internalAuthDenied(auth, corsHeaders);

  const now = new Date().toISOString();
  const functionsUrl = Deno.env.get("SUPABASE_URL")!.replace(".supabase.co", ".supabase.co/functions/v1");

  // ORDER BY next_run_at: sem isso, com mais de 20 tenants vencidos o conjunto
  // processado era arbitrário e alguém podia nunca ser atendido (starvation).
  const { data: dueUsers, error: dueErr } = await admin
    .from("apollo_cron_config")
    .select("*")
    .eq("is_enabled", true)
    .lte("next_run_at", now)
    .order("next_run_at", { ascending: true })
    .limit(20);

  // Erro de leitura NÃO pode ser engolido: sem isso o runner "termina bem" com
  // zero tenants processados e ninguém percebe que o agendador parou.
  if (dueErr) {
    console.error("[jose-cron-runner] falha lendo apollo_cron_config:", dueErr.message ?? dueErr.code);
    return new Response(JSON.stringify({
      ok: false, runner_version: RUNNER_VERSION, erro: "falha_lendo_configuracao",
      detalhe: String(dueErr.message ?? dueErr.code),
    }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: any[] = [];

  for (const config of (dueUsers || [])) {
    const t0 = Date.now();
    const tentativa = Number(config.attempt_count || 0) + 1;
    let runId: string | null = null;
    let leaseToken: string | null = null;

    try {
      // ── 1) RESERVA CURTA (lease) com TOKEN do worker ─────────────────────
      // O token identifica QUEM reservou. Toda gravação posterior é condicional
      // a ele: se este lease vencer e outro tick assumir o tenant, este worker
      // não consegue mais escrever — some o risco de um retardatário
      // sobrescrever o estado de quem está trabalhando agora.
      leaseToken = crypto.randomUUID();
      const leaseAte = new Date(Date.now() + LEASE_MIN * 60_000).toISOString();
      const { data: claimed, error: claimErr } = await patchConfig(admin, config.user_id, now, {
        last_run_at: now,
        next_run_at: leaseAte,
        updated_at: now,
      }, {
        last_status: "running",
        attempt_count: tentativa,
        last_runner_version: RUNNER_VERSION,
        lease_token: leaseToken,
        lease_expires_at: leaseAte,
      });
      if (claimErr) {
        // Não dá para saber se reservamos: NÃO seguimos (poderia duplicar).
        console.error("[jose-cron-runner] falha no claim de", config.user_id, claimErr.message ?? claimErr.code);
        results.push({ user_id: config.user_id, status: "claim_falhou", erro: String(claimErr.message ?? claimErr.code) });
        continue;
      }
      if (!claimed || claimed.length === 0) continue; // outro tick já reservou

      runId = await abrirRun(admin, config.user_id, "daily_report", tentativa, leaseToken);

      // ── 2) PRÉ-REQUISITOS (antes de gastar qualquer chamada) ─────────────
      // ATENCAO: NAO usar .single()/.maybeSingle() aqui. Um tenant pode ter
      // VARIAS contas Meta ativas (a Icom tem 10) e ambos estouram com
      // "multiple rows returned" — o `data` volta null e o tenant era
      // silenciosamente pulado. O relatorio diario da Icom estava quebrado por
      // isso, sem ninguem perceber. Escolha DETERMINISTICA da primeira conta,
      // mesmo criterio de getMetaTokenForUser no apollo-agent.
      const { data: contas, error: contaErr } = await admin
        .from("ad_accounts")
        .select("account_id, access_token_encrypted")
        .eq("user_id", config.user_id)
        .eq("platform", "meta")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1);
      if (contaErr) {
        console.error("[jose-cron-runner] erro lendo ad_accounts de", config.user_id, contaErr.message ?? contaErr.code);
      }
      const account = (contas || [])[0] ?? null;

      const faltando: string[] = [];
      if (!account) faltando.push("conta_meta_ativa");
      else if (!account.access_token_encrypted) faltando.push("token_meta");
      if (config.send_daily_report && !config.whatsapp_report_number) faltando.push("numero_destinatario");

      if (faltando.length > 0) {
        // Config incompleta não é erro transitório: não adianta repetir hoje.
        await finalizar(admin, config, {
          status: "skipped",
          erro: `pre_requisito_ausente:${faltando.join(",")}`,
          httpStatus: null,
          duracao: Date.now() - t0,
          proximo: computeNextRun(config.run_hour, config.run_minute, config.timezone),
          zerarTentativas: true,
        }, runId, leaseToken);
        results.push({ user_id: config.user_id, status: "skipped", faltando });
        continue;
      }

      // ── 3) CHAMA O AGENTE ────────────────────────────────────────────────
      // auto_execute NÃO é decidido aqui nem no cliente: o apollo-agent lê a
      // configuração do banco. Mandamos só o escopo do trabalho.
      const response = await fetch(`${functionsUrl}/apollo-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "x-apollo-cron": "true",
          "x-user-id": config.user_id,
        },
        body: JSON.stringify({
          targetAccountId: account!.account_id,
          datePreset: config.date_preset || "last_7d",
        }),
      });

      const raw = await response.text();
      let data: any = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* corpo não-JSON */ }

      // ── 4) SUCESSO EXIGE PROVA: status HTTP **e** corpo coerente ─────────
      const corpoOk = data && data.error == null && data.ok !== false;
      const sucesso = response.ok && corpoOk;

      if (!sucesso) {
        const motivo = !response.ok
          ? `http_${response.status}`
          : `corpo_invalido:${String(data?.error || "sem_conteudo_util").slice(0, 200)}`;

        const podeRepetir = tentativa < MAX_ATTEMPTS;
        const espera = BACKOFF_MIN[Math.min(tentativa - 1, BACKOFF_MIN.length - 1)];
        await finalizar(admin, config, {
          status: podeRepetir ? "retrying" : "failed",
          erro: motivo,
          httpStatus: response.status,
          duracao: Date.now() - t0,
          proximo: podeRepetir
            ? new Date(Date.now() + espera * 60_000).toISOString()
            : computeNextRun(config.run_hour, config.run_minute, config.timezone),
          zerarTentativas: !podeRepetir,
        }, runId, leaseToken);

        results.push({ user_id: config.user_id, status: podeRepetir ? "retrying" : "failed", erro: motivo, tentativa });
        continue;
      }

      // ── 5) SÓ AGORA agenda o próximo dia ─────────────────────────────────
      await finalizar(admin, config, {
        status: "succeeded",
        erro: null,
        httpStatus: response.status,
        duracao: Date.now() - t0,
        proximo: computeNextRun(config.run_hour, config.run_minute, config.timezone),
        zerarTentativas: true,
        sucessoEm: new Date().toISOString(),
      }, runId, leaseToken);

      results.push({
        user_id: config.user_id,
        status: "succeeded",
        health_score: data.health_score,
        actions: data.actions?.length || 0,
        duracao_ms: Date.now() - t0,
      });
    } catch (err: any) {
      const podeRepetir = tentativa < MAX_ATTEMPTS;
      const espera = BACKOFF_MIN[Math.min(tentativa - 1, BACKOFF_MIN.length - 1)];
      console.error("[jose-cron-runner] erro no tenant:", config.user_id, err?.message);
      await finalizar(admin, config, {
        status: podeRepetir ? "retrying" : "failed",
        erro: `excecao:${String(err?.message || err).slice(0, 300)}`,
        httpStatus: null,
        duracao: Date.now() - t0,
        proximo: podeRepetir
          ? new Date(Date.now() + espera * 60_000).toISOString()
          : computeNextRun(config.run_hour, config.run_minute, config.timezone),
        zerarTentativas: !podeRepetir,
      }, runId, leaseToken);
      results.push({ user_id: config.user_id, status: podeRepetir ? "retrying" : "failed", error: err?.message });
    }
  }

  // ── Medição diária de resultados: 1x por dia, de verdade ─────────────────
  let measure: string = "nao_e_hora";
  if (new Date().getUTCHours() === 6) {
    measure = await dispararMedicaoUmaVezPorDia(admin, functionsUrl, serviceKey);
  }

  return new Response(JSON.stringify({
    ok: true,
    runner_version: RUNNER_VERSION,
    ran_at: now,
    users_processed: results.length,
    measure_outcomes: measure,
    results,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

/**
 * Atualiza a config tolerando a migration ainda não aplicada: tenta com as
 * colunas novas e, se o banco reclamar delas, repete só com as antigas. Assim a
 * função pode ser deployada antes ou depois da migration sem derrubar o cron.
 */
async function patchConfig(
  admin: any,
  userId: string,
  now: string,
  base: Record<string, unknown>,
  extras: Record<string, unknown>,
): Promise<{ data: any[] | null; error: any }> {
  const q = () => admin.from("apollo_cron_config").update({ ...base, ...extras })
    .eq("user_id", userId).lte("next_run_at", now).select("user_id");
  const { data, error } = await q();
  if (!error) return { data, error: null };
  // 42703 = undefined_column -> migration ainda não aplicada: degrada para as
  // colunas antigas. Qualquer OUTRO erro é propagado (nunca engolido).
  if (String(error.code) === "42703" || /column .* does not exist/i.test(String(error.message || ""))) {
    const { data: d2, error: e2 } = await admin.from("apollo_cron_config").update(base)
      .eq("user_id", userId).lte("next_run_at", now).select("user_id");
    return { data: d2, error: e2 ?? null };
  }
  return { data: null, error };
}

async function finalizar(
  admin: any,
  config: any,
  r: {
    status: string; erro: string | null; httpStatus: number | null; duracao: number;
    proximo: string; zerarTentativas: boolean; sucessoEm?: string;
  },
  runId: string | null,
  leaseToken: string | null,
): Promise<void> {
  const base: Record<string, unknown> = { next_run_at: r.proximo, updated_at: new Date().toISOString() };
  const extras: Record<string, unknown> = {
    last_status: r.status,
    last_error: r.erro,
    last_http_status: r.httpStatus,
    last_duration_ms: r.duracao,
    last_runner_version: RUNNER_VERSION,
    lease_token: null,            // libera o lease ao concluir
    lease_expires_at: null,
    ...(r.zerarTentativas ? { attempt_count: 0 } : {}),
    ...(r.sucessoEm ? { last_success_at: r.sucessoEm } : {}),
  };
  try {
    // CONDICIONAL AO TOKEN: só finaliza quem detém o lease. Um worker atrasado,
    // cujo lease já foi tomado por outro tick, não altera nada (0 linhas).
    let q = admin.from("apollo_cron_config").update({ ...base, ...extras }).eq("user_id", config.user_id);
    if (leaseToken) q = q.eq("lease_token", leaseToken);
    const { data, error } = await q.select("user_id");

    if (error && (String(error.code) === "42703" || /column .* does not exist/i.test(String(error.message || "")))) {
      // migration pendente: degrada (sem checagem de token, que ainda não existe)
      await admin.from("apollo_cron_config").update(base).eq("user_id", config.user_id);
    } else if (error) {
      console.error("[jose-cron-runner] falha ao finalizar", config.user_id, error.message ?? error.code);
    } else if (!data || (data as any[]).length === 0) {
      console.warn(`[jose-cron-runner] lease perdido para ${config.user_id}: finalizacao ignorada (outro worker assumiu)`);
    }
  } catch (e) {
    console.error("[jose-cron-runner] excecao ao finalizar", config.user_id, String((e as any)?.message || e));
  }

  if (runId) {
    try {
      await admin.from("jose_cron_runs").update({
        status: r.status, http_status: r.httpStatus, erro: r.erro,
        duracao_ms: r.duracao, finished_at: new Date().toISOString(),
      }).eq("id", runId);
    } catch (_e) { /* histórico é best-effort */ }
  }
}

async function abrirRun(admin: any, userId: string, job: string, tentativa: number, leaseToken: string | null): Promise<string | null> {
  try {
    const { data } = await admin.from("jose_cron_runs").insert({
      user_id: userId, job, status: "running", attempt: tentativa,
      runner_version: `${RUNNER_VERSION}#${(leaseToken || "sem-lease").slice(0, 8)}`,
    }).select("id").maybeSingle();
    return data?.id ?? null;
  } catch (_e) {
    return null; // tabela ainda não existe: segue sem histórico
  }
}

/**
 * Medição diária de resultados — claim/finalização 100% no banco.
 *
 * ANTES (furado): o TypeScript decidia "o lease venceu" com `!lease_expires_at`
 * — em JS, `!null` é TRUE — e depois tentava escrever com
 * `.lte("lease_expires_at", now)`. Em SQL, `NULL <= now()` é NULL, então a
 * linha NÃO casava. Uma marca antiga com status='em_andamento' e
 * lease_expires_at IS NULL ficaria presa PARA SEMPRE: o JS mandava recuperar,
 * o UPDATE não achava nada, e a medição nunca mais rodava.
 *
 * AGORA: nada de read-then-write. `claim_jose_daily_job` resolve tudo num único
 * statement (INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING), com o
 * predicado completo — inclusive `lease_expires_at IS NULL OR <= now()`. Só um
 * worker vence a disputa; os outros recebem o motivo. A finalização
 * (`finish_jose_daily_job`) é condicional ao token, então um worker zumbi
 * altera zero linhas.
 */
const LEASE_MEDICAO_MIN = 15;
const MAX_TENT_MEDICAO = 3;
/**
 * Timeout do fetch da medição. TEM de ser confortavelmente MENOR que o lease:
 * sem timeout, uma execução travada segura o processo além dos 15 min, o lease
 * expira, outro worker assume — e os DOIS ficam medindo o mesmo dia ao mesmo
 * tempo. Com 8 min sobram ~7 min de margem para finalizar com o token ainda
 * válido.
 */
const TIMEOUT_MEDICAO_MS = 8 * 60_000;
const MARGEM_MIN = LEASE_MEDICAO_MIN - TIMEOUT_MEDICAO_MS / 60_000; // 7 min

/** Estados em que o worker ficou com o lease e deve executar. */
const VENCEU_A_DISPUTA = new Set(["reservado", "lease_recuperado"]);

async function dispararMedicaoUmaVezPorDia(
  admin: any,
  functionsUrl: string,
  serviceKey: string,
): Promise<string> {
  const dia = new Date().toISOString().slice(0, 10);
  const JOB = "measure_outcomes";
  const token = crypto.randomUUID();
  const owner = `${RUNNER_VERSION}#${token.slice(0, 8)}`;

  // ── 1) CLAIM ATÔMICO (uma chamada, sem leitura prévia) ──────────────────
  const { data: claim, error: claimErr } = await admin.rpc("claim_jose_daily_job", {
    p_job: JOB,
    p_dia: dia,
    p_token: token,
    p_owner: owner,
    p_lease_min: LEASE_MEDICAO_MIN,
    p_max_tentativas: MAX_TENT_MEDICAO,
  });

  if (claimErr) {
    // 42883 = undefined_function / PGRST202 = função não exposta:
    // migration ainda não aplicada -> FALHA SEGURA, sem medir destravado.
    const cod = String(claimErr.code ?? "");
    if (cod === "42883" || cod === "PGRST202" || /function .* does not exist/i.test(String(claimErr.message || ""))) {
      console.error("[jose-cron-runner] claim_jose_daily_job inexistente: medicao NAO executada (migration pendente)");
      return "migration_pendente";
    }
    console.error("[jose-cron-runner] erro no claim da medicao:", claimErr.message ?? cod);
    return `nao_disparado:${cod || "erro_claim"}`;
  }

  const veredito = String(claim?.veredito ?? "");
  if (!VENCEU_A_DISPUTA.has(veredito)) return veredito || "nao_disparado:sem_veredito";
  if (veredito === "lease_recuperado") {
    console.warn(`[jose-cron-runner] lease expirado/NULL recuperado para ${JOB}/${dia} (tentativa ${claim?.tentativas})`);
  }

  // ── 2) EXECUTA COM TIMEOUT MENOR QUE O LEASE ────────────────────────────
  const r = await chamarMedicao(functionsUrl, serviceKey, TIMEOUT_MEDICAO_MS);

  // ── 3) FINALIZAÇÃO CONDICIONAL AO TOKEN ─────────────────────────────────
  // O BACKOFF é calculado no SQL a partir da tentativa real da linha (5 min na
  // 1ª falha, 20 min na 2ª, sem novo retry na 3ª). O TypeScript não recalcula
  // nada: uma segunda fonte de verdade foi exatamente o bug anterior, em que
  // BACKOFF_MIN[Math.min(MAX-1, len-1)] dava sempre 20 min.
  const { data: fim, error: fimErr } = await admin.rpc("finish_jose_daily_job", {
    p_job: JOB,
    p_dia: dia,
    p_token: token,
    p_ok: r.ok,
    p_http: r.status,
    p_erro: r.ok ? null : r.motivo,
    p_max_tentativas: MAX_TENT_MEDICAO,
  });

  if (fimErr) {
    console.error("[jose-cron-runner] erro finalizando a medicao:", fimErr.message ?? fimErr.code);
    return r.ok ? `concluido_sem_confirmacao:${fimErr.code ?? "erro"}` : `falhou_sem_confirmacao:${r.motivo}`;
  }
  if (fim?.finalizado !== true) {
    console.warn(`[jose-cron-runner] lease da medicao perdido antes de finalizar (${fim?.motivo ?? "?"})`);
    return r.ok ? "lease_perdido_ao_concluir" : "lease_perdido_ao_falhar";
  }

  if (r.ok) return "concluido";
  if (fim?.limite_atingido === true) return `falhou_limite_de_tentativas:${r.motivo}`;
  return `falhou_retryable:${r.motivo}:retry_em_${fim?.backoff_min ?? "?"}min`;
}

/**
 * Chama a medição validando HTTP E corpo, com timeout explícito.
 * Um travamento vira falha RETRYABLE dentro da janela do lease — nunca deixa o
 * job preso em 'em_andamento' nem permite execução simultânea.
 */
async function chamarMedicao(
  functionsUrl: string,
  serviceKey: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number | null; motivo: string }> {
  // AbortController + cleanup explícito: o timer é sempre limpo, mesmo em erro.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${functionsUrl}/apollo-measure-outcomes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({}),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let corpo: any = {};
    try { corpo = raw ? JSON.parse(raw) : {}; } catch { /* não-JSON */ }

    if (!res.ok) return { ok: false, status: res.status, motivo: `http_${res.status}` };
    if (corpo && corpo.error) return { ok: false, status: res.status, motivo: `corpo_com_erro:${String(corpo.error).slice(0, 120)}` };
    return { ok: true, status: res.status, motivo: "ok" };
  } catch (e) {
    const abortado = (e as any)?.name === "AbortError";
    if (abortado) {
      console.error(`[jose-cron-runner] medicao abortada por timeout apos ${Date.now() - t0}ms (lease de ${LEASE_MEDICAO_MIN}min, margem ${MARGEM_MIN}min)`);
      return { ok: false, status: null, motivo: `timeout_${timeoutMs}ms` };
    }
    return { ok: false, status: null, motivo: `excecao:${String((e as any)?.message || e).slice(0, 120)}` };
  } finally {
    clearTimeout(timer);   // cleanup: nunca deixa timer pendurado
  }
}

// Offset do fuso vs UTC, em minutos (ex.: America/Sao_Paulo = -180). Fallback BRT.
function tzOffsetMinutes(timeZone: string): number {
  try {
    const now = new Date();
    const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const local = new Date(now.toLocaleString("en-US", { timeZone }));
    return Math.round((local.getTime() - utc.getTime()) / 60000);
  } catch (_e) { return -180; }
}

function computeNextRun(hour: number, minute: number, timezone: string): string {
  // hour:minute são no FUSO do cliente (default America/Sao_Paulo) — NÃO em UTC.
  const tz = timezone || "America/Sao_Paulo";
  const offsetMin = tzOffsetMinutes(tz);
  const now = new Date();
  const next = new Date();
  next.setUTCHours(hour, minute, 0, 0);
  next.setUTCMinutes(next.getUTCMinutes() - offsetMin);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
