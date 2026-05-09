import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type PlanId = 'basico' | 'pro' | 'enterprise';

export const PLANS = {
  basico: {
    id: 'basico' as PlanId,
    name: 'Básico',
    subtitle: 'Solo',
    price: 497,
    setup: 3000,
    tokensIncluded: 50000,
    tokenCostPer1k: 1.5,
    color: '#6B7280',
  },
  pro: {
    id: 'pro' as PlanId,
    name: 'Pro',
    subtitle: 'Agência',
    price: 997,
    setup: 5000,
    tokensIncluded: 150000,
    tokenCostPer1k: 1.0,
    color: '#5C6BC0',
  },
  enterprise: {
    id: 'enterprise' as PlanId,
    name: 'Enterprise',
    subtitle: 'Custom',
    price: 2497,
    setup: 10000,
    tokensIncluded: 500000,
    tokenCostPer1k: 0.5,
    color: '#DAA520',
  },
};

export const TOKEN_PACKAGES = [
  { tokens: 10000, label: '10.000 tokens' },
  { tokens: 50000, label: '50.000 tokens' },
  { tokens: 100000, label: '100.000 tokens' },
  { tokens: 500000, label: '500.000 tokens' },
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

export function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [transactions, setTransactions] = useState<TokenTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setSubscription(null);
      setTransactions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let { data, error } = await (supabase as any)
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      // Se nao existe subscription, cria uma automaticamente (plano basico)
      if (!data || error) {
        const newSub = {
          user_id: user.id,
          plan_id: 'basico',
          status: 'active',
          tokens_included: 50000,
          tokens_used: 0,
          tokens_purchased: 0,
          renewal_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };
        const { data: inserted } = await (supabase as any)
          .from('user_subscriptions')
          .upsert(newSub, { onConflict: 'user_id' })
          .select()
          .maybeSingle();
        data = inserted || newSub;
      }

      setSubscription(data as Subscription);

      // fetch real transactions
      const { data: txData } = await (supabase as any)
        .from('token_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      setTransactions((txData as TokenTransaction[]) || []);
    } catch {
      // Em caso de erro grave, mostra zeros em vez de dados falsos
      setSubscription(null);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

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

  // Simulate token purchase (demo)
  const purchaseTokens = async (tokenAmount: number) => {
    const plan = PLANS[subscription?.plan_id || 'basico'];
    const price = (tokenAmount / 1000) * plan.tokenCostPer1k;
    // In production: integrate with Stripe/Hotmart
    return { success: true, price, tokenAmount };
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
    tokensAvailable,
    tokensTotal,
    usagePercent,
    planInfo,
    purchaseTokens,
    upgradePlan,
    refetch: fetchSubscription,
  };
}
