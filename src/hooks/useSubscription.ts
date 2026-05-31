import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type PlanId = 'basico' | 'pro' | 'enterprise';

// O plano é vendido/medido em ATENDIMENTOS (leads), não em tokens crus.
// 1 atendimento = 1 lead atendido pelo Pedro dentro do ciclo de cobrança.
// `atendimentoCost` = preço de 1 atendimento avulso (recarga), em R$.
export const PLANS = {
  basico: {
    id: 'basico' as PlanId,
    name: 'Básico',
    subtitle: 'Solo',
    price: 497,
    setup: 2000,
    atendimentosIncluded: 150,
    atendimentoCost: 2.0,
    color: '#6B7280',
  },
  pro: {
    id: 'pro' as PlanId,
    name: 'Pro',
    subtitle: 'Agência',
    price: 997,
    setup: 3997,
    atendimentosIncluded: 300,
    atendimentoCost: 1.5,
    color: '#5C6BC0',
  },
  enterprise: {
    id: 'enterprise' as PlanId,
    name: 'Pro Max',
    subtitle: 'Completo',
    price: 1497,
    setup: 5997,
    atendimentosIncluded: 500,
    atendimentoCost: 1.0,
    color: '#DAA520',
  },
};

// Pacotes de recarga avulsa (quando os atendimentos do plano acabam).
// Preço fixo por pacote — pacote maior tem preço por atendimento menor.
export const ATENDIMENTO_PACKAGES = [
  { atendimentos: 150, price: 479.90, label: '150 atendimentos' },
  { atendimentos: 300, price: 869.90, label: '300 atendimentos' },
  { atendimentos: 500, price: 1209.90, label: '500 atendimentos' },
];

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: PlanId;
  status: 'active' | 'suspended' | 'cancelled';
  tokens_included: number;
  tokens_used: number;
  tokens_purchased: number;
  renewal_date: string;
  created_at: string;
}

export interface TokenTransaction {
  id: string;
  user_id: string;
  type: 'purchase' | 'consume' | 'refund' | 'renewal';
  amount: number;
  description: string;
  agent: string | null;
  balance_after: number;
  created_at: string;
}

// Demo data when no real subscription exists
const DEMO_SUBSCRIPTION: Subscription = {
  id: 'demo-sub-1',
  user_id: 'demo',
  plan_id: 'pro',
  status: 'active',
  tokens_included: 150000,
  tokens_used: 87340,
  tokens_purchased: 20000,
  renewal_date: new Date(Date.now() + 18 * 24 * 60 * 60 * 1000).toISOString(),
  created_at: new Date().toISOString(),
};

const DEMO_TRANSACTIONS: TokenTransaction[] = [
  { id: '1', user_id: 'demo', type: 'renewal', amount: 150000, description: 'Renovação mensal — Plano Pro', agent: null, balance_after: 150000, created_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '2', user_id: 'demo', type: 'consume', amount: -3200, description: 'Geração de carrossel IA', agent: 'davi', balance_after: 146800, created_at: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '3', user_id: 'demo', type: 'consume', amount: -8900, description: 'Plano estratégico completo', agent: 'daniel', balance_after: 137900, created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '4', user_id: 'demo', type: 'consume', amount: -5100, description: 'Geração de e-mail marketing', agent: 'joao', balance_after: 132800, created_at: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '5', user_id: 'demo', type: 'purchase', amount: 20000, description: 'Recarga avulsa — 20.000 tokens', agent: null, balance_after: 152800, created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '6', user_id: 'demo', type: 'consume', amount: -12400, description: 'Copies para anúncios Meta Ads', agent: 'copywriter', balance_after: 140400, created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '7', user_id: 'demo', type: 'consume', amount: -18600, description: 'Análise SWOT + OKRs', agent: 'daniel', balance_after: 121800, created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '8', user_id: 'demo', type: 'consume', amount: -9800, description: 'Sequência de e-mails (5 emails)', agent: 'joao', balance_after: 112000, created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '9', user_id: 'demo', type: 'consume', amount: -14200, description: 'Geração de 3 carrosséis Instagram', agent: 'davi', balance_after: 97800, created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '10', user_id: 'demo', type: 'consume', amount: -10460, description: 'Copies para Google Ads + Meta', agent: 'copywriter', balance_after: 82660, created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
];

// Race promise vs timeout de N ms; rejeita se exceder
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: timeout após ${ms}ms`)), ms)
    ),
  ]);
}

export function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [transactions, setTransactions] = useState<TokenTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setSubscription(null);
      setTransactions([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let { data, error: selErr } = await withTimeout(
        (supabase as any)
          .from('user_subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        8000,
        'select user_subscriptions',
      );

      // Se não existe subscription, cria uma automaticamente (plano basico)
      if (!data || selErr) {
        const newSub = {
          user_id: user.id,
          plan_id: 'basico',
          status: 'active',
          tokens_included: 150,
          tokens_used: 0,
          tokens_purchased: 0,
          renewal_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };
        const { data: inserted } = await withTimeout(
          (supabase as any)
            .from('user_subscriptions')
            .upsert(newSub, { onConflict: 'user_id' })
            .select()
            .maybeSingle(),
          8000,
          'upsert user_subscriptions',
        );
        data = inserted || newSub;
      }

      setSubscription(data as Subscription);

      // fetch real transactions (não bloqueia UI se falhar)
      try {
        const { data: txData } = await withTimeout(
          (supabase as any)
            .from('token_transactions')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(50),
          5000,
          'select token_transactions',
        );
        setTransactions((txData as TokenTransaction[]) || []);
      } catch {
        setTransactions([]);
      }
    } catch (err: any) {
      // Erro grave (timeout, RLS, network) — guarda mensagem pra UI mostrar
      setSubscription(null);
      setTransactions([]);
      setError(err?.message || 'Erro ao carregar plano');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  // As colunas tokens_* do banco agora contam ATENDIMENTOS (1 = 1 lead/ciclo),
  // não mais tokens crus. Os nomes das colunas seguem por compatibilidade.
  const tokensAvailable = subscription
    ? subscription.tokens_included + subscription.tokens_purchased - subscription.tokens_used
    : 0;

  const tokensTotal = subscription
    ? subscription.tokens_included + subscription.tokens_purchased
    : 0;

  const usagePercent = subscription && tokensTotal > 0
    ? Math.round((subscription.tokens_used / tokensTotal) * 100)
    : 0;

  const planInfo = subscription ? PLANS[subscription.plan_id] : PLANS.basico;

  // Simulate atendimento recharge (demo)
  const purchaseTokens = async (atendimentoAmount: number) => {
    const plan = PLANS[subscription?.plan_id || 'basico'];
    const price = atendimentoAmount * plan.atendimentoCost;
    // In production: integrate with Stripe/Hotmart
    return { success: true, price, atendimentoAmount };
  };

  // Simulate plan upgrade (demo)
  const upgradePlan = async (newPlanId: PlanId) => {
    // In production: integrate with payment gateway
    return { success: true, planId: newPlanId };
  };

  return {
    subscription,
    transactions,
    loading,
    error,
    tokensAvailable,
    tokensTotal,
    usagePercent,
    planInfo,
    purchaseTokens,
    upgradePlan,
    refetch: fetchSubscription,
  };
}
