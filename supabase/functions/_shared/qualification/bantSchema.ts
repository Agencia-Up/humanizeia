// =============================================================================
// BANT SCHEMA — IT-2.1 (qualificação do Pedro SDR)
// =============================================================================
//
// DERIVA o estágio BANT (Budget/Authority/Need/Timeline) a partir do
// `pedro_conversation_state` JSONB EXISTENTE. NÃO adiciona campos novos
// na tabela — evita migration. Apenas calcula status e formata bloco
// pro system prompt.
//
// MAPEAMENTO (campo do state → dimensão BANT):
//   Budget    ← negociacao.forma_pagamento + negociacao.valor_entrada
//   Authority ← lead.acompanhante_decisao (vazio = decide sozinho)
//   Need      ← interesse.modelo_desejado + veiculo_apresentado.ja_apresentado
//   Timeline  ← heurística combinando os 3 anteriores
//
// USO (fonte canônica testável):
//   ```ts
//   import { deriveBantFromState, formatBantBlock } from './bantSchema';
//   const bant = deriveBantFromState(state);
//   const block = formatBantBlock(bant);
//   ```
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá (Edge Functions Supabase não importam
// cross-function).
// =============================================================================

export type BantBudgetStatus = "known" | "unknown";
export type BantAuthorityStatus = "sole" | "shared" | "unknown";
export type BantNeedStatus = "specific" | "exploring" | "unknown";
export type BantTimelineStatus =
  | "ready_to_close"
  | "evaluating"
  | "discovery";

export type BantStatus = {
  budget: { status: BantBudgetStatus; detail: string };
  authority: { status: BantAuthorityStatus; detail: string };
  need: { status: BantNeedStatus; detail: string };
  timeline: { status: BantTimelineStatus; detail: string };
  /** Estágio geral (pra orientar próxima ação do agente). */
  overallStage:
    | "cold"
    | "discovery"
    | "qualifying"
    | "qualified"
    | "ready_to_handoff";
  /** Próxima pergunta sugerida (pra ajudar o LLM a focar). */
  nextSuggestedAsk: string;
};

/**
 * Deriva BANT do state JSONB existente. Pure function — sem efeito colateral.
 * Aceita state nulo/vazio sem quebrar.
 */
export function deriveBantFromState(state: any): BantStatus {
  const s = state || {};

  // ─── Budget ──
  const formaPagamento = s.negociacao?.forma_pagamento;
  const valorEntrada = s.negociacao?.valor_entrada;
  const temTroca = s.negociacao?.tem_troca;
  let budgetStatus: BantBudgetStatus = "unknown";
  let budgetDetail = "forma de pagamento não informada";
  if (formaPagamento) {
    budgetStatus = "known";
    const parts = [`forma: ${formaPagamento}`];
    if (valorEntrada) parts.push(`entrada: ${valorEntrada}`);
    if (temTroca === true) parts.push("com troca");
    budgetDetail = parts.join(", ");
  } else if (temTroca === true) {
    budgetStatus = "known";
    budgetDetail = "troca declarada, forma pendente";
  }

  // ─── Authority ──
  const acompanhante = s.lead?.acompanhante_decisao;
  let authorityStatus: BantAuthorityStatus = "unknown";
  let authorityDetail = "não sabemos se decide sozinho";
  if (typeof acompanhante === "string" && acompanhante.trim().length > 0) {
    authorityStatus = "shared";
    authorityDetail = `precisa consultar ${acompanhante}`;
  } else if (s.lead?.nome) {
    // já tem nome e não declarou acompanhante = assume autoridade própria
    authorityStatus = "sole";
    authorityDetail = "decide sozinho (sem acompanhante mencionado)";
  }

  // ─── Need ──
  const modelo = s.interesse?.modelo_desejado;
  const jaApresentado = !!s.veiculo_apresentado?.ja_apresentado;
  let needStatus: BantNeedStatus = "unknown";
  let needDetail = "modelo de interesse não definido";
  if (modelo) {
    needStatus = "specific";
    const conf = [
      s.interesse?.configuracao,
      s.interesse?.combustivel,
      s.interesse?.cambio,
      s.interesse?.ano_desejado,
    ]
      .filter(Boolean)
      .join(", ");
    needDetail = jaApresentado
      ? `${modelo} já apresentado`
      : `${modelo}${conf ? ` (${conf})` : ""}`;
  } else if (jaApresentado) {
    needStatus = "exploring";
    needDetail = "veículo apresentado mas modelo de interesse não setado";
  }

  // ─── Timeline (heurística combinada) ──
  let timelineStatus: BantTimelineStatus = "discovery";
  let timelineDetail = "início da conversa, ainda explorando";

  const budgetOk = budgetStatus === "known";
  const needOk = needStatus === "specific" || jaApresentado;
  const authorityOk = authorityStatus === "sole";

  if (budgetOk && needOk && authorityOk) {
    timelineStatus = "ready_to_close";
    timelineDetail = "BNA completo + decide sozinho";
  } else if (needOk && (budgetOk || authorityOk)) {
    timelineStatus = "evaluating";
    timelineDetail = "tem clareza de necessidade, falta detalhe";
  } else if (needOk || budgetOk) {
    timelineStatus = "evaluating";
    timelineDetail = "1 dimensão clara, outras pendentes";
  }

  // ─── Overall stage ──
  const knownCount = [
    budgetStatus === "known",
    authorityStatus !== "unknown",
    needStatus !== "unknown",
  ].filter(Boolean).length;

  let overallStage: BantStatus["overallStage"] = "cold";
  if (timelineStatus === "ready_to_close") overallStage = "ready_to_handoff";
  else if (knownCount === 3) overallStage = "qualified";
  else if (knownCount === 2) overallStage = "qualifying";
  else if (knownCount === 1) overallStage = "discovery";

  // ─── Próxima sugestão (orienta o LLM) ──
  let nextSuggestedAsk = "Perguntar qual modelo o cliente está procurando";
  if (needStatus === "unknown") {
    nextSuggestedAsk = "Perguntar qual modelo/tipo de carro o cliente quer";
  } else if (budgetStatus === "unknown") {
    nextSuggestedAsk = "Perguntar forma de pagamento (à vista, financiar, troca)";
  } else if (authorityStatus === "unknown") {
    nextSuggestedAsk = "Confirmar nome do cliente (ajuda a saber se decide sozinho)";
  } else if (overallStage === "ready_to_handoff") {
    nextSuggestedAsk = "Transferir pra vendedor humano via tool transferir_para_vendedor";
  } else if (jaApresentado && !s.lead?.telefone) {
    nextSuggestedAsk = "Pedir telefone pra preparar o handoff";
  }

  return {
    budget: { status: budgetStatus, detail: budgetDetail },
    authority: { status: authorityStatus, detail: authorityDetail },
    need: { status: needStatus, detail: needDetail },
    timeline: { status: timelineStatus, detail: timelineDetail },
    overallStage,
    nextSuggestedAsk,
  };
}

/**
 * Formata o BANT como bloco markdown pra apend em system prompt.
 * Vazio se overallStage='cold' (nada a mostrar ainda).
 */
export function formatBantBlock(bant: BantStatus): string {
  if (bant.overallStage === "cold") return "";

  const lines: string[] = [];
  lines.push("## QUALIFICAÇÃO BANT (status atual)");
  lines.push(
    `- **Budget**: ${bant.budget.status} — ${bant.budget.detail}`
  );
  lines.push(
    `- **Authority**: ${bant.authority.status} — ${bant.authority.detail}`
  );
  lines.push(`- **Need**: ${bant.need.status} — ${bant.need.detail}`);
  lines.push(
    `- **Timeline**: ${bant.timeline.status} — ${bant.timeline.detail}`
  );
  lines.push(`- **Estágio geral**: ${bant.overallStage}`);
  lines.push(`- **Próxima ação sugerida**: ${bant.nextSuggestedAsk}`);
  return lines.join("\n");
}
