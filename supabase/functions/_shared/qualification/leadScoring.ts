// =============================================================================
// LEAD SCORING V2 — IT-2.2 (qualificação do Pedro SDR)
// =============================================================================
//
// Substitui o `calcQualificationScore` (V1, linha 639 do webhook) por
// versão com critérios EXPLÍCITOS: cada critério tem nome, peso, condição,
// passou/não-passou e justificativa. Retorna breakdown completo +
// score 0-100 + tier (cold/warm/hot/qualified).
//
// VANTAGENS sobre V1:
//   - Visibilidade: porque o score é X (cada critério tem motivo)
//   - Pesos NEGATIVOS pra objeções bloqueantes (V1 só somava)
//   - Tiers categóricos pra triggers (alerts em hot, handoff em qualified)
//   - Breakdown serializável → futuro analytics/dashboard
//
// COMPAT V1: a função `calcLeadScoreV2(state).score` retorna número
// no mesmo intervalo [0, 100], compatível com a coluna
// `pedro_conversation_state.qualificacao_score` (numeric).
//
// USO (fonte canônica testável):
//   ```ts
//   import { calcLeadScoreV2, getLeadTier } from './leadScoring';
//   const { score, tier, breakdown } = calcLeadScoreV2(state);
//   ```
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá.
// =============================================================================

export type LeadTier = "cold" | "warm" | "hot" | "qualified";

export type ScoringCriterion = {
  /** Slug curto sem espaços. Bom pra logging/analytics. */
  key: string;
  /** Texto legível mostrado em logs / dashboard. */
  label: string;
  /** Peso (pode ser negativo pra penalidades). */
  weight: number;
  /** Passou o critério? */
  passed: boolean;
  /** Justificativa humana (com valor do state quando aplicável). */
  reason: string;
};

export type LeadScoreResult = {
  /** Score final, clamp [0, 100]. */
  score: number;
  /** Tier categórico baseado no score. */
  tier: LeadTier;
  /** Lista completa de critérios avaliados (pra debug/log/analytics). */
  breakdown: ScoringCriterion[];
  /** Soma dos pesos POSITIVOS (sem penalidades aplicadas). Pra debug. */
  rawPositive: number;
  /** Soma das penalidades aplicadas (números negativos). */
  rawPenalties: number;
};

/**
 * Mapeia score numérico em tier categórico.
 *   0-19  : cold      (acabou de chegar / quase nada coletado)
 *   20-49 : warm      (algumas dimensões cobertas)
 *   50-79 : hot       (qualificado, falta poucos campos pro handoff)
 *   80-100: qualified (pronto pra transferir pro vendedor)
 */
export function getLeadTier(score: number): LeadTier {
  if (score >= 80) return "qualified";
  if (score >= 50) return "hot";
  if (score >= 20) return "warm";
  return "cold";
}

/**
 * Calcula o score do lead com base no `pedro_conversation_state`.
 * Pure function — sem efeito colateral. Aceita state nulo/vazio.
 */
