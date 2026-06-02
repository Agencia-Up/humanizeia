// ============================================================================
// Token metering — Pedro v2
// ----------------------------------------------------------------------------
// Desconto REAL dos tokens que o cérebro do Pedro v2 (gpt-4o) gasta no turno +
// aviso "acabando/acabou" (1x por ciclo) no WhatsApp do dono.
//
// Estratégia: cada chamada de cérebro (planner/reply) soma o uso num "sink"
// mutável (passado por referência). No fim do turno o orchestrator chama
// consumeUserTokens UMA vez. Quando o saldo cruza ≤10% (just_low) ou ≤0
// (just_depleted), a RPC avisa só uma vez por ciclo e a gente dispara a
// mensagem. NUNCA bloqueia o atendimento — só mede e avisa.
// ============================================================================

// Acumulador de uso passado às funções de cérebro (por referência).
export interface UsageSink {
  tokens: number;
}

// Soma os tokens de UMA resposta da OpenAI (prompt + completion).
export function sumOpenAiTokens(data: any): number {
  const u = data?.usage;
  if (!u) return 0;
  const t = typeof u.total_tokens === "number"
    ? u.total_tokens
    : (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0);
  return t > 0 ? Math.round(t) : 0;
}

export interface TokenConsumeResult {
  ok: boolean;
  consumed: number;
  balance_after?: number;
  total?: number;
  just_depleted?: boolean;
  just_low?: boolean;
}

// Desconta os tokens do plano (user_subscriptions) via RPC consume_user_tokens.
// Devolve as flags just_low / just_depleted pra quem chamou decidir o aviso.
export async function consumeUserTokens(
  supabase: any,
  args: { userId: string; tokens: number; agent: string; description: string },
): Promise<TokenConsumeResult> {
  const amount = Math.round(args.tokens || 0);
  if (amount <= 0 || !args.userId) return { ok: false, consumed: 0 };
  try {
    const { data, error } = await supabase.rpc("consume_user_tokens", {
      p_user_id: args.userId,
      p_amount: amount,
      p_agent: args.agent,
      p_description: args.description,
    });
    if (error) {
      console.error("[tokens] consume_user_tokens erro:", error.message);
      return { ok: false, consumed: 0 };
    }
    if (!data || data.ok !== true) {
      if (data?.error) console.warn("[tokens] consume ignorado:", data.error);
      return { ok: false, consumed: 0 };
    }
    return {
      ok: true,
      consumed: amount,
      balance_after: data.balance_after,
      total: data.total,
      just_depleted: data.just_depleted === true,
      just_low: data.just_low === true,
    };
  } catch (e) {
    console.error("[tokens] consumeUserTokens exceção:", e);
    return { ok: false, consumed: 0 };
  }
}

// Resultado de bill_pedro_lead — mesmo formato de alerta de consumeUserTokens.
export interface BillLeadResult {
  ok: boolean;
  billed: boolean;        // true = cobrou 1 atendimento agora (1a vez do lead no ciclo)
  balance_after?: number;
  total?: number;
  just_depleted?: boolean;
  just_low?: boolean;
}

// Cobra 1 ATENDIMENTO por lead/ciclo via RPC bill_pedro_lead (modelo do plano),
// guardando os tokens crus so como medicao interna de margem. Idempotente por
// lead+ciclo (a trava vive no banco, em pedro_billed_leads). NUNCA bloqueia o
// atendimento — so mede e devolve as flags de aviso quando cobra de fato.
export async function billPedroLead(
  supabase: any,
  args: { userId: string; leadKey: string; rawTokens: number; agent?: string },
): Promise<BillLeadResult> {
  const leadKey = String(args.leadKey || "").replace(/\D/g, "");
  if (!args.userId || !leadKey) return { ok: false, billed: false };
  try {
    const { data, error } = await supabase.rpc("bill_pedro_lead", {
      p_user_id: args.userId,
      p_lead_key: leadKey,
      p_raw_tokens: Math.max(0, Math.round(args.rawTokens || 0)),
      p_agent: args.agent || "pedro",
    });
    if (error) {
      console.error("[tokens] bill_pedro_lead erro:", error.message);
      return { ok: false, billed: false };
    }
    if (!data || data.ok !== true) {
      if (data?.error) console.warn("[tokens] bill ignorado:", data.error);
      return { ok: false, billed: false };
    }
    return {
      ok: true,
      billed: data.billed === true,
      balance_after: data.balance_after,
      total: data.total,
      just_depleted: data.just_depleted === true,
      just_low: data.just_low === true,
    };
  } catch (e) {
    console.error("[tokens] billPedroLead exceção:", e);
    return { ok: false, billed: false };
  }
}

// Texto do aviso enviado ao dono no WhatsApp.
export function buildTokenAlertText(kind: "depleted" | "low"): string {
  return kind === "depleted"
    ? "⚠️ *Seus tokens de IA acabaram.*\n\nO Pedro vai continuar atendendo seus leads normalmente, mas o consumo já passou do limite do seu plano. Recarregue no painel para manter o controle de uso em dia."
    : "🔔 *Seus tokens de IA estão acabando* (menos de 10% do plano).\n\nRecarregue no painel para não ficar sem antes da renovação.";
}

// Normaliza o número do dono (gerente_phone) p/ enviar no WhatsApp (55 + DDD + número).
export function normalizeAlertPhone(raw?: string | null): string {
  let phone = String(raw || "").replace(/\D/g, "");
  if (!phone) return "";
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  return phone;
}
