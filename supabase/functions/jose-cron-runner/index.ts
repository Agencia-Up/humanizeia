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
  const { data: dueUsers } = await admin
    .from("apollo_cron_config")
    .select("*")
    .eq("is_enabled", true)
    .lte("next_run_at", now)
    .order("next_run_at", { ascending: true })
    .limit(20);

  const results: any[] = [];

  for (const config of (dueUsers || [])) {
    const t0 = Date.now();
    const tentativa = Number(config.attempt_count || 0) + 1;
    let runId: string | null = null;

    try {
      // ── 1) RESERVA CURTA (lease) — impede execução concorrente sem perder o dia
      const lease = new Date(Date.now() + LEASE_MIN * 60_000).toISOString();
      const { data: claimed } = await patchConfig(admin, config.user_id, now, {
        last_run_at: now,
        next_run_at: lease,
        updated_at: now,
      }, {
        last_status: "running",
        attempt_count: tentativa,
        last_runner_version: RUNNER_VERSION,
      });
      if (!claimed || claimed.length === 0) continue; // outro tick já reservou

      runId = await abrirRun(admin, config.user_id, "daily_report", tentativa);

      // ── 2) PRÉ-REQUISITOS (antes de gastar qualquer chamada) ─────────────
      const { data: account } = await admin
        .from("ad_accounts")
        .select("account_id, access_token_encrypted")
        .eq("user_id", config.user_id)
        .eq("platform", "meta")
        .eq("is_active", true)
        .maybeSingle();

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
        }, runId);
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
        }, runId);

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
      }, runId);

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
      }, runId);
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
): Promise<{ data: any[] | null }> {
  const q = () => admin.from("apollo_cron_config").update({ ...base, ...extras })
    .eq("user_id", userId).lte("next_run_at", now).select("user_id");
  const { data, error } = await q();
  if (!error) return { data };
  // 42703 = undefined_column -> migration ainda não aplicada
  if (String(error.code) === "42703" || /column .* does not exist/i.test(String(error.message || ""))) {
    const { data: d2 } = await admin.from("apollo_cron_config").update(base)
      .eq("user_id", userId).lte("next_run_at", now).select("user_id");
    return { data: d2 };
  }
  return { data: null };
}

async function finalizar(
  admin: any,
  config: any,
  r: {
    status: string; erro: string | null; httpStatus: number | null; duracao: number;
    proximo: string; zerarTentativas: boolean; sucessoEm?: string;
  },
  runId: string | null,
): Promise<void> {
  const base: Record<string, unknown> = { next_run_at: r.proximo, updated_at: new Date().toISOString() };
  const extras: Record<string, unknown> = {
    last_status: r.status,
    last_error: r.erro,
    last_http_status: r.httpStatus,
    last_duration_ms: r.duracao,
    last_runner_version: RUNNER_VERSION,
    ...(r.zerarTentativas ? { attempt_count: 0 } : {}),
    ...(r.sucessoEm ? { last_success_at: r.sucessoEm } : {}),
  };
  try {
    const { error } = await admin.from("apollo_cron_config").update({ ...base, ...extras }).eq("user_id", config.user_id);
    if (error) await admin.from("apollo_cron_config").update(base).eq("user_id", config.user_id);
  } catch (_e) { /* nunca derruba o loop */ }

  if (runId) {
    try {
      await admin.from("jose_cron_runs").update({
        status: r.status, http_status: r.httpStatus, erro: r.erro,
        duracao_ms: r.duracao, finished_at: new Date().toISOString(),
      }).eq("id", runId);
    } catch (_e) { /* histórico é best-effort */ }
  }
}

async function abrirRun(admin: any, userId: string, job: string, tentativa: number): Promise<string | null> {
  try {
    const { data } = await admin.from("jose_cron_runs").insert({
      user_id: userId, job, status: "running", attempt: tentativa, runner_version: RUNNER_VERSION,
    }).select("id").maybeSingle();
    return data?.id ?? null;
  } catch (_e) {
    return null; // tabela ainda não existe: segue sem histórico
  }
}

/**
 * Trava diária: só o primeiro tick do dia consegue inserir a marca (PK
 * composta), então a medição roda uma vez — e não 60x entre 06:00 e 06:59.
 */
async function dispararMedicaoUmaVezPorDia(admin: any, functionsUrl: string, serviceKey: string): Promise<string> {
  const dia = new Date().toISOString().slice(0, 10);
  try {
    const { error } = await admin.from("jose_cron_daily_marks").insert({ job: "measure_outcomes", dia });
    if (error) {
      if (String(error.code) === "23505") return "ja_rodou_hoje";
      // Sem a tabela (migration pendente), preserva o comportamento antigo.
      if (String(error.code) === "42P01") { void chamarMedicao(functionsUrl, serviceKey); return "disparado_sem_trava_migration_pendente"; }
      return `nao_disparado:${error.code}`;
    }
  } catch (_e) {
    return "nao_disparado:excecao";
  }
  void chamarMedicao(functionsUrl, serviceKey);
  return "disparado";
}

function chamarMedicao(functionsUrl: string, serviceKey: string): Promise<unknown> {
  return fetch(`${functionsUrl}/apollo-measure-outcomes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
    body: JSON.stringify({}),
  }).catch(() => {});
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
