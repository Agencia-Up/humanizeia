/**
 * guardrails.ts — José v3.1 / Fase 0
 *
 * Antes de QUALQUER ação autônoma, na ORDEM do documento mestre:
 *   1) kill-switch (jose_spend_caps.kill_switch) -> paraliza tudo
 *   2) permissão (jose_permissions.nivel) por conta + tipo de ação
 *   3) cap diário (nº de ações / gasto alterado no dia)
 *   4) teto de custo de IA no mês (jose_usage_ledger)
 * Decide: 'execute' (age sozinho), 'gate' (precisa SIM/NÃO) ou 'block' (não faz).
 *
 * Fail-safe: em erro de leitura, devolve 'gate' (nunca 'execute' às cegas).
 */

export type GuardrailDecision = "execute" | "gate" | "block";

export interface GuardrailInput {
  user_id: string;
  ad_account_id?: string | null;
  tipo_acao: string;
  custo_ia_estimado_usd?: number;  // custo de IA previsto p/ esta ação
  gasto_alterado?: number;         // R$ de orçamento que a ação muda (pacing)
}

export interface GuardrailResult {
  decision: GuardrailDecision;
  reason: string;
  nivel?: string;
}

function startOfTodayISO(): string {
  // bloco de "hoje" em UTC; suficiente p/ contagem diária (refinar TZ na Fase 6).
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
function startOfMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function checkGuardrails(admin: any, input: GuardrailInput): Promise<GuardrailResult> {
  try {
    // ── caps + kill-switch (linha da conta vence a linha user-only) ──────────
    const { data: capsRows } = await admin
      .from("jose_spend_caps")
      .select("ad_account_id, kill_switch, limite_gasto_alterado_dia, limite_acoes_dia, exige_aprovacao_acima_de, teto_custo_ia_mes_usd")
      .eq("user_id", input.user_id)
      .or(`ad_account_id.is.null${input.ad_account_id ? `,ad_account_id.eq.${input.ad_account_id}` : ""}`);
    const caps = ((capsRows || []) as any[])
      .sort((a, b) => Number(Boolean(b.ad_account_id)) - Number(Boolean(a.ad_account_id)))[0] || null;

    // 1) kill-switch
    if (caps?.kill_switch === true) {
      return { decision: "block", reason: "kill_switch_ligado" };
    }

    // 2) permissão por conta + tipo de ação
    const { data: permRows } = await admin
      .from("jose_permissions")
      .select("ad_account_id, nivel")
      .eq("user_id", input.user_id)
      .eq("tipo_acao", input.tipo_acao)
      .or(`ad_account_id.is.null${input.ad_account_id ? `,ad_account_id.eq.${input.ad_account_id}` : ""}`);
    const perm = ((permRows || []) as any[])
      .sort((a, b) => Number(Boolean(b.ad_account_id)) - Number(Boolean(a.ad_account_id)))[0] || null;
    const nivel = perm?.nivel || "recomendar"; // default = recomendar (gate)

    if (nivel === "desligado") return { decision: "block", reason: "permissao_desligada", nivel };
    if (nivel === "analisar")  return { decision: "block", reason: "permissao_so_analisa", nivel };
    if (nivel === "recomendar") return { decision: "gate", reason: "permissao_recomendar_exige_aprovacao", nivel };
    // nivel === 'executar' -> segue checando caps

    // 4) teto de custo de IA no mês
    if (caps?.teto_custo_ia_mes_usd != null) {
      const { data: ledger } = await admin
        .from("jose_usage_ledger")
        .select("custo_usd")
        .eq("user_id", input.user_id)
        .gte("created_at", startOfMonthISO());
      const gastoIa = ((ledger || []) as any[]).reduce((s, r) => s + Number(r.custo_usd || 0), 0);
      if (gastoIa + (input.custo_ia_estimado_usd || 0) > Number(caps.teto_custo_ia_mes_usd)) {
        return { decision: "block", reason: "teto_custo_ia_mes_estourado", nivel };
      }
    }

    // 3) cap diário de nº de ações
    if (caps?.limite_acoes_dia != null) {
      const { count } = await admin
        .from("apollo_action_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", input.user_id)
        .gte("executed_at", startOfTodayISO());
      if ((count || 0) >= Number(caps.limite_acoes_dia)) {
        return { decision: "gate", reason: "limite_acoes_dia_atingido", nivel };
      }
    }

    // 3b) exige aprovação acima de um valor de gasto alterado
    if (caps?.exige_aprovacao_acima_de != null && input.gasto_alterado != null) {
      if (Math.abs(input.gasto_alterado) > Number(caps.exige_aprovacao_acima_de)) {
        return { decision: "gate", reason: "gasto_acima_do_teto_exige_aprovacao", nivel };
      }
    }
    // 3c) cap diário de gasto alterado
    if (caps?.limite_gasto_alterado_dia != null && input.gasto_alterado != null) {
      if (Math.abs(input.gasto_alterado) > Number(caps.limite_gasto_alterado_dia)) {
        return { decision: "gate", reason: "gasto_alterado_acima_do_limite_dia", nivel };
      }
    }

    return { decision: "execute", reason: "dentro_dos_limites", nivel };
  } catch (e) {
    return { decision: "gate", reason: `guardrail_erro_fail_safe:${String((e as any)?.message || e)}` };
  }
}
