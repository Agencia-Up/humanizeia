/**
 * checkout-plans.ts — tabela de precos + regra de fundador (compartilhada)
 *
 * Fonte unica de verdade dos precos do checkout publico. Usada por:
 *   - checkout-pricing             (cotacao ao vivo p/ a tela)
 *   - checkout-create-subscription (cria as cobrancas no Asaas)
 *   - checkout-asaas-webhook       (provisiona o plano apos pagamento)
 *
 * Regras (atualizadas com o Wander em 13/06/2026):
 *   Existem 3 planos: BASICO, PRO e PRO MAX (enterprise).
 *   Todos usam a CHAVE DE IA DO PROPRIO CLIENTE -> conversas ILIMITADAS
 *   (nao cobramos por conversa; por isso a cota e um teto alto simbolico).
 *
 *   PRO fundador (1o-10o pago): setup 1497,90 | mensal 497,00  (promo de 3 meses)
 *   PRO normal   (11o+):        setup 1997,90 | mensal 797,90
 *   PRO MAX fundador (1o-10o):  setup 1497,90 | mensal 797,90  (promo de 3 meses)
 *   PRO MAX normal   (11o+):    setup 1997,90 | mensal 1297,90
 *   BASICO:                     setup 1497,00 | mensal 497,00
 *
 *   PROMO FUNDADOR: o preco mensal de fundador vale por 3 MESES; depois volta
 *   ao preco normal. A reversao apos 3 meses e feita MANUALMENTE no painel do
 *   Asaas (sao no maximo 10 fundadores por plano). A assinatura ja e criada no
 *   valor de fundador; o setup com desconto e cobrado 1x.
 *
 *   ANUAL: 10% de desconto sobre 12x a mensalidade NORMAL do plano (igual p/
 *   fundador e normal; o fundador ainda ganha o setup com desconto). Setup e
 *   cobrado 1x, inclusive no anual.
 */

export type PlanType = 'pro' | 'enterprise' | 'basico';
export type Ciclo = 'mensal' | 'anual';
export type Tier = 'fundador' | 'normal';

// Limite de fundadores por plano (cada plano tem sua propria contagem).
export const FOUNDERS_LIMIT = 10;            // PRO
export const FOUNDERS_LIMIT_ENTERPRISE = 10; // PRO MAX

// Cota "ilimitada": cliente usa a propria chave de IA, entao nao cobramos por
// conversa. Teto alto simbolico pra ninguem esbarrar em limite.
export const UNLIMITED_ATEND = 999999;

export const PLANS = {
  pro: {
    atendimentos: UNLIMITED_ATEND,
    fundador: { setup: 1497.90, mensal: 497.00, anual: 8617.32 },
    normal:   { setup: 1997.90, mensal: 797.90, anual: 8617.32 },
  },
  enterprise: {
    atendimentos: UNLIMITED_ATEND,
    fundador: { setup: 1497.90, mensal: 797.90,  anual: 14017.32 },
    normal:   { setup: 1997.90, mensal: 1297.90, anual: 14017.32 },
  },
  basico: {
    atendimentos: UNLIMITED_ATEND,
    setup: 1497.00,
    mensal: 497.00,
    anual: 5367.60,
  },
} as const;

/** Limite de fundador conforme o plano. */
export function foundersLimitFor(planType: PlanType): number {
  return planType === 'enterprise' ? FOUNDERS_LIMIT_ENTERPRISE : FOUNDERS_LIMIT;
}

/** Faixa (fundador/normal) a partir de quantos JA pagaram aquele plano. */
export function resolveTier(paidCount: number, limit: number = FOUNDERS_LIMIT): Tier {
  return paidCount < limit ? 'fundador' : 'normal';
}

/** Compat: faixa do Pro a partir da quantidade de Pro JA pagos. */
export function resolveProTier(paidProCount: number): Tier {
  return resolveTier(paidProCount, FOUNDERS_LIMIT);
}

export interface Quote {
  planType: PlanType;
  ciclo: Ciclo;
  tier: Tier | null;
  atendimentos: number;
  setup: number;       // taxa de implementacao (1x)
  recurrence: number;  // mensalidade ou anuidade (conforme ciclo)
  cycleAsaas: 'MONTHLY' | 'YEARLY';
  planId: PlanType;    // plan_id em user_subscriptions (pro|enterprise|basico)
}

/**
 * Resolve o preco final de um plano+ciclo.
 * `paidCount` = quantos JA pagaram ESSE plano (pra resolver fundador/normal).
 * Para basico o paidCount e ignorado (nao tem faixa de fundador).
 */
export function quote(planType: PlanType, ciclo: Ciclo, paidCount: number): Quote {
  const cycleAsaas = ciclo === 'anual' ? 'YEARLY' : 'MONTHLY';

  if (planType === 'basico') {
    const b = PLANS.basico;
    return {
      planType, ciclo, tier: null,
      atendimentos: b.atendimentos,
      setup: b.setup,
      recurrence: ciclo === 'anual' ? b.anual : b.mensal,
      cycleAsaas, planId: 'basico',
    };
  }

  const plan = PLANS[planType]; // pro | enterprise
  const tier = resolveTier(paidCount, foundersLimitFor(planType));
  const p = plan[tier];
  return {
    planType, ciclo, tier,
    atendimentos: plan.atendimentos,
    setup: p.setup,
    recurrence: ciclo === 'anual' ? p.anual : p.mensal,
    cycleAsaas, planId: planType,
  };
}
