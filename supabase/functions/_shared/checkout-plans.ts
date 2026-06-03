/**
 * checkout-plans.ts — tabela de precos + regra de fundador (compartilhada)
 *
 * Fonte unica de verdade dos precos do checkout publico. Usada por:
 *   - checkout-pricing            (cotacao ao vivo p/ a tela)
 *   - checkout-create-subscription (cria as cobrancas no Asaas)
 *
 * Regras (definidas com o Wander em 03/06/2026):
 *   PRO fundador (1o ao 10o pago): setup 1497,00 | mensal 497,90 | anual 5974,80
 *   PRO normal   (11o em diante):  setup 2997,90 | mensal 997,00 | anual 10169,40
 *   BASICO:                        setup 1497,00 | mensal 497,00 | anual 5367,60
 *   Cota: PRO = 300 atendimentos/ciclo | BASICO = 150 atendimentos/ciclo.
 *   Implementacao (setup) cobrada 1x, inclusive no anual.
 */

export type PlanType = 'pro' | 'basico';
export type Ciclo = 'mensal' | 'anual';
export type Tier = 'fundador' | 'normal';

export const FOUNDERS_LIMIT = 10;

export const PLANS = {
  pro: {
    atendimentos: 300,
    fundador: { setup: 1497.00, mensal: 497.90, anual: 5974.80 },
    normal: { setup: 2997.90, mensal: 997.00, anual: 10169.40 },
  },
  basico: {
    atendimentos: 150,
    setup: 1497.00,
    mensal: 497.00,
    anual: 5367.60,
  },
} as const;

/** Faixa do Pro a partir da quantidade de Pro JA pagos. */
export function resolveProTier(paidProCount: number): Tier {
  return paidProCount < FOUNDERS_LIMIT ? 'fundador' : 'normal';
}

export interface Quote {
  planType: PlanType;
  ciclo: Ciclo;
  tier: Tier | null;
  atendimentos: number;
  setup: number;       // taxa de implementacao (1x)
  recurrence: number;  // mensalidade ou anuidade (conforme ciclo)
  cycleAsaas: 'MONTHLY' | 'YEARLY';
  planId: PlanType;    // plan_id em user_subscriptions (pro|basico)
}

/** Resolve o preco final de um plano+ciclo dado quantos Pro ja foram pagos. */
export function quote(planType: PlanType, ciclo: Ciclo, paidProCount: number): Quote {
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
  const tier = resolveProTier(paidProCount);
  const p = PLANS.pro[tier];
  return {
    planType, ciclo, tier,
    atendimentos: PLANS.pro.atendimentos,
    setup: p.setup,
    recurrence: ciclo === 'anual' ? p.anual : p.mensal,
    cycleAsaas, planId: 'pro',
  };
}