export function calcLeadScoreV2(state: any): LeadScoreResult {
  const s = state || {};

  const breakdown: ScoringCriterion[] = [
    {
      key: "nome",
      label: "Nome do cliente coletado",
      weight: 10,
      passed: !!s.lead?.nome,
      reason: s.lead?.nome
        ? `nome="${s.lead?.nome_completo || s.lead?.nome}"`
        : "lead.nome ausente",
    },
    {
      key: "telefone",
      label: "Telefone direto confirmado",
      weight: 20,
      passed: !!s.lead?.telefone,
      reason: s.lead?.telefone
        ? `telefone="${s.lead.telefone}"`
        : "lead.telefone ausente",
    },
    {
      key: "modelo_desejado",
      label: "Modelo de interesse declarado",
      weight: 15,
      passed: !!s.interesse?.modelo_desejado,
      reason: s.interesse?.modelo_desejado
        ? `modelo="${s.interesse.modelo_desejado}"`
        : "interesse.modelo_desejado ausente",
    },
    {
      key: "forma_pagamento",
      label: "Forma de pagamento definida (BANT Budget)",
      weight: 15,
      passed: !!s.negociacao?.forma_pagamento,
      reason: s.negociacao?.forma_pagamento
        ? `forma="${s.negociacao.forma_pagamento}"`
        : "negociacao.forma_pagamento ausente",
    },
    {
      key: "tem_troca_definido",
      label: "Cliente respondeu sobre troca (sim/não)",
      weight: 10,
      passed:
        s.negociacao?.tem_troca !== null &&
        s.negociacao?.tem_troca !== undefined,
      reason:
        s.negociacao?.tem_troca === true
          ? "tem troca declarada"
          : s.negociacao?.tem_troca === false
          ? "sem troca declarada"
          : "tem_troca pendente",
    },
    {
      key: "veiculo_apresentado",
      label: "Veículo já apresentado (engagement avançou)",
      weight: 10,
      passed: !!s.veiculo_apresentado?.ja_apresentado,
      reason: s.veiculo_apresentado?.ja_apresentado
        ? `${s.veiculo_apresentado?.modelo || "veículo"} apresentado`
        : "ainda não apresentou veículo",
    },
    {
      key: "decide_sozinho",
      label: "Decide sozinho (BANT Authority sole)",
      weight: 10,
      passed:
        !!s.lead?.nome &&
        !(
          typeof s.lead?.acompanhante_decisao === "string" &&
          s.lead.acompanhante_decisao.trim().length > 0
        ),
      reason: s.lead?.acompanhante_decisao
        ? `compartilhada com ${s.lead.acompanhante_decisao}`
        : s.lead?.nome
        ? "sem acompanhante mencionado"
        : "nome ausente — não dá pra inferir",
    },
    {
      key: "dados_auxiliares",
      label: "Cidade ou conhecimento da loja",
      weight: 5,
      passed:
        !!s.lead?.cidade ||
        (s.lead?.conhece_loja !== null && s.lead?.conhece_loja !== undefined),
      reason:
        s.lead?.cidade
          ? `cidade="${s.lead.cidade}"`
          : s.lead?.conhece_loja !== null && s.lead?.conhece_loja !== undefined
          ? "conhece_loja respondido"
          : "cidade/conhece_loja ausentes",
    },
    {
      key: "modo_atendimento",
      label: "Modo de atendimento confirmado (remoto/presencial)",
      weight: 5,
      passed: !!s.atendimento?.modo_atendimento,
      reason: s.atendimento?.modo_atendimento
        ? `modo="${s.atendimento.modo_atendimento}"`
        : "atendimento.modo_atendimento pendente",
    },
    // ─── Penalidades ───
    {
      key: "objecao_visita_nao_resolvida",
      label:
        "Penalidade: cliente recusou visita mas modo remoto não definido",
      weight: -15,
      passed:
        s.atendimento?.pode_visitar_loja === false &&
        !s.atendimento?.modo_atendimento,
      reason:
        s.atendimento?.pode_visitar_loja === false &&
        !s.atendimento?.modo_atendimento
          ? "recusou visita E sem modo remoto = atendimento travado"
          : "objeção visita não aplicável ou já tratada",
    },
  ];

  // Soma pondera por `passed` (peso negativo de penalidade só aplica se passed=true)
  let rawPositive = 0;
  let rawPenalties = 0;
  breakdown.forEach((c) => {
    if (c.passed) {
      if (c.weight > 0) rawPositive += c.weight;
      else rawPenalties += c.weight;
    }
  });

  const total = rawPositive + rawPenalties;
  const score = Math.max(0, Math.min(100, total));
  const tier = getLeadTier(score);

  return { score, tier, breakdown, rawPositive, rawPenalties };
}

/**
 * Formata o breakdown como bloco markdown pra apend em system prompt
 * (apenas critérios que passaram + score final + tier).
 */
export function formatLeadScoreBlock(result: LeadScoreResult): string {
  const lines: string[] = [];
  lines.push("## LEAD SCORE");
  lines.push(`- **Score**: ${result.score}/100 (tier: ${result.tier})`);

  const passed = result.breakdown.filter((c) => c.passed && c.weight > 0);
  const penalties = result.breakdown.filter((c) => c.passed && c.weight < 0);
  const missing = result.breakdown.filter((c) => !c.passed && c.weight > 0);

  if (passed.length > 0) {
    lines.push("- Pontos coletados:");
    passed.forEach((c) =>
      lines.push(`  - ✅ ${c.label} (+${c.weight}): ${c.reason}`)
    );
  }
  if (penalties.length > 0) {
    lines.push("- Penalidades aplicadas:");
    penalties.forEach((c) =>
      lines.push(`  - ⚠️ ${c.label} (${c.weight}): ${c.reason}`)
    );
  }
  if (missing.length > 0) {
    lines.push("- Faltam coletar (pesos):");
    missing.forEach((c) =>
      lines.push(`  - ⏳ ${c.label} (+${c.weight}): ${c.reason}`)
    );
  }
  return lines.join("\n");
}
