import { createClient } from "npm:@supabase/supabase-js@2";
import { requireInternalCaller, internalAuthDenied } from "../_shared/jose-v2/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jose-internal-secret, x-jose-ts, x-jose-nonce",
};

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";
const MEASURE_VERSION = "fase1-claim-incremental-v2";
/** Lease por outcome. Como reservamos 1 por vez, 5 min sobra com folga. */
const LEASE_MEDICAO_MIN = 5;
/** Timeout de cada chamada a Meta, bem dentro do lease. */
const TIMEOUT_META_MS = 60_000;
/** Teto de itens por execucao. */
const MAX_ITENS = 50;
/**
 * Orcamento total desta execucao. Fica ABAIXO do timeout externo do runner
 * (8 min) para que a funcao termine sozinha e devolva um corpo honesto, em vez
 * de ser abortada pelo cliente no meio de um item.
 */
const ORCAMENTO_MS = 6 * 60_000;
/** Tempo reservado para processar UM item (chamada a Meta + finalizacao). */
const RESERVA_SEGURANCA_MS = TIMEOUT_META_MS + 20_000;

/**
 * apollo-measure-outcomes
 *
 * Runs daily at 06:00 UTC (called by apollo-cron-runner).
 * Finds action_log entries older than 7 days with no outcome yet.
 * Fetches current Meta metrics and computes improvement scores.
 * Writes to apollo_action_outcomes and aggregates to apollo_learning.
 *
 * FASE 1 (segurança): a função era PÚBLICA (verify_jwt=false + zero checagem).
 * Qualquer anônimo disparava consumo da Graph API com os tokens Meta de todos os
 * tenants e escrevia em apollo_action_outcomes/apollo_learning — ou seja, dava
 * para ENVENENAR o aprendizado do agente. Agora exige chamador interno.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const auth = await requireInternalCaller(req, { admin });
  if (!auth.ok) return internalAuthDenied(auth, corsHeaders);

  // ── CLAIM INCREMENTAL (1 por vez) ──────────────────────────────────────
  // Antes reservavamos ate 50 outcomes de uma vez, todos com o MESMO lease de
  // 10 min, mas as chamadas a Meta sao sequenciais e podem levar ate 60s cada.
  // Os ultimos itens da leva esperariam mais que o lease, seriam recuperados
  // por outro worker e a mesma campanha receberia duas chamadas externas.
  // Agora cada outcome e reservado IMEDIATAMENTE antes de ser processado, e o
  // laco so continua enquanto houver tempo seguro dentro do orcamento.
  const token = crypto.randomUUID();
  const owner = `${MEASURE_VERSION}#${token.slice(0, 8)}`;
  const inicio = Date.now();

  let medidos = 0;          // finish confirmou 'medido' E aprendizado aplicado
  let falhas = 0;           // finish confirmou 'falhou'
  let leasePerdido = 0;     // outra execucao assumiu no meio do caminho
  let reservados = 0;
  let parouPorTempo = false;

  while (reservados < MAX_ITENS) {
    // Nao reserva o proximo se nao houver tempo seguro para processa-lo:
    // um item reservado e nao processado ficaria preso ate o lease vencer.
    const decorrido = Date.now() - inicio;
    if (decorrido + RESERVA_SEGURANCA_MS > ORCAMENTO_MS) { parouPorTempo = true; break; }

    const { data: lote, error: claimErr } = await admin.rpc("claim_apollo_outcomes", {
      p_token: token,
      p_owner: owner,
      p_limit: 1,               // UM por vez
      p_lease_min: LEASE_MEDICAO_MIN,
      p_dias: 7,
    });

    if (claimErr) {
      const cod = String(claimErr.code ?? "");
      if (cod === "42883" || cod === "PGRST202" || /function .* does not exist/i.test(String(claimErr.message || ""))) {
        console.error("[measure-outcomes] claim_apollo_outcomes inexistente (migration pendente): nada foi medido");
        return json({ ok: false, erro: "migration_pendente", medidos: 0, falhas: 0 }, 503);
      }
      console.error("[measure-outcomes] falha no claim:", claimErr.message ?? cod);
      return json({ ok: false, erro: "falha_no_claim", detalhe: String(claimErr.message ?? cod), medidos, falhas }, 503);
    }

    const outcome = ((lote || []) as any[])[0];
    if (!outcome) break;      // fila vazia
    reservados++;

    // Encerra SEMPRE com o token desta execucao, numa unica RPC transacional:
    // outcome + aprendizado vivem ou morrem juntos. Se o UPSERT do aprendizado
    // falhar, o UPDATE do outcome e revertido e a linha volta para a fila.
    const encerrar = async (
      ok: boolean,
      extras: { after?: unknown; verdict?: string; score?: number; erro?: string },
    ): Promise<boolean> => {
      const { data: fim, error: fimErr } = await admin.rpc("finish_apollo_outcome_atomic", {
        p_id: outcome.id,
        p_token: token,
        p_ok: ok,
        p_after: extras.after ?? null,
        p_outcome: extras.verdict ?? null,
        p_score: extras.score ?? null,
        p_erro: extras.erro ?? null,
      });
      if (fimErr) {
        // Erro de banco NUNCA e ignorado nem contado como sucesso. Como a RPC e
        // atomica, o outcome NAO ficou 'medido': segue elegivel para retry.
        console.error(`[measure-outcomes] erro ao finalizar ${outcome.id}:`, fimErr.message ?? fimErr.code);
        return false;
      }
      if (fim?.finalizado !== true) {
        leasePerdido++;
        console.warn(`[measure-outcomes] lease perdido em ${outcome.id} (${fim?.motivo ?? "?"})`);
        return false;
      }
      if (ok) {
        // So conta como medido se o aprendizado tambem foi aplicado.
        if (fim?.aprendizado_aplicado !== true) {
          console.error(`[measure-outcomes] ${outcome.id} medido sem aprendizado — inconsistente`);
          return false;
        }
        medidos++;
      } else {
        falhas++;
      }
      return true;
    };

    try {
      const { data: account, error: contaErr } = await admin
        .from("ad_accounts")
        .select("access_token_encrypted, account_id")
        .eq("user_id", outcome.user_id)
        .eq("platform", "meta")
        .eq("is_active", true)
        .maybeSingle();

      if (contaErr) { await encerrar(false, { erro: `erro_lendo_conta:${contaErr.code ?? contaErr.message}` }); continue; }
      if (!account?.access_token_encrypted) { await encerrar(false, { erro: "sem_conta_meta_ativa" }); continue; }

      // O token vai no HEADER, nunca na query string (evita vazar em log de proxy).
      const url = new URL(`${META_GRAPH_URL}/${outcome.campaign_id_meta}/insights`);
      url.searchParams.set("fields", "spend,ctr,cpc,cpm,impressions,clicks,reach,frequency,actions,action_values");
      url.searchParams.set("date_preset", "last_7d");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${account.access_token_encrypted}` },
        signal: AbortSignal.timeout(TIMEOUT_META_MS),
      });
      const insData = await res.json().catch(() => ({} as any));

      if (!res.ok) { await encerrar(false, { erro: `meta_http_${res.status}` }); continue; }

      const afterMetrics = insData.data?.[0];
      if (!afterMetrics) { await encerrar(false, { erro: "meta_sem_insights" }); continue; }

      const afterCtr = Number(afterMetrics.ctr || 0);
      const afterCpc = Number(afterMetrics.cpc || 0);
      const afterSpend = Number(afterMetrics.spend || 0);
      let afterRoas = 0;
      if (afterMetrics.action_values?.length && afterSpend > 0) {
        const av = afterMetrics.action_values.find((x: any) => x.action_type.includes("purchase"));
        if (av) afterRoas = Number(av.value) / afterSpend;
      }

      let improvementScore = 0;
      const before = {
        ctr: outcome.before_ctr || 0,
        cpc: outcome.before_cpc || 0,
        roas: outcome.before_roas || 0,
      };
      if (before.ctr > 0) improvementScore += Math.min(50, Math.max(-50, ((afterCtr - before.ctr) / before.ctr) * 50));
      if (before.cpc > 0) improvementScore += Math.min(30, Math.max(-30, ((before.cpc - afterCpc) / before.cpc) * 30));
      if (before.roas > 0) improvementScore += Math.min(20, Math.max(-20, ((afterRoas - before.roas) / before.roas) * 20));

      // Vocabulario operacional existente: improved | neutral | declined
      const verdict =
        improvementScore >= 10 ? "improved" :
        improvementScore <= -10 ? "declined" : "neutral";

      await encerrar(true, {
        after: { health_score: null, roas: afterRoas, ctr: afterCtr, cpc: afterCpc, spend: afterSpend },
        verdict,
        score: Math.round(improvementScore),
      });
    } catch (err) {
      const abortado = (err as any)?.name === "TimeoutError" || (err as any)?.name === "AbortError";
      console.error("[measure-outcomes] erro no outcome", outcome.id, (err as any)?.message ?? err);
      await encerrar(false, { erro: abortado ? `timeout_meta_${TIMEOUT_META_MS}ms` : `excecao:${String((err as any)?.message || err).slice(0, 200)}` });
    }
  }

  if (reservados === 0) {
    return json({ ok: true, message: "No pending outcomes to measure", medidos: 0, falhas: 0, reservados: 0 }, 200);
  }

  // O corpo representa PERSISTENCIA REAL: 'medidos' so conta o que o banco
  // confirmou COM aprendizado aplicado na mesma transacao.
  const inconsistentes = reservados - medidos - falhas - leasePerdido;
  const ok = inconsistentes === 0;
  return json({
    ok,
    version: MEASURE_VERSION,
    reservados,
    medidos,
    falhas,
    lease_perdido: leasePerdido,
    inconsistentes,
    parou_por_tempo: parouPorTempo,
    duracao_ms: Date.now() - inicio,
  }, ok ? 200 : 500);
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
